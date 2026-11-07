-- Standalone Phase 6 suite: run as postgres in ONE dedicated SQL session after Phase 6.
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
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb;prod uuid;appointment uuid;BEGIN
 data:=public.vettrack_operacion_final('reporte',jsonb_build_object('tipo','historial','id_mascota',pg_temp.id('patient'),'desde','2020-01-02','hasta','2020-01-02'));
 PERFORM pg_temp.assert_true(jsonb_array_length(data->'filas')=1 AND data->'filas'->0->>'descripcion'='Evento antiguo preservado','history date filter precedes pagination');
 PERFORM public.vettrack_operacion_final('configuracion_guardar','{"nombre":"Clínica Final A","direccion":"Domicilio profesional","correo":"clinica@example.com","telefono":"6641234567","horario":"Lunes a viernes","descripcion":"Prueba"}');
 PERFORM pg_temp.assert_true(public.vettrack_operacion_final('configuracion')->>'nombre'='Clínica Final A','settings persisted');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''configuracion_guardar'',''{"nombre":"Forged","id_veterinaria":"00000000-0000-0000-0000-000000000001"}'')',ARRAY['22023']);
 PERFORM public.vettrack_usuario_cedula(pg_temp.id('med_plain'),'12345678');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_usuario_cedula(%L,''12345678'')',pg_temp.id('med_inactive')),ARRAY['P0002']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_usuario_cedula(%L,''12345678'')',pg_temp.id('med_b')),ARRAY['P0002']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_usuario_cedula(%L,''BAD'')',pg_temp.id('med_plain')),ARRAY['22023']);
 PERFORM pg_temp.assert_true(public.vettrack_operacion_final('horarios_medicos') IS NOT NULL,'schedule selector authorized');
 UPDATE public.mascota SET especie='Perro' WHERE id_mascota=pg_temp.id('patient');
 PERFORM public.vettrack_guardar_horarios(pg_temp.id('med_plain'),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"17:00"}]');
 data:=public.vettrack_guardar_cita(NULL,jsonb_build_object('id_mascota',pg_temp.id('patient'),'id_dueno',pg_temp.id('owner'),'id_medico',pg_temp.id('med_plain'),'fecha_inicio','2030-01-07T09:00:00-08:00','servicios',jsonb_build_array(pg_temp.id('legacy_service'))));
 PERFORM set_config('vettrack.clinic.payment_appointment',data->>'id_cita',true);
 data:=public.vettrack_inventario('producto_guardar','{"nombre":"Medicina para entregar","tipo_producto":"medicamento","unidad":"frasco","precio_venta":40,"stock_minimo":1,"grupo_prescripcion":"III"}');prod:=(data->>'id_producto')::uuid;
 PERFORM set_config('vettrack.clinic.payment_product',prod::text,true);
 PERFORM public.vettrack_inventario('mover',jsonb_build_object('id_producto',prod,'tipo','entrada','cantidad',5,'idempotencia',gen_random_uuid(),'motivo','Stock','numero_lote','PAY','fecha_caducidad',(now() AT TIME ZONE 'America/Tijuana')::date+90));
 data:=public.vettrack_operacion_final('metodos_pago');PERFORM set_config('vettrack.clinic.payment_method',data->0->>'id_metodopago',true);
END $$;
RESET ROLE;
SELECT pg_temp.jwt('med_plain');SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb;cid uuid;kind text;BEGIN
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''pagos'')',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''configuracion'')',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''reporte'',''{"tipo":"agenda"}'')',ARRAY['42501']);
 data:=public.vettrack_iniciar_consulta(pg_temp.id('payment_appointment'));cid:=(data->'consulta'->>'id_consulta')::uuid;PERFORM set_config('vettrack.clinic.payment_consultation',cid::text,true);
 PERFORM public.vettrack_guardar_registro_clinico(cid,'diagnostico','{"tipo":"definitivo","descripcion":"Diagnóstico final"}');
 PERFORM public.vettrack_guardar_registro_clinico(cid,'tratamiento','{"descripcion":"Tratamiento final","duracion":"Según MVZ"}');
 PERFORM public.vettrack_guardar_registro_clinico(cid,'vacuna',jsonb_build_object('nombre','Vacuna final','fecha_aplicacion',(now() AT TIME ZONE 'America/Tijuana')::date));
 PERFORM public.vettrack_guardar_registro_clinico(cid,'desparasitacion',jsonb_build_object('producto','Producto final','dosis','Registrada por MVZ','fecha',(now() AT TIME ZONE 'America/Tijuana')::date));
 PERFORM public.vettrack_guardar_registro_clinico(cid,'estudio',jsonb_build_object('tipo','laboratorio','nombre','Estudio final','fecha',(now() AT TIME ZONE 'America/Tijuana')::date));
 data:=public.vettrack_guardar_registro_clinico(cid,'receta',jsonb_build_object('detalles',jsonb_build_array(jsonb_build_object('nombre_medicamento','Medicina para entregar','id_producto',pg_temp.id('payment_product'),'dosis','Según MVZ','frecuencia','Registrada','duracion','Registrada','via_administracion','Registrada','cantidad',2,'grupo_prescripcion','III','entregar',true))));
 PERFORM set_config('vettrack.clinic.payment_detail',data->'receta'->'detalles'->0->>'id_detalle',true);
 data:=public.vettrack_finalizar_consulta(cid);PERFORM set_config('vettrack.clinic.payment_order',data->'ordenes'->0->>'id_orden',true);
 data:=public.vettrack_operacion_final('dashboard');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'metricas') x WHERE x->>'ruta' IN ('/pagos','/compras','/configuracion')),'doctor dashboard omits unauthorized finance');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb;BEGIN
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''configuracion'')',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''reporte'',''{"tipo":"agenda"}'')',ARRAY['42501']);
 data:=public.vettrack_operacion_final('orden_pago',jsonb_build_object('id_orden',pg_temp.id('payment_order')));
 PERFORM pg_temp.assert_true((data->>'total')::numeric=450 AND (data->>'entregas_pendientes')::int=1,'preview waits for physical delivery');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_operacion_final(''pago_registrar'',%L)',jsonb_build_object('id_orden',pg_temp.id('payment_order'),'id_metodopago',pg_temp.id('payment_method'))::text),ARRAY['23514']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_operacion_final(''pago_registrar'',%L)',jsonb_build_object('id_orden',pg_temp.id('payment_order'),'id_metodopago',pg_temp.id('payment_method'),'monto',1)::text),ARRAY['22023']);
 PERFORM public.vettrack_inventario('receta_entregar',jsonb_build_object('id_orden',pg_temp.id('payment_order'),'id_detalle',pg_temp.id('payment_detail')));
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb;kind text;BEGIN
 PERFORM public.vettrack_guardar_servicio(pg_temp.id('legacy_service'),'{"costo":999}');
 PERFORM public.vettrack_inventario('producto_guardar',jsonb_build_object('id',pg_temp.id('payment_product'),'nombre','Medicina para entregar','tipo_producto','medicamento','unidad','frasco','precio_venta',999,'stock_minimo',1,'grupo_prescripcion','III'));
 data:=public.vettrack_operacion_final('orden_pago',jsonb_build_object('id_orden',pg_temp.id('payment_order')));
 PERFORM pg_temp.assert_true((data->>'total')::numeric=530,'service 450 and delivered product 2x40 remain frozen after catalog repricing');
 FOREACH kind IN ARRAY ARRAY['agenda','pacientes','historial','vacunas','desparasitaciones','tratamientos','servicios','uso_inventario','stock_bajo','caducidades'] LOOP
  data:=public.vettrack_operacion_final('reporte',jsonb_build_object('tipo',kind,'desde',(now() AT TIME ZONE 'America/Tijuana')::date-30,'hasta',(now() AT TIME ZONE 'America/Tijuana')::date+30,'id_mascota',pg_temp.id('patient')));
  PERFORM pg_temp.assert_true(jsonb_typeof(data->'filas')='array','report compiles and derives real data: '||kind);
 END LOOP;
 data:=public.vettrack_operacion_final('reporte','{"tipo":"agenda","desde":"2030-01-07","hasta":"2030-01-07"}');PERFORM pg_temp.assert_true(jsonb_array_length(data->'filas')=1,'agenda period finds actual appointment');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''reporte'',''{"tipo":"agenda","desde":"2000-01-01","hasta":"2030-01-01"}'')',ARRAY['22023']);
 -- Personal permissions must allow and deny independently of role defaults.
 PERFORM public.vettrack_permisos_usuario(pg_temp.id('rec'),'{"pagos.crear":false,"reportes.ver":true}');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_operacion_final(''pago_registrar'',%L)',jsonb_build_object('id_orden',pg_temp.id('payment_order'),'id_metodopago',pg_temp.id('payment_method'))::text),ARRAY['42501']);
 PERFORM pg_temp.assert_true(public.vettrack_operacion_final('reporte','{"tipo":"agenda"}')->>'tipo'='agenda','individual allow grants a report');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_operacion_final(''reporte'',''{"tipo":"tratamientos"}'')',ARRAY['42501']);
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
SELECT public.vettrack_permisos_usuario(pg_temp.id('rec'),'{"pagos.crear":null}');
RESET ROLE;
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
DO $$ DECLARE first jsonb;again jsonb;BEGIN
 first:=public.vettrack_operacion_final('pago_registrar',jsonb_build_object('id_orden',pg_temp.id('payment_order'),'id_metodopago',pg_temp.id('payment_method')));
 again:=public.vettrack_operacion_final('pago_registrar',jsonb_build_object('id_orden',pg_temp.id('payment_order'),'id_metodopago',pg_temp.id('payment_method')));
 PERFORM pg_temp.assert_true((first->>'monto')::numeric=530 AND first->>'id_pago'=again->>'id_pago' AND again->>'ya_registrado'='true','payment is idempotent and historical');
 PERFORM pg_temp.assert_true((SELECT estado='procesada' FROM public.orden_recepcion WHERE id_orden=pg_temp.id('payment_order')),'payment processes order');
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_operacion_final('pagos')->'pagos')=1 AND public.vettrack_operacion_final('pagos')->'pendientes'='[]'::jsonb,'payment list and outstanding attention consistent');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin_b');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(public.vettrack_operacion_final('pagos')->'pagos'='[]'::jsonb,'cross tenant payments invisible');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_operacion_final(''orden_pago'',%L)',jsonb_build_object('id_orden',pg_temp.id('payment_order'))::text),ARRAY['P0002']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_operacion_final(''pago_registrar'',%L)',jsonb_build_object('id_orden',pg_temp.id('payment_order'),'id_metodopago',pg_temp.id('payment_method'))::text),ARRAY['P0002']);
 PERFORM pg_temp.assert_true(public.vettrack_operacion_final('reporte','{"tipo":"pacientes"}')->'filas' @> jsonb_build_array(jsonb_build_object('nombre','Patient B')),'report only own patients');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.vettrack_operacion_final('reporte','{"tipo":"pacientes"}')->'filas') x WHERE x->>'nombre'='Tornado'),'other patients never leak');
END $$;
RESET ROLE;
DO $$ BEGIN
 PERFORM pg_temp.assert_true((SELECT count(*) FROM public.pago WHERE id_orden=pg_temp.id('payment_order'))=1,'one payment per order');
 PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.pago','SELECT') AND NOT has_table_privilege('authenticated','public.pago','INSERT'),'payment rows cannot be read or forged directly');
 PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','public.vettrack_operacion_final(text,jsonb)','EXECUTE'),'anon no new RPC');
 PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','private.fin_order(uuid,uuid)','EXECUTE'),'unguarded helper not exposed');
 RAISE NOTICE 'PASS Phase 6: payment freeze, delivery first, duplicate prevention, roles/overrides, all ten reports, dashboard, settings, license and Tenant';
END $$;
ROLLBACK;
