-- Standalone Phase 7 suite: run as postgres in ONE dedicated SQL session after Phase 6.
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

UPDATE auth.users SET raw_app_meta_data='{"super_admin":true}' WHERE id=pg_temp.id('med_inactive');
-- More than one history page must not hide an older event selected by its date.
INSERT INTO public.historialmedico(id_historial,id_mascota,fecha_registro,observaciones)
SELECT gen_random_uuid(),pg_temp.id('patient'),'2025-01-01'::timestamp+make_interval(mins=>n),'Evento reciente' FROM generate_series(1,205) n;
INSERT INTO public.historialmedico(id_historial,id_mascota,fecha_registro,observaciones)
VALUES(gen_random_uuid(),pg_temp.id('patient'),'2020-01-02','Evento antiguo preservado');

SELECT pg_temp.jwt('med_inactive');SET LOCAL ROLE authenticated;
DO $$ DECLARE d jsonb;BEGIN
 d:=public.vettrack_plataforma('global_dashboard');PERFORM pg_temp.assert_true(d?'activos' AND NOT d?'diagnosticos','global metrics contain no clinical data');
 d:=public.vettrack_plataforma('tenant',jsonb_build_object('id',pg_temp.id('tenant')));
 PERFORM pg_temp.assert_true((d->>'pacientes')::integer=1 AND d->'por_rol'->>'admin'='1','global tenant counts are real');
 PERFORM pg_temp.assert_true(NOT d?'consultas' AND NOT d?'expediente','no routine global clinical detail');
 PERFORM public.vettrack_plataforma('tenant_estado',jsonb_build_object('id',pg_temp.id('tenant'),'estado','suspendido','motivo','Prueba de suspensión'));
END $$;
RESET ROLE;
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
DO $$ DECLARE d jsonb;BEGIN
 PERFORM pg_temp.assert_true(public.get_my_veterinaria() IS NULL AND NOT EXISTS(SELECT * FROM public.get_my_permissions()),'suspension revokes tenant and permissions for existing JWT');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dueno),'suspended tenant RLS hides operational data');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''dashboard'')',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_plataforma(''global_dashboard'')',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_plataforma(''ticket_crear'',''{"asunto":"Intento","categoria":"acceso","descripcion":"Prueba","id_veterinaria":"00000000-0000-0000-0000-000000000001"}'')',ARRAY['22023']);
 d:=public.vettrack_plataforma('ticket_crear','{"asunto":"Acceso suspendido","categoria":"acceso","descripcion":"Necesito ayuda de plataforma","prioridad":"alta","modulo":"Sesión"}');
 PERFORM set_config('vettrack.clinic.ticket',d->>'id_ticket',true);
 PERFORM pg_temp.assert_true(d->>'id_usuario'=pg_temp.id('rec')::text AND d->>'id_veterinaria'=pg_temp.id('tenant')::text AND d->>'rol'='recepcionista','support derives identity role tenant');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('med');SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''ticket'',%L)',jsonb_build_object('id',pg_temp.id('ticket'))::text),ARRAY['P0002']);
RESET ROLE;
SELECT pg_temp.jwt('admin_b');SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''ticket'',%L)',jsonb_build_object('id',pg_temp.id('ticket'))::text),ARRAY['P0002']);
RESET ROLE;
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.vettrack_plataforma('ticket',jsonb_build_object('id',pg_temp.id('ticket'))) IS NOT NULL,'tenant admin sees own tenant ticket even when suspended');
RESET ROLE;
SELECT pg_temp.jwt('med_inactive');SET LOCAL ROLE authenticated;
DO $$ DECLARE d jsonb;BEGIN
 PERFORM public.vettrack_plataforma('ticket_estado',jsonb_build_object('id',pg_temp.id('ticket'),'estado','en_revision'));
 PERFORM public.vettrack_plataforma('ticket_responder',jsonb_build_object('id',pg_temp.id('ticket'),'mensaje','Revisamos la solicitud'));
 PERFORM public.vettrack_plataforma('ticket_estado',jsonb_build_object('id',pg_temp.id('ticket'),'estado','en_proceso'));
 PERFORM public.vettrack_plataforma('tenant_estado',jsonb_build_object('id',pg_temp.id('tenant'),'estado','activo'));
 d:=public.vettrack_plataforma('tenants','{"q":"Phase 3 transaction fixture A"}');
 PERFORM pg_temp.assert_true(jsonb_array_length(d->'filas')=1,'tenant global list filtered and bounded');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
DO $$ DECLARE d jsonb;vendor uuid;prod uuid;ord uuid;BEGIN
 PERFORM pg_temp.assert_true(public.get_my_veterinaria()=pg_temp.id('tenant'),'reactivation restores original tenant access');
 d:=public.vettrack_plataforma('archivo_preparar','{"categoria":"logo","nombre":"logo.png","mime":"image/png","tamano":200}');PERFORM set_config('vettrack.clinic.logo',d->>'id_archivo',true);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_plataforma(''archivo_preparar'',''{"categoria":"logo","nombre":"fake.pdf","mime":"application/pdf","tamano":200}'')',ARRAY['23514']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_plataforma(''archivo_preparar'',''{"categoria":"logo","nombre":"large.png","mime":"image/png","tamano":5242881}'')',ARRAY['23514']);
 d:=public.vettrack_inventario('proveedor_guardar','{"nombre":"Proveedor Fase 7","activo":true}');vendor:=(d->>'id_proveedor')::uuid;
 d:=public.vettrack_inventario('producto_guardar','{"nombre":"Producto Fase 7","tipo_producto":"insumo","unidad":"unidad","precio_venta":10,"stock_minimo":1}');prod:=(d->>'id_producto')::uuid;
 PERFORM set_config('vettrack.clinic.product',prod::text,true);
 d:=public.vettrack_inventario('compra_crear',jsonb_build_object('id_proveedor',vendor,'detalles',jsonb_build_array(jsonb_build_object('id_producto',prod,'cantidad',4,'precio_unitario',5))));ord:=(d->>'id')::uuid;PERFORM set_config('vettrack.clinic.purchase_cancel',ord::text,true);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''compra_cerrar'',%L)',jsonb_build_object('id',ord,'estado','cancelada','motivo','')::text),ARRAY['22023']);
 PERFORM public.vettrack_inventario('compra_cerrar',jsonb_build_object('id',ord,'estado','cancelada','motivo','La clínica cancela'));
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''compra_recibir'',%L)',jsonb_build_object('id',ord)::text),ARRAY['23514']);
 d:=public.vettrack_inventario('compra_crear',jsonb_build_object('id_proveedor',vendor,'detalles',jsonb_build_array(jsonb_build_object('id_producto',prod,'cantidad',4,'precio_unitario',5))));
 PERFORM public.vettrack_inventario('compra_cerrar',jsonb_build_object('id',d->>'id','estado','no_recibida','motivo','El proveedor no entregó'));
 d:=public.vettrack_inventario('compra_crear',jsonb_build_object('id_proveedor',vendor,'detalles',jsonb_build_array(jsonb_build_object('id_producto',prod,'cantidad',4,'precio_unitario',5))));PERFORM set_config('vettrack.clinic.purchase',d->>'id',true);
 d:=public.vettrack_plataforma('archivo_preparar',jsonb_build_object('categoria','compras','contexto_id',d->>'id','nombre','factura.pdf','mime','application/pdf','tamano',200));PERFORM set_config('vettrack.clinic.purchase_file',d->>'id_archivo',true);
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT stock_actual=0 FROM public.producto WHERE id_producto=pg_temp.id('product')) AND NOT EXISTS(SELECT 1 FROM public.movimiento_inventario WHERE id_producto=pg_temp.id('product')) AND NOT EXISTS(SELECT 1 FROM public.lote_inventario WHERE id_producto=pg_temp.id('product')),'closed/unreceived purchases never change stock movements or lots');
-- Storage metadata fixtures only; backend tests validate actual bytes separately.
UPDATE public.archivo_clinica SET estado='listo' WHERE id_archivo IN (pg_temp.id('logo'),pg_temp.id('purchase_file'));
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT bucket,ruta,jsonb_build_object('mimetype',mime,'size',tamano) FROM public.archivo_clinica WHERE id_archivo IN (pg_temp.id('logo'),pg_temp.id('purchase_file'));
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
DO $$ DECLARE d jsonb;BEGIN
 PERFORM public.vettrack_plataforma('logo_guardar',jsonb_build_object('id_archivo',pg_temp.id('logo')));
 PERFORM pg_temp.assert_true((SELECT count(*) FROM storage.objects WHERE name LIKE pg_temp.id('tenant')::text||'/%')=2,'own logo and purchase file visible with parent permissions');
 PERFORM pg_temp.expect_error('INSERT INTO storage.objects(bucket_id,name) VALUES(''clinic-assets'',''forged.png'')',ARRAY['42501']);
 -- Hosted Storage may reject DELETE at statement level before RLS filters rows.
 -- Both rejection and zero affected rows must preserve every private object.
 BEGIN
  DELETE FROM storage.objects WHERE name LIKE pg_temp.id('tenant')::text||'/%';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 -- Emulate Storage API's transaction-local deletion flag to test RLS itself.
 -- Only this suite's random-Tenant metadata fixtures are targeted; rollback remains.
 PERFORM set_config('storage.allow_delete_query','true',true);
 DELETE FROM storage.objects WHERE name LIKE pg_temp.id('tenant')::text||'/%';
 PERFORM set_config('storage.allow_delete_query','false',true);
 PERFORM pg_temp.assert_true((SELECT count(*) FROM storage.objects WHERE name LIKE pg_temp.id('tenant')::text||'/%')=2,'direct Storage deletion blocked');
 PERFORM public.vettrack_inventario('compra_recibir',jsonb_build_object('id',pg_temp.id('purchase'),'documento_archivo',pg_temp.id('purchase_file')));
 PERFORM public.vettrack_inventario('compra_recibir',jsonb_build_object('id',pg_temp.id('purchase'),'documento_archivo',pg_temp.id('purchase_file')));
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''compra_cerrar'',%L)',jsonb_build_object('id',pg_temp.id('purchase'),'estado','no_recibida','motivo','Inválido')::text),ARRAY['23514']);
 d:=public.vettrack_inventario('recepciones','{"dias":7}');PERFORM pg_temp.assert_true(jsonb_array_length(d)=1 AND d->0->>'documento_archivo'=pg_temp.id('purchase_file')::text,'recent receipts exclude both closed states and retain file reference');
 PERFORM public.vettrack_guardar_horarios(pg_temp.id('med_plain'),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"17:00"}]');
 d:=public.vettrack_guardar_cita(NULL,jsonb_build_object('id_mascota',pg_temp.id('patient'),'id_dueno',pg_temp.id('owner'),'id_medico',pg_temp.id('med_plain'),'fecha_inicio','2030-01-07T09:00:00-08:00','servicios',jsonb_build_array(pg_temp.id('legacy_service'))));PERFORM set_config('vettrack.clinic.appointment',d->>'id_cita',true);
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT stock_actual=4 FROM public.producto WHERE id_producto=pg_temp.id('product')) AND (SELECT count(*) FROM public.movimiento_inventario WHERE id_producto=pg_temp.id('product'))=1,'physical receipt remains idempotent');
SELECT pg_temp.jwt('admin_b');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE pg_temp.id('tenant')::text||'/%'),'other Tenant sees no files');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''archivo'',%L)',jsonb_build_object('id',pg_temp.id('purchase_file'))::text),ARRAY['P0002']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''logo_guardar'',%L)',jsonb_build_object('id_archivo',pg_temp.id('logo'))::text),ARRAY['23514','23503']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''compra_cerrar'',%L)',jsonb_build_object('id',pg_temp.id('purchase_cancel'),'estado','cancelada','motivo','Foreign')::text),ARRAY['P0002']);
END $$;
RESET ROLE;
SELECT pg_temp.jwt('med_plain');SET LOCAL ROLE authenticated;
DO $$ DECLARE d jsonb;cid uuid;BEGIN
 d:=public.vettrack_iniciar_consulta(pg_temp.id('appointment'));cid:=(d->'consulta'->>'id_consulta')::uuid;PERFORM set_config('vettrack.clinic.consultation',cid::text,true);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_guardar_consulta(%L,%L)',cid,jsonb_build_object('proxima_cita',(now() AT TIME ZONE 'America/Tijuana')::date-1)::text),ARRAY['22023']);
 PERFORM public.vettrack_guardar_consulta(cid,jsonb_build_object('proxima_cita',(now() AT TIME ZONE 'America/Tijuana')::date));
 d:=public.vettrack_plataforma('archivo_preparar',jsonb_build_object('categoria','estudios','contexto_id',cid,'nombre','estudio.jpg','mime','image/jpeg','tamano',200));PERFORM set_config('vettrack.clinic.study_file',d->>'id_archivo',true);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''compra_cerrar'',%L)',jsonb_build_object('id',pg_temp.id('purchase_cancel'),'estado','cancelada','motivo','No autorizado')::text),ARRAY['42501']);
END $$;
RESET ROLE;
UPDATE public.archivo_clinica SET estado='listo' WHERE id_archivo=pg_temp.id('study_file');
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT bucket,ruta,jsonb_build_object('mimetype',mime,'size',tamano) FROM public.archivo_clinica WHERE id_archivo=pg_temp.id('study_file');
SELECT pg_temp.jwt('med_plain');SET LOCAL ROLE authenticated;
DO $$ DECLARE d jsonb;BEGIN
 PERFORM public.vettrack_guardar_registro_clinico(pg_temp.id('consultation'),'estudio',jsonb_build_object('tipo','laboratorio','nombre','Estudio con archivo','fecha',(now() AT TIME ZONE 'America/Tijuana')::date,'archivo_adjunto',pg_temp.id('study_file')));
 d:=public.vettrack_plataforma('archivo',jsonb_build_object('id',pg_temp.id('study_file')));PERFORM pg_temp.assert_true(d->>'mime'='image/jpeg','doctor sees authorized study attachment');
 PERFORM public.vettrack_finalizar_consulta(pg_temp.id('consultation'));
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT bool_and(contenido->>'pdf_version'='2' AND contenido->>'logo_archivo'=pg_temp.id('logo')::text) FROM public.documento_clinico WHERE id_consulta=pg_temp.id('consultation')),'future documents freeze version and logo');
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
SELECT public.vettrack_plataforma('logo_guardar','{"id_archivo":null}');
SELECT pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''archivo_borrar'',%L)',jsonb_build_object('id',pg_temp.id('logo'))::text),ARRAY['23514']);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT bool_and(contenido->>'logo_archivo'=pg_temp.id('logo')::text) FROM public.documento_clinico WHERE id_consulta=pg_temp.id('consultation')),'removing active logo never changes document snapshots');
INSERT INTO public.mascota(id_mascota,id_dueno,nombre,especie) SELECT gen_random_uuid(),pg_temp.id('owner'),x,'Gato' FROM unnest(ARRAY['Marvin','Luna','Sol']) x;
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
DO $$ DECLARE d jsonb;BEGIN
 d:=public.vettrack_plataforma('propietarios_resumen','{"q":"Marvin"}');PERFORM pg_temp.assert_true(jsonb_array_length(d->'filas')=1 AND d->'filas'->0->>'total_pacientes'='4' AND jsonb_array_length(d->'filas'->0->'pacientes')=2,'patient prefix search returns correct owner with bounded summary');
 d:=public.vettrack_plataforma('propietario',jsonb_build_object('id',pg_temp.id('owner')));PERFORM pg_temp.assert_true(jsonb_array_length(d->'pacientes')=4 AND d->'propietario'->>'id_dueno'=pg_temp.id('owner')::text,'owner detail uses existing 0..N relation');
 d:=public.vettrack_plataforma('propietario',jsonb_build_object('id',pg_temp.id('other_owner')));PERFORM pg_temp.assert_true(d->>'total_pacientes'='0','zero-patient owner supported');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''propietario'',%L)',jsonb_build_object('id',pg_temp.id('owner_b'))::text),ARRAY['P0002']);
 d:=public.vettrack_plataforma('citas_explorar','{"vista":"pendientes"}');PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(d->'filas') x WHERE x->>'id_cita'=pg_temp.id('legacy_cita')::text),'past pending appointment remains visible');
 PERFORM pg_temp.assert_true(public.vettrack_plataforma('citas_explorar','{"vista":"hoy"}')->'filas'='[]'::jsonb,'today is separate from historical pending');
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_plataforma('citas_explorar','{"vista":"todas"}')->'filas')=2,'all includes historical pending and completed appointment');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
SELECT public.vettrack_permisos_usuario(pg_temp.id('rec'),'{"pacientes.ver":false}');
RESET ROLE;
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.vettrack_plataforma('propietarios_resumen','{}')->'filas'->0->'total_pacientes'='null'::jsonb,'patient summaries respect individual denial');
SELECT pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''ticket_estado'',%L)',jsonb_build_object('id',pg_temp.id('ticket'),'estado','cerrado')::text),ARRAY['42501']);
DO $$ DECLARE d jsonb;BEGIN
 d:=public.vettrack_plataforma('archivo_preparar',jsonb_build_object('categoria','soporte','contexto_id',pg_temp.id('ticket'),'nombre','captura.png','mime','image/png','tamano',200));PERFORM set_config('vettrack.clinic.support_file',d->>'id_archivo',true);
END $$;
RESET ROLE;
UPDATE public.archivo_clinica SET estado='listo' WHERE id_archivo=pg_temp.id('support_file');
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT bucket,ruta,jsonb_build_object('mimetype',mime,'size',tamano) FROM public.archivo_clinica WHERE id_archivo=pg_temp.id('support_file');
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
SELECT public.vettrack_plataforma('ticket_responder',jsonb_build_object('id',pg_temp.id('ticket'),'mensaje','Adjunto de ejemplo','adjunto',pg_temp.id('support_file')));
RESET ROLE;
SELECT pg_temp.jwt('med_inactive');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.assert_true((SELECT count(*) FROM storage.objects WHERE name LIKE pg_temp.id('tenant')::text||'/%')=2,'Superadmin reads support and logo, never purchases or studies');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''archivo'',%L)',jsonb_build_object('id',pg_temp.id('study_file'))::text),ARRAY['P0002']);
 PERFORM public.vettrack_plataforma('ticket_estado',jsonb_build_object('id',pg_temp.id('ticket'),'estado','resuelto'));
 PERFORM public.vettrack_plataforma('ticket_estado',jsonb_build_object('id',pg_temp.id('ticket'),'estado','cerrado'));
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_plataforma(''ticket_responder'',%L)',jsonb_build_object('id',pg_temp.id('ticket'),'mensaje','No debe agregar')::text),ARRAY['23514']);
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.auditoria_plataforma WHERE id_veterinaria=pg_temp.id('tenant') AND accion='tenant_estado')=2,'suspension/reactivation audit preserved');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.vettrack_plataforma(text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','private.inv_api_phase6(text,jsonb)','EXECUTE'),'anonymous and bypass helpers remain closed');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE pg_temp.id('tenant')::text||'/%'),'anon sees no private Storage files');
RESET ROLE;
ROLLBACK;
