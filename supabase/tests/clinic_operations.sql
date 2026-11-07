-- Run only against the disposable local fixture after Phase 2 + Phase 3.
-- All runtime writes, including permissions, appointments and schedules, roll back.
BEGIN;
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
DO $$ DECLARE item record; BEGIN
    FOR item IN SELECT * FROM (VALUES
        ('tenant','10000000-0000-4000-8000-000000000001'),('tenant_b','10000000-0000-4000-8000-000000000002'),
        ('admin','20000000-0000-4000-8000-000000000001'),('admin_b','20000000-0000-4000-8000-000000000003'),
        ('rec','20000000-0000-4000-8000-000000000004'),('med','20000000-0000-4000-8000-000000000005'),
        ('med_plain','20000000-0000-4000-8000-000000000006'),('med_inactive','20000000-0000-4000-8000-000000000007'),
        ('med_b','20000000-0000-4000-8000-000000000008'),('inactive','20000000-0000-4000-8000-000000000009'),
        ('equine','30000000-0000-4000-8000-000000000001'),('surgery','30000000-0000-4000-8000-000000000002'),
        ('specialty_b','30000000-0000-4000-8000-000000000003'),('owner','40000000-0000-4000-8000-000000000001'),
        ('owner_b','40000000-0000-4000-8000-000000000002'),('other_owner','40000000-0000-4000-8000-000000000003'),
        ('patient','50000000-0000-4000-8000-000000000001'),('patient_b','50000000-0000-4000-8000-000000000002'),
        ('legacy_service','60000000-0000-4000-8000-000000000001'),('service_b','60000000-0000-4000-8000-000000000002'),
        ('legacy_cita','70000000-0000-4000-8000-000000000001')) AS fixtures(name,id) LOOP
        PERFORM set_config('vettrack.clinic.'||item.name,item.id,true);
    END LOOP;
    PERFORM pg_temp.assert_true((SELECT fecha='2025-01-06 10:00:00'::timestamp AND id_medico IS NULL
        AND fecha_inicio='2025-01-06T10:00:00-08:00'::timestamptz AND estado='confirmada'
        FROM public.cita WHERE id_cita=pg_temp.id('legacy_cita')),'legacy appointment date, status and unassigned doctor preserved');
    PERFORM pg_temp.assert_true((SELECT precio_aplicado=450 FROM public.cita_servicio
        WHERE id_cita=pg_temp.id('legacy_cita') AND id_servicio=pg_temp.id('legacy_service')),'legacy service price migrated');
END; $$;

SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
DO $$ DECLARE doctors jsonb; doctor jsonb; service jsonb; blocks jsonb; BEGIN
    PERFORM pg_temp.assert_true(public.has_permission('medicos.administrar') AND public.has_permission('citas.forzar_horario')
        AND public.has_permission('servicios.editar_precio'),'admin has new permissions');
    doctors:=public.vettrack_medicos(NULL,NULL,true);
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(doctors) d WHERE d->>'id'=pg_temp.id('med_plain')::text
        AND jsonb_array_length(d->'especialidades')=0),'doctor without a specialty is selectable');
    SELECT d INTO doctor FROM jsonb_array_elements(doctors) d WHERE d->>'id'=pg_temp.id('med')::text;
    PERFORM pg_temp.assert_true(jsonb_array_length(doctor->'especialidades')=2,'doctor supports multiple specialties');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(doctors) d WHERE d->>'id'=pg_temp.id('med_b')::text),'doctor list is tenant isolated');
    doctors:=public.vettrack_medicos(NULL,pg_temp.id('equine'),true);
    PERFORM pg_temp.assert_true(jsonb_array_length(doctors)=1 AND doctors->0->>'id'=pg_temp.id('med')::text,'specialty filter finds tagged doctor');
    doctors:=public.vettrack_medicos('Without',NULL,true);
    PERFORM pg_temp.assert_true(jsonb_array_length(doctors)=1 AND doctors->0->>'id'=pg_temp.id('med_plain')::text,'doctor name search');
    PERFORM public.vettrack_guardar_horarios(pg_temp.id('med'),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"13:00"},{"dia_semana":1,"hora_inicio":"15:00","hora_fin":"18:00"}]');
    PERFORM public.vettrack_guardar_horarios(pg_temp.id('med_plain'),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"13:00"},{"dia_semana":1,"hora_inicio":"15:00","hora_fin":"18:00"}]');
    PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_horarios(pg_temp.id('med')))=2,'multiple non-overlapping blocks per day');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_horarios(pg_temp.id('med'),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"},{"dia_semana":1,"hora_inicio":"11:00","hora_fin":"13:00"}]')$q$,ARRAY['23514','23P01']);
    PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_horarios(pg_temp.id('med')))=2,'failed schedule replacement is atomic');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_horarios(pg_temp.id('med'),'[{"dia_semana":1,"hora_inicio":"13:00","hora_fin":"09:00"}]')$q$,ARRAY['22023','23514']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_horarios(pg_temp.id('med_b'),'[]')$q$,ARRAY['42501','P0002']);
    blocks:=public.vettrack_guardar_bloqueo(pg_temp.id('med_plain'),'{"fecha_inicio":"2030-01-07T11:00:00-08:00","fecha_fin":"2030-01-07T12:00:00-08:00","motivo":"Comida","tipo":"comida"}');
    PERFORM set_config('vettrack.clinic.block',blocks->>'id_bloqueo',true);
    PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_bloqueos(pg_temp.id('med_plain')))=1,'doctor absence created');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_bloqueo(pg_temp.id('med'),'{"fecha_inicio":"2030-01-07T12:00:00-08:00","fecha_fin":"2030-01-07T11:00:00-08:00","tipo":"manual"}')$q$,ARRAY['22023','23514']);
    service:=public.vettrack_guardar_servicio(NULL,jsonb_build_object('nombre','Radiografía','descripcion','Imagen','costo',650,'duracion_minutos',30,'activo',true,'especialidades',jsonb_build_array(pg_temp.id('equine'))));
    PERFORM set_config('vettrack.clinic.xray',service->>'id_servicio',true);
    service:=public.vettrack_guardar_servicio(NULL,'{"nombre":"Curación","descripcion":"Herida","costo":150,"duracion_minutos":15,"activo":true,"especialidades":[]}');
    PERFORM set_config('vettrack.clinic.dressing',service->>'id_servicio',true);
    PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_servicios())=3,'services list omits foreign tenant');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_servicio(NULL,jsonb_build_object('nombre','Foreign specialty','costo',100,'duracion_minutos',30,'especialidades',jsonb_build_array(pg_temp.id('specialty_b'))))$q$,ARRAY['42501','P0002','22023']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_servicio(pg_temp.id('service_b'),'{"costo":1}')$q$,ARRAY['42501','P0002']);
    RAISE NOTICE 'PASS doctors/specialties, schedules, overlapping blocks, absences, services and tenant checks';
END; $$;
RESET ROLE;

SELECT pg_temp.jwt('rec');
SET LOCAL ROLE authenticated;
DO $$ DECLARE created jsonb; available jsonb; selectors jsonb; BEGIN
    PERFORM pg_temp.assert_true(public.has_permission('medicos.ver') AND public.has_permission('horarios.ver')
        AND public.has_permission('servicios.ver') AND public.has_permission('citas.crear')
        AND NOT public.has_permission('citas.forzar_horario') AND NOT public.has_permission('servicios.editar_precio'),'reception defaults');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_horarios(pg_temp.id('med'),'[]')$q$,ARRAY['42501']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_servicio(pg_temp.id('xray'),'{"costo":700}')$q$,ARRAY['42501']);
    created:=public.vettrack_guardar_cita(NULL,pg_temp.booking());
    PERFORM set_config('vettrack.clinic.appointment',created->>'id_cita',true);
    PERFORM pg_temp.assert_true((SELECT fecha_fin-fecha_inicio=interval '45 minutes' FROM public.cita
        WHERE id_cita=pg_temp.id('appointment')),'appointment duration sums selected services');
    PERFORM pg_temp.assert_true((SELECT count(*)=2 AND sum(precio_aplicado)=800 FROM public.cita_servicio
        WHERE id_cita=pg_temp.id('appointment')),'appointment accepts multiple services with applied prices');
    PERFORM pg_temp.assert_true((SELECT id_medico=pg_temp.id('med_plain') FROM public.cita
        WHERE id_cita=pg_temp.id('appointment')),'specialty mismatch never blocks appointment');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T09:15:00-08:00'))$q$,ARRAY['23P01','23514']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T08:00:00-08:00'))$q$,ARRAY['23514']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T11:00:00-08:00'))$q$,ARRAY['23514']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T08:00:00-08:00')||'{"forzar_horario":true}')$q$,ARRAY['42501']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T10:00:00-08:00','med_inactive'))$q$,ARRAY['42501','P0002','23514']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T10:00:00-08:00','med_b'))$q$,ARRAY['42501','P0002']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T10:00:00-08:00')||jsonb_build_object('id_mascota',pg_temp.id('patient_b'),'id_dueno',pg_temp.id('owner_b')))$q$,ARRAY['42501','P0002','22023']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T10:00:00-08:00')||jsonb_build_object('id_dueno',pg_temp.id('other_owner')))$q$,ARRAY['42501','P0002','22023','23514']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T10:00:00-08:00')||jsonb_build_object('servicios',jsonb_build_array(pg_temp.id('service_b'))))$q$,ARRAY['42501','P0002','22023']);
    available:=public.vettrack_disponibilidad(pg_temp.id('med_plain'),'2030-01-07',45,ARRAY[pg_temp.id('xray'),pg_temp.id('dressing')]);
    PERFORM pg_temp.assert_true((available->>'duracion_minutos')::integer=45 AND jsonb_array_length(available->'slots')>0,'availability considers requested service duration');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(available->'slots') slot
        WHERE (slot->>'fecha_inicio')::timestamptz<'2030-01-07T09:45:00-08:00'::timestamptz
        OR ((slot->>'fecha_inicio')::timestamptz<'2030-01-07T12:00:00-08:00'::timestamptz
            AND (slot->>'fecha_fin')::timestamptz>'2030-01-07T11:00:00-08:00'::timestamptz)
        OR ((slot->>'fecha_inicio')::timestamptz<'2030-01-07T15:00:00-08:00'::timestamptz
            AND (slot->>'fecha_fin')::timestamptz>'2030-01-07T13:00:00-08:00'::timestamptz)),
        'availability excludes bookings, absences and gaps between schedule blocks');
    selectors:=public.vettrack_selectores_citas();
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selectors->'pacientes') p WHERE p->>'id_mascota'=pg_temp.id('patient_b')::text),'appointment patient selector stays within tenant');
    RAISE NOTICE 'PASS receptionist booking, specialty independence, multiple services, availability, conflicts, schedule and cross-tenant validation';
END; $$;
RESET ROLE;

SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
DO $$ DECLARE created jsonb; BEGIN
    PERFORM public.vettrack_guardar_servicio(pg_temp.id('xray'),'{"costo":700}');
    PERFORM pg_temp.assert_true((SELECT precio_aplicado=650 FROM public.cita_servicio
        WHERE id_cita=pg_temp.id('appointment') AND id_servicio=pg_temp.id('xray')),'catalog price changes preserve appointment snapshot');
    PERFORM public.vettrack_guardar_servicio(pg_temp.id('xray'),'{"duracion_minutos":60}');
    created:=public.vettrack_disponibilidad(pg_temp.id('med_plain'),'2030-01-07',30,
        ARRAY[pg_temp.id('xray'),pg_temp.id('dressing')],pg_temp.id('appointment'));
    PERFORM pg_temp.assert_true((created->>'duracion_minutos')::integer=45,
        'editing availability uses booked duration snapshots after catalog duration changes');
    PERFORM public.vettrack_guardar_servicio(pg_temp.id('xray'),'{"activo":false}');
    created:=public.vettrack_guardar_cita(pg_temp.id('appointment'),pg_temp.booking()||'{"motivo":"Edit existing inactive service"}');
    PERFORM pg_temp.assert_true((SELECT fecha_fin-fecha_inicio=interval '45 minutes' FROM public.cita
        WHERE id_cita=pg_temp.id('appointment')),'editing keeps an existing inactive service and its duration snapshot');
    PERFORM pg_temp.assert_true((SELECT precio_aplicado=650 FROM public.cita_servicio
        WHERE id_cita=pg_temp.id('appointment') AND id_servicio=pg_temp.id('xray')),'editing preserves applied price after catalog changes');
    PERFORM public.vettrack_guardar_servicio(pg_temp.id('xray'),'{"activo":true,"duracion_minutos":30}');
    created:=public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T08:00:00-08:00')||'{"forzar_horario":true}');
    PERFORM pg_temp.assert_true(created->>'id_cita' IS NOT NULL,'admin may force schedule');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T09:15:00-08:00')||'{"forzar_horario":true}')$q$,ARRAY['23P01','23514']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T11:00:00-08:00')||'{"forzar_horario":true}')$q$,ARRAY['23514']);
    PERFORM public.vettrack_permisos_usuario(pg_temp.id('rec'),'{"servicios.editar_precio":true}');
    RAISE NOTICE 'PASS frozen historical prices and administrative schedule override without double-booking';
END; $$;
DO $$ DECLARE available jsonb; created jsonb; BEGIN
    PERFORM public.vettrack_guardar_horarios(pg_temp.id('med'),
        '[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"13:00"},{"dia_semana":0,"hora_inicio":"01:15","hora_fin":"01:45"}]');
    available:=public.vettrack_disponibilidad(pg_temp.id('med'),'2030-01-07',30);
    PERFORM pg_temp.assert_true((available->'slots'->0->>'fecha_inicio')::timestamptz='2030-01-07T09:00:00-08:00'::timestamptz,
        'winter slots use Tijuana standard time');
    available:=public.vettrack_disponibilidad(pg_temp.id('med'),'2030-07-01',30);
    PERFORM pg_temp.assert_true((available->'slots'->0->>'fecha_inicio')::timestamptz='2030-07-01T09:00:00-07:00'::timestamptz,
        'summer slots use Tijuana daylight saving time');
    available:=public.vettrack_disponibilidad(pg_temp.id('med'),'2030-11-03',45);
    PERFORM pg_temp.assert_true(jsonb_array_length(available->'slots')=0,'DST fold does not stretch a 30 minute block to fit a 45 minute booking');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-11-03T01:30:00-07:00','med'))$q$,ARRAY['23514']);
    available:=public.vettrack_disponibilidad(pg_temp.id('med'),'2030-11-03',30);
    PERFORM pg_temp.assert_true(jsonb_array_length(available->'slots')=1
        AND (available->'slots'->0->>'fecha_inicio')::timestamptz='2030-11-03T01:15:00-08:00'::timestamptz,
        'ambiguous DST block consistently resolves to standard time');
    created:=public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-11-03T01:15:00-08:00','med')
        ||jsonb_build_object('servicios',jsonb_build_array(pg_temp.id('legacy_service'))));
    PERFORM pg_temp.assert_true(created->>'id_cita' IS NOT NULL,'booking accepts exactly the standard-time slot returned by availability');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-11-03T01:15:00-07:00','med')
        ||jsonb_build_object('servicios',jsonb_build_array(pg_temp.id('legacy_service'))))$q$,ARRAY['23514']);
    RAISE NOTICE 'PASS Tijuana winter/summer offsets and consistent DST fold availability/booking';
END; $$;
RESET ROLE;
SELECT pg_temp.jwt('rec');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM public.vettrack_guardar_servicio(pg_temp.id('xray'),'{"costo":725}');
    PERFORM pg_temp.assert_true((SELECT costo=725 FROM public.servicio WHERE id_servicio=pg_temp.id('xray')),'delegated price-only permission works');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_servicio(pg_temp.id('xray'),'{"nombre":"Unauthorized rename"}')$q$,ARRAY['42501']);
    PERFORM pg_temp.expect_error($q$UPDATE public.servicio SET costo=1 WHERE id_servicio=pg_temp.id('xray')$q$,ARRAY['42501']);
    PERFORM pg_temp.expect_error($q$UPDATE public.cita SET id_veterinaria=pg_temp.id('tenant_b') WHERE id_cita=pg_temp.id('appointment')$q$,ARRAY['42501']);
    PERFORM pg_temp.expect_error($q$INSERT INTO public.horario_medico(id_medico,dia_semana,hora_inicio,hora_fin,id_veterinaria) VALUES(pg_temp.id('med'),1,'01:00','02:00',pg_temp.id('tenant'))$q$,ARRAY['42501']);
    PERFORM public.vettrack_cancelar_cita(pg_temp.id('appointment'));
    PERFORM public.vettrack_guardar_cita(NULL,pg_temp.booking());
    RAISE NOTICE 'PASS delegated price permissions, direct REST write denial, cancellation releases time';
END; $$;
RESET ROLE;

SELECT pg_temp.jwt('med');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.assert_true(public.has_permission('medicos.ver') AND public.has_permission('servicios.ver')
        AND public.has_permission('horarios.ver') AND public.has_permission('citas.ver')
        AND NOT public.has_permission('citas.crear'),'doctor role defaults');
    PERFORM pg_temp.assert_true(jsonb_typeof(public.vettrack_servicios())='array','doctor can read service catalog');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_cita(NULL,pg_temp.booking('2030-01-07T16:00:00-08:00'))$q$,ARRAY['42501']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_horarios(pg_temp.id('med'),'[]')$q$,ARRAY['42501']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_eliminar_servicio(pg_temp.id('xray'))$q$,ARRAY['42501']);
    RAISE NOTICE 'PASS doctor read permissions and mutation restrictions';
END; $$;
RESET ROLE;
SELECT pg_temp.jwt('admin_b');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.cita WHERE id_cita=pg_temp.id('appointment'))
        AND NOT EXISTS(SELECT 1 FROM public.horario_medico WHERE id_medico=pg_temp.id('med'))
        AND NOT EXISTS(SELECT 1 FROM public.servicio WHERE id_servicio=pg_temp.id('xray'))
        AND NOT EXISTS(SELECT 1 FROM public.cita_servicio WHERE id_cita=pg_temp.id('appointment')),'direct table RLS isolates clinic operations');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_cancelar_cita(pg_temp.id('appointment'))$q$,ARRAY['42501','P0002']);
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_disponibilidad(pg_temp.id('med'),'2030-01-07',30)$q$,ARRAY['42501','P0002']);
END; $$;
RESET ROLE;
SELECT pg_temp.jwt('inactive');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.servicio) AND NOT EXISTS(SELECT 1 FROM public.cita),'inactive old JWT cannot read operations');
    PERFORM pg_temp.expect_error('SELECT public.vettrack_medicos()',ARRAY['42501']);
END; $$;
RESET ROLE;
SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
DO $$ DECLARE deleted boolean; BEGIN
    deleted:=public.vettrack_eliminar_bloqueo(pg_temp.id('med_plain'),pg_temp.id('block'));
    PERFORM pg_temp.assert_true(deleted AND jsonb_array_length(public.vettrack_bloqueos(pg_temp.id('med_plain')))=0,'doctor absence removal');
    deleted:=public.vettrack_eliminar_servicio(pg_temp.id('xray'));
    PERFORM pg_temp.assert_true(deleted AND EXISTS(SELECT 1 FROM public.servicio WHERE id_servicio=pg_temp.id('xray') AND NOT activo),
        'service removal deactivates and preserves history');
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.cita_servicio WHERE id_servicio=pg_temp.id('xray')),'service deactivation keeps appointment history');
END; $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
    PERFORM pg_temp.expect_error('SELECT public.vettrack_medicos()',ARRAY['42501']);
    PERFORM pg_temp.expect_error('SELECT public.vettrack_servicios()',ARRAY['42501']);
    PERFORM pg_temp.expect_error('SELECT public.vettrack_citas()',ARRAY['42501']);
    PERFORM pg_temp.expect_error('SELECT * FROM public.cita_servicio',ARRAY['42501']);
END; $$;
RESET ROLE;
DO $$ DECLARE relation text; endpoint record; BEGIN
    FOREACH relation IN ARRAY ARRAY['horario_medico','bloqueo_medico','servicio_especialidad','cita_servicio'] LOOP
        PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||relation)::regclass),'new table RLS enabled');
        PERFORM pg_temp.assert_true(NOT has_table_privilege('anon','public.'||relation,'SELECT'),'new tables closed to anon');
        PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.'||relation,'TRUNCATE'),'no authenticated TRUNCATE');
    END LOOP;
    FOR endpoint IN SELECT p.oid,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN('vettrack_medicos','vettrack_horarios','vettrack_bloqueos','vettrack_disponibilidad',
            'vettrack_guardar_horarios','vettrack_guardar_bloqueo','vettrack_eliminar_bloqueo','vettrack_servicios',
            'vettrack_guardar_servicio','vettrack_eliminar_servicio','vettrack_citas','vettrack_guardar_cita','vettrack_cancelar_cita','vettrack_selectores_citas') LOOP
        PERFORM pg_temp.assert_true(NOT endpoint.prosecdef AND NOT has_function_privilege('anon',endpoint.oid,'EXECUTE'),
            'public RPC wrappers are invokers and deny anonymous execution');
    END LOOP;
    RAISE NOTICE 'PASS multi-tenant reads, inactive users, anon denial, soft removal and function/table grants';
    RAISE NOTICE 'Phase 3 clinic operation SQL suite passed; rolling back all runtime fixtures';
END; $$;
ROLLBACK;
