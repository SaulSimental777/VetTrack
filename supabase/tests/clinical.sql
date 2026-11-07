-- Standalone Phase 3 suite: run as postgres in ONE dedicated SQL session after Phase 3.
-- Inserts only isolated random-UUID fixtures in new tenants; never updates existing rows.
-- No Auth API calls. Every fixture and successful write is discarded by ROLLBACK.
-- Production historical migration results must be verified separately before/after.
BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '5s';
CREATE FUNCTION pg_temp.assert_true(p_result boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_result IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',p_message; END IF; END; $$;
CREATE FUNCTION pg_temp.expect_error(p_sql text,p_states text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE=ANY(p_states) THEN RETURN; END IF;
        RAISE EXCEPTION 'Expected %, got %: %',p_states,SQLSTATE,SQLERRM;
    END;
    RAISE EXCEPTION 'Expected error %, statement succeeded: %',p_states,p_sql;
END; $$;
CREATE FUNCTION pg_temp.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT current_setting('vettrack.clinic.'||p_name)::uuid;
$$;
CREATE FUNCTION pg_temp.jwt(p_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(p_name),'role','authenticated')::text,true);
END; $$;
CREATE FUNCTION pg_temp.booking(p_start text DEFAULT '2030-01-07T09:00:00-08:00',p_medico text DEFAULT 'med_plain')
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('id_mascota',pg_temp.id('patient'),'id_dueno',pg_temp.id('owner'),
        'id_medico',pg_temp.id(p_medico),'fecha_inicio',p_start,'motivo','Se lastimó una pata.',
        'servicios',jsonb_build_array(pg_temp.id('xray'),pg_temp.id('dressing')),'forzar_horario',false);
$$;
-- Transaction-only fixture seed; the shared Phase 3 suite is appended below.
DO $$ DECLARE key text; user_key text; BEGIN
    FOREACH key IN ARRAY ARRAY['tenant','tenant_b','admin','admin_b','rec','med','med_plain','med_inactive','med_b','inactive',
        'equine','surgery','specialty_b','owner','owner_b','other_owner','patient','patient_b','legacy_service','service_b','legacy_cita'] LOOP
        PERFORM set_config('vettrack.clinic.'||key,gen_random_uuid()::text,true);
    END LOOP;
    INSERT INTO public.veterinaria(id_veterinaria,nombre) VALUES
        (pg_temp.id('tenant'),'Phase 3 transaction fixture A'),(pg_temp.id('tenant_b'),'Phase 3 transaction fixture B');
    FOREACH user_key IN ARRAY ARRAY['admin','admin_b','rec','med','med_plain','med_inactive','med_b','inactive'] LOOP
        -- INSERT only: collisions fail instead of updating an existing Auth user.
        INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at)
        VALUES(pg_temp.id(user_key),'authenticated','authenticated',pg_temp.id(user_key)::text||'@example.invalid',
            '{}'::jsonb,'{}'::jsonb,now());
    END LOOP;
    INSERT INTO public.perfilusuario(id,nombre,rol,activo,id_veterinaria) VALUES
        (pg_temp.id('admin'),'Administrator A','admin',true,pg_temp.id('tenant')),
        (pg_temp.id('admin_b'),'Administrator B','admin',true,pg_temp.id('tenant_b')),
        (pg_temp.id('rec'),'Reception A','recepcionista',true,pg_temp.id('tenant')),
        (pg_temp.id('med'),'Doctor Equine A','medico',true,pg_temp.id('tenant')),
        (pg_temp.id('med_plain'),'Doctor Without Specialty A','medico',true,pg_temp.id('tenant')),
        (pg_temp.id('med_inactive'),'Inactive Doctor A','medico',false,pg_temp.id('tenant')),
        (pg_temp.id('med_b'),'Doctor B','medico',true,pg_temp.id('tenant_b')),
        (pg_temp.id('inactive'),'Inactive Reception A','recepcionista',false,pg_temp.id('tenant'));
    INSERT INTO public.especialidad(id_especialidad,nombre,id_veterinaria) VALUES
        (pg_temp.id('equine'),'Equinos',pg_temp.id('tenant')),
        (pg_temp.id('surgery'),'Cirugía',pg_temp.id('tenant')),
        (pg_temp.id('specialty_b'),'Dermatología B',pg_temp.id('tenant_b'));
    INSERT INTO public.medico_especialidad(id_usuario,id_especialidad,id_veterinaria) VALUES
        (pg_temp.id('med'),pg_temp.id('equine'),pg_temp.id('tenant')),
        (pg_temp.id('med'),pg_temp.id('surgery'),pg_temp.id('tenant'));
    INSERT INTO public.dueno(id_dueno,nombre,id_veterinaria) VALUES
        (pg_temp.id('owner'),'Owner A',pg_temp.id('tenant')),
        (pg_temp.id('owner_b'),'Owner B',pg_temp.id('tenant_b')),
        (pg_temp.id('other_owner'),'Other Owner A',pg_temp.id('tenant'));
    INSERT INTO public.mascota(id_mascota,nombre,id_dueno) VALUES
        (pg_temp.id('patient'),'Tornado',pg_temp.id('owner')),
        (pg_temp.id('patient_b'),'Patient B',pg_temp.id('owner_b'));
    INSERT INTO public.servicio(id_servicio,nombre,descripcion,costo,id_veterinaria) VALUES
        (pg_temp.id('legacy_service'),'Legacy-shaped consultation','Snapshot fixture',450,pg_temp.id('tenant')),
        (pg_temp.id('service_b'),'Foreign service',NULL,900,pg_temp.id('tenant_b'));
    -- This is a post-migration test fixture, not a claim about production history.
    -- Production migration preservation is checked separately using before/after data.
    INSERT INTO public.cita(id_cita,fecha,fecha_inicio,fecha_fin,estado,estado_legacy,id_mascota,id_dueno,id_servicio,id_veterinaria) VALUES
        (pg_temp.id('legacy_cita'),'2025-01-06 10:00:00','2025-01-06T10:00:00-08:00','2025-01-06T10:30:00-08:00',
            'confirmada','Confirmada',pg_temp.id('patient'),pg_temp.id('owner'),pg_temp.id('legacy_service'),pg_temp.id('tenant'));
    INSERT INTO public.cita_servicio(id_cita,id_servicio,id_veterinaria,precio_aplicado,duracion_aplicada) VALUES
        (pg_temp.id('legacy_cita'),pg_temp.id('legacy_service'),pg_temp.id('tenant'),450,30);
    RAISE NOTICE 'Isolated random-UUID fixtures created inside rollback-only transaction';
END; $$;

SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
DO $$ DECLARE a jsonb; BEGIN
 PERFORM public.vettrack_datos_profesionales_clinica('{"direccion":"Domicilio profesional de prueba"}');
 UPDATE public.mascota SET especie='Perro' WHERE id_mascota=pg_temp.id('patient');
 PERFORM public.vettrack_guardar_horarios(pg_temp.id('med_plain'),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"17:00"}]');
 a:=public.vettrack_guardar_cita(NULL,jsonb_build_object('id_mascota',pg_temp.id('patient'),'id_dueno',pg_temp.id('owner'),
  'id_medico',pg_temp.id('med_plain'),'fecha_inicio','2030-01-07T09:00:00-08:00','servicios',jsonb_build_array(pg_temp.id('legacy_service'))));
 PERFORM set_config('vettrack.clinic.clinical_appointment',a->>'id_cita',true);
 a:=public.vettrack_guardar_cita(NULL,jsonb_build_object('id_mascota',pg_temp.id('patient'),'id_dueno',pg_temp.id('owner'),
  'id_medico',pg_temp.id('med_plain'),'fecha_inicio','2030-01-07T10:00:00-08:00','servicios',jsonb_build_array(pg_temp.id('legacy_service'))));
 PERFORM set_config('vettrack.clinic.clinical_appointment_group_i',a->>'id_cita',true);
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.permiso)=CASE WHEN to_regprocedure('public.vettrack_inventario(text,jsonb)') IS NOT NULL THEN 82 ELSE 69 END,'Phase 4 permission catalog');
END $$;
RESET ROLE;

SELECT pg_temp.jwt('med');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.expect_error('SELECT public.vettrack_iniciar_consulta('||quote_literal(pg_temp.id('clinical_appointment'))||')',ARRAY['42501']);
END $$;
RESET ROLE;
SELECT pg_temp.jwt('med_plain');
SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb; cid uuid; before_price numeric; rx jsonb; detail jsonb; BEGIN
 data:=public.vettrack_iniciar_consulta(pg_temp.id('clinical_appointment'));
 cid:=(data->'consulta'->>'id_consulta')::uuid;PERFORM set_config('vettrack.clinic.consultation',cid::text,true);
 PERFORM pg_temp.assert_true((SELECT estado='en_consulta' FROM public.cita WHERE id_cita=pg_temp.id('clinical_appointment')),'start updates appointment');
 PERFORM pg_temp.assert_true(public.vettrack_iniciar_consulta(pg_temp.id('clinical_appointment'))->'consulta'->>'id_consulta'=cid::text,'start is idempotent');
 data:=public.vettrack_guardar_consulta(cid,'{"motivo_consulta":"Dolor de pata","anamnesis":"Historia clínica privada","exploracion_fisica":"Exploración","temperatura":38.5,"frecuencia_cardiaca":80,"frecuencia_respiratoria":20,"peso":12.5,"mucosas":"Observadas","trc":"2 s","pronostico":"Seguimiento","indicaciones":"Revisión","observaciones_administrativas":"Entregar orden","proxima_cita":"2030-01-14"}');
 PERFORM public.vettrack_guardar_registro_clinico(cid,'diagnostico','{"tipo":"presuntivo","descripcion":"Primer diagnóstico"}');
 data:=public.vettrack_guardar_registro_clinico(cid,'diagnostico','{"tipo":"definitivo","descripcion":"Segundo diagnóstico"}');
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'diagnosticos')=2,'multiple diagnoses');
 PERFORM public.vettrack_guardar_registro_clinico(cid,'tratamiento','{"descripcion":"Primer tratamiento","indicaciones":"Indicaciones","duracion":"7 días"}');
 data:=public.vettrack_guardar_registro_clinico(cid,'tratamiento','{"descripcion":"Segundo tratamiento","observaciones":"Control"}');
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'tratamientos')=2,'multiple treatments');
 PERFORM public.vettrack_guardar_registro_clinico(cid,'vacuna','{"nombre":"Vacuna registrada","laboratorio":"Laboratorio","lote":"L123","fecha_aplicacion":"2030-01-07","proxima_aplicacion":"2031-01-07"}');
 PERFORM public.vettrack_guardar_registro_clinico(cid,'desparasitacion','{"producto":"Producto registrado","dosis":"Dosis indicada por MVZ","peso":12.5,"fecha":"2030-01-07","proxima_fecha":"2030-04-07"}');
 data:=public.vettrack_guardar_registro_clinico(cid,'estudio','{"tipo":"radiografia","nombre":"Estudio de extremidad","resultado":"Resultado registrado","fecha":"2030-01-07","archivo_url":null}');
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'vacunas')=1 AND jsonb_array_length(data->'desparasitaciones')=1 AND jsonb_array_length(data->'estudios')=1,'preventive records and studies');
 PERFORM public.vettrack_agregar_servicio_consulta(cid,pg_temp.id('legacy_service'));
 -- A new service is snapshotted once even if the operation is retried.
 RESET ROLE;
 PERFORM pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
 data:=public.vettrack_guardar_servicio(NULL,'{"nombre":"Servicio adicional clínico","costo":100,"duracion_minutos":15}');
 PERFORM set_config('vettrack.clinic.added_service',data->>'id_servicio',true);
 PERFORM pg_temp.jwt('med_plain');
 data:=public.vettrack_agregar_servicio_consulta(cid,pg_temp.id('added_service'));
 data:=public.vettrack_agregar_servicio_consulta(cid,pg_temp.id('added_service'));
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'servicios')=2,'additional service is idempotent');
 RESET ROLE;PERFORM pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
 PERFORM public.vettrack_guardar_servicio(pg_temp.id('added_service'),'{"costo":150}');
 PERFORM pg_temp.jwt('med_plain');
 SELECT precio_aplicado INTO before_price FROM public.cita_servicio WHERE id_cita=pg_temp.id('clinical_appointment') AND id_servicio=pg_temp.id('added_service');
 PERFORM pg_temp.assert_true(before_price=100,'clinical applied price frozen');
 detail:='{"nombre_medicamento":"Medicamento de prueba","principio_activo":"Declarado por médico","concentracion":"Concentración","presentacion":"Presentación","dosis":"Dosis indicada por MVZ","frecuencia":"Frecuencia indicada","duracion":"Duración indicada","via_administracion":"Vía indicada","cantidad":1,"indicaciones":"Uso según MVZ","grupo_prescripcion":"II","tiempo_retiro":"No aplica","entregar":true}';
 rx:=jsonb_build_object('indicaciones','Indicaciones de receta','detalles',jsonb_build_array(detail,detail||'{"nombre_medicamento":"Segundo medicamento","grupo_prescripcion":"III"}'));
 data:=public.vettrack_guardar_registro_clinico(cid,'receta',rx);
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'receta'->'detalles')=2,'prescription independent of inventory with several medications');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_finalizar_consulta('||quote_literal(cid)||')',ARRAY['22023']);
 PERFORM public.vettrack_cedula_medico(pg_temp.id('med_plain'),'12345678');
 data:=public.vettrack_finalizar_consulta(cid);
 PERFORM pg_temp.assert_true(data->'consulta'->>'estado'='finalizada' AND (SELECT estado='completada' FROM public.cita WHERE id_cita=pg_temp.id('clinical_appointment')),'finish completes consultation and appointment');
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'documentos')=4,'four automatic frozen document snapshots for Group II');
 PERFORM set_config('vettrack.clinic.note_document',(SELECT x->>'id_documento' FROM jsonb_array_elements(data->'documentos') x WHERE x->>'tipo'='nota_consulta'),true);
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_finalizar_consulta(cid)->'documentos')=4,'finish idempotent');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_guardar_consulta('||quote_literal(cid)||',''{}'')',ARRAY['23514']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_reabrir_consulta('||quote_literal(cid)||',''Sin permiso'')',ARRAY['42501']);
 data:=public.vettrack_expediente(pg_temp.id('patient'));
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'entradas')>=10,'longitudinal record includes all clinical event types');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'entradas') WITH ORDINALITY a(x,n)
  JOIN jsonb_array_elements(data->'entradas') WITH ORDINALITY b(x,n) ON b.n=a.n+1 WHERE (a.x->>'fecha')::timestamptz<(b.x->>'fecha')::timestamptz),'history is chronological');
 -- Group I can be documented, but never produces a simple prescription.
 data:=public.vettrack_iniciar_consulta(pg_temp.id('clinical_appointment_group_i'));cid:=(data->'consulta'->>'id_consulta')::uuid;
 PERFORM public.vettrack_guardar_registro_clinico(cid,'receta',jsonb_build_object('detalles',jsonb_build_array(detail||'{"grupo_prescripcion":"I"}')));
 data:=public.vettrack_finalizar_consulta(cid);
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'documentos')=3 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'documentos') x WHERE x->>'tipo'='receta_simple'),'Group I blocks simple prescription');
 RAISE NOTICE 'PASS assigned doctor, clinical records, multiple diagnoses/treatments/medications, vaccine/deworming/study, frozen additional service, license, finish, history and Group I';
END $$;
RESET ROLE;

SELECT pg_temp.jwt('rec');
SET LOCAL ROLE authenticated;
DO $$ DECLARE orders jsonb; oid uuid; doc uuid; BEGIN
 orders:=public.vettrack_ordenes_recepcion();
 PERFORM pg_temp.assert_true(jsonb_array_length(orders)=2,'reception sees closure orders');
 PERFORM pg_temp.assert_true(orders::text NOT LIKE '%Historia clínica privada%' AND orders::text NOT LIKE '%Primer diagnóstico%','administrative order excludes sensitive clinical notes');
 oid:=(orders->0->>'id_orden')::uuid;
 PERFORM set_config('vettrack.clinic.processed_consultation',orders->0->>'id_consulta',true);
 PERFORM pg_temp.assert_true(public.vettrack_documento_clinico((orders->0->>'id_documento')::uuid)->>'tipo'='orden_recepcion','reception can read its administrative document');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_documento_clinico('||quote_literal(pg_temp.id('note_document'))||')',ARRAY['42501']);
 PERFORM public.vettrack_procesar_orden_recepcion(oid);PERFORM public.vettrack_procesar_orden_recepcion(oid);
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.consulta) AND NOT EXISTS(SELECT 1 FROM public.diagnostico),'reception cannot directly read clinical records');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_consulta('||quote_literal(pg_temp.id('consultation'))||')',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_guardar_registro_clinico('||quote_literal(pg_temp.id('consultation'))||',''diagnostico'',''{"tipo":"definitivo","descripcion":"No permitido"}'')',ARRAY['42501']);
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
DO $$ DECLARE cid uuid; did uuid; old_snapshot jsonb; next jsonb; BEGIN
 PERFORM pg_temp.expect_error('SELECT public.vettrack_reabrir_consulta('||quote_literal(pg_temp.id('processed_consultation'))||',''Corrección documentada'')',ARRAY['23514']);
 SELECT id_consulta INTO cid FROM public.consulta WHERE id_consulta<>pg_temp.id('processed_consultation') LIMIT 1;
 SELECT (d->>'id_documento')::uuid INTO did FROM jsonb_array_elements(public.vettrack_consulta(cid)->'documentos') d WHERE d->>'tipo'='nota_consulta';
 old_snapshot:=public.vettrack_documento_clinico(did)->'contenido';
 PERFORM pg_temp.expect_error('SELECT contenido FROM public.documento_clinico',ARRAY['42501']);
 next:=public.vettrack_reabrir_consulta(cid,'Corrección documentada');
 PERFORM pg_temp.assert_true((next->'consulta'->>'revision')::integer=2 AND next->'consulta'->>'estado'='en_curso','authorized reopen creates a new revision');
 PERFORM public.vettrack_guardar_consulta(cid,'{"observaciones":"Corrección autorizada"}');
 PERFORM public.vettrack_finalizar_consulta(cid);
 PERFORM pg_temp.assert_true(old_snapshot=public.vettrack_documento_clinico(did)->'contenido','previous PDF snapshot remains immutable after reopen');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin_b');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.consulta) AND NOT EXISTS(SELECT 1 FROM public.orden_recepcion),'cross-clinic reads denied');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_consulta('||quote_literal(pg_temp.id('consultation'))||')',ARRAY['P0002']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_expediente('||quote_literal(pg_temp.id('patient'))||')',ARRAY['P0002']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_finalizar_consulta('||quote_literal(pg_temp.id('consultation'))||')',ARRAY['P0002']);
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 PERFORM pg_temp.expect_error('SELECT public.vettrack_consultas()',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT * FROM public.consulta',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT * FROM public.documento_clinico',ARRAY['42501']);
END $$;
RESET ROLE;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['consulta','tratamiento','receta_detalle','vacunacion','desparasitacion','estudio_clinico','orden_recepcion','documento_clinico'] LOOP
  PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass),'clinical RLS enabled');
  PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE'),'direct clinical writes denied');
 END LOOP;
 RAISE NOTICE 'PASS reception privacy and processing, cross-tenant rejection, anon denial and clinical RLS';
END $$;
ROLLBACK;
