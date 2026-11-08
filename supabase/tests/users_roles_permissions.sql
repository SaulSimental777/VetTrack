-- Run as postgres after Phase 2 or Phase 3, with psql -X -v ON_ERROR_STOP=1.
-- Fixtures and every successful write are rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(p_result boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_result IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', p_message; END IF; END;
$$;
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_state THEN RETURN; END IF;
        RAISE EXCEPTION 'Expected %, got %: %', p_state, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Expected error %, statement succeeded: %', p_state, p_sql;
END;
$$;
CREATE FUNCTION pg_temp.jwt(p_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('vettrack.test.' || p_name), 'role', 'authenticated')::text, true);
END;
$$;
-- Fixture helper is SECURITY INVOKER: only postgres can write Auth metadata.
CREATE FUNCTION pg_temp.state_capability(p_target text, p_actor text, p_activo boolean,
    p_expires timestamptz DEFAULT now() + interval '1 minute') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE auth.users SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
        'vettrack_state_change', jsonb_build_object('actor_id', current_setting('vettrack.test.' || p_actor),
        'activo', p_activo, 'nonce', current_setting('vettrack.test.state_token'), 'expires_at', p_expires))
    WHERE id = current_setting('vettrack.test.' || p_target)::uuid;
END;
$$;
DO $$
DECLARE key text; tenant_a uuid; tenant_b uuid; actor uuid;
BEGIN
    FOREACH key IN ARRAY ARRAY['tenant_a','tenant_b','admin','admin2','admin_b','rec','med','inactive','super',
        'owner','owner_b','patient','patient_b','appointment','diagnosis','specialty','specialty_b','new_rec','new_med','new_admin','forged','foreign_marker','expired','state_token'] LOOP
        PERFORM set_config('vettrack.test.' || key, gen_random_uuid()::text, true);
    END LOOP;
    tenant_a := current_setting('vettrack.test.tenant_a')::uuid;
    tenant_b := current_setting('vettrack.test.tenant_b')::uuid;
    actor := current_setting('vettrack.test.admin')::uuid;
    INSERT INTO public.veterinaria (id_veterinaria, nombre) VALUES (tenant_a, 'Phase2 A'), (tenant_b, 'Phase2 B');
    FOREACH key IN ARRAY ARRAY['admin','admin2','admin_b','rec','med','inactive','super','new_rec','new_med','new_admin','forged','foreign_marker','expired'] LOOP
        INSERT INTO auth.users (id, email, aud, role, created_at, raw_app_meta_data, raw_user_meta_data)
        VALUES (current_setting('vettrack.test.' || key)::uuid, current_setting('vettrack.test.' || key) || '@example.invalid',
            'authenticated', 'authenticated', CASE WHEN key = 'expired' THEN now() - interval '1 hour' ELSE now() END,
            CASE WHEN key = 'super' THEN '{"super_admin":true}'::jsonb
                 WHEN key = 'forged' THEN '{}'::jsonb
                 ELSE jsonb_build_object('vettrack_tenant_id', CASE WHEN key = 'foreign_marker' THEN tenant_b ELSE tenant_a END, 'vettrack_created_by', actor) END,
            jsonb_build_object('vettrack_tenant_id', tenant_a, 'vettrack_created_by', actor));
    END LOOP;
    INSERT INTO public.perfilusuario (id, nombre, rol, activo, id_veterinaria)
    SELECT current_setting('vettrack.test.' || users.key)::uuid, users.key,
        CASE WHEN users.key = 'rec' OR users.key = 'inactive' THEN 'recepcionista' WHEN users.key = 'med' THEN 'medico' ELSE 'admin' END,
        users.key <> 'inactive', CASE WHEN users.key = 'admin_b' THEN tenant_b ELSE tenant_a END
    FROM unnest(ARRAY['admin','admin2','admin_b','rec','med','inactive','super']) AS users(key);
    INSERT INTO public.dueno (id_dueno, nombre, id_veterinaria) VALUES
        (current_setting('vettrack.test.owner')::uuid, 'Owner A', tenant_a), (current_setting('vettrack.test.owner_b')::uuid, 'Owner B', tenant_b);
    INSERT INTO public.mascota (id_mascota, nombre, id_dueno) VALUES
        (current_setting('vettrack.test.patient')::uuid, 'Patient A', current_setting('vettrack.test.owner')::uuid),
        (current_setting('vettrack.test.patient_b')::uuid, 'Patient B', current_setting('vettrack.test.owner_b')::uuid);
    IF to_regprocedure('public.vettrack_guardar_cita(uuid,jsonb)') IS NOT NULL THEN
        INSERT INTO public.cita (id_cita,fecha,fecha_inicio,fecha_fin,id_dueno,id_mascota,id_veterinaria)
        VALUES (current_setting('vettrack.test.appointment')::uuid,now() AT TIME ZONE 'America/Tijuana',now(),now()+interval '30 minutes',
            current_setting('vettrack.test.owner')::uuid,current_setting('vettrack.test.patient')::uuid,tenant_a);
    ELSE
        INSERT INTO public.cita (id_cita,fecha,id_dueno,id_mascota,id_veterinaria)
        VALUES (current_setting('vettrack.test.appointment')::uuid,now(),current_setting('vettrack.test.owner')::uuid,current_setting('vettrack.test.patient')::uuid,tenant_a);
    END IF;
    INSERT INTO public.diagnostico (id_diagnostico,descripcion,id_dueno,id_mascota,id_veterinaria)
    VALUES (current_setting('vettrack.test.diagnosis')::uuid,'Clinical information',current_setting('vettrack.test.owner')::uuid,current_setting('vettrack.test.patient')::uuid,tenant_a);
    INSERT INTO public.especialidad (id_especialidad, nombre, id_veterinaria) VALUES
        (current_setting('vettrack.test.specialty')::uuid, 'General', tenant_a), (current_setting('vettrack.test.specialty_b')::uuid, 'Other clinic', tenant_b);
END;
$$;

-- Expected sets are independent of the stored defaults: a replaced key or an
-- accidental extra grant must fail even when the total count stays unchanged.
DO $$
DECLARE
    phase3 boolean := to_regprocedure('public.vettrack_guardar_cita(uuid,jsonb)') IS NOT NULL;
    phase4 boolean := to_regprocedure('public.vettrack_iniciar_consulta(uuid)') IS NOT NULL;
    expected_catalog text[] := ARRAY[
        'dashboard.ver','propietarios.ver','propietarios.crear','propietarios.editar','propietarios.eliminar',
        'pacientes.ver','pacientes.crear','pacientes.editar','pacientes.eliminar',
        'usuarios.ver','usuarios.crear','usuarios.editar','usuarios.desactivar','usuarios.permisos',
        'citas.ver','citas.crear','citas.editar','citas.cancelar','citas.asignar_medico',
        'consultas.ver','consultas.crear','consultas.editar','expediente.ver',
        'diagnosticos.ver','diagnosticos.crear','diagnosticos.editar','recetas.ver','recetas.crear','recetas.editar',
        'servicios.ver','servicios.administrar','horarios.ver','horarios.administrar',
        'inventario.ver','inventario.administrar','inventario.vender','proveedores.ver','proveedores.administrar',
        'compras.ver','compras.administrar','pagos.ver','pagos.crear','reportes.ver','configuracion.ver','configuracion.editar'
    ];
    expected_reception text[] := ARRAY[
        'dashboard.ver','propietarios.ver','propietarios.crear','propietarios.editar',
        'pacientes.ver','pacientes.crear','pacientes.editar','citas.ver','citas.crear','citas.editar','citas.cancelar','citas.asignar_medico',
        'servicios.ver','horarios.ver','inventario.ver','inventario.vender','pagos.ver','pagos.crear'
    ];
    expected_doctor text[] := ARRAY[
        'dashboard.ver','propietarios.ver','pacientes.ver','pacientes.crear','pacientes.editar','citas.ver','expediente.ver',
        'consultas.ver','consultas.crear','consultas.editar','diagnosticos.ver','diagnosticos.crear','diagnosticos.editar',
        'recetas.ver','recetas.crear','recetas.editar','inventario.ver'
    ];
BEGIN
    IF phase3 THEN
        expected_catalog := expected_catalog || ARRAY['medicos.ver','medicos.administrar','servicios.crear','servicios.editar','servicios.eliminar','servicios.editar_precio','citas.forzar_horario'];
        expected_reception := expected_reception || ARRAY['medicos.ver'];
        expected_doctor := expected_doctor || ARRAY['medicos.ver','horarios.ver','servicios.ver'];
    END IF;
    IF phase4 THEN
        expected_catalog := expected_catalog || ARRAY['consultas.finalizar','consultas.tomar_ajenas','consultas.reabrir',
            'tratamientos.ver','tratamientos.crear','tratamientos.editar','vacunas.ver','vacunas.crear','vacunas.editar',
            'desparasitacion.ver','desparasitacion.crear','desparasitacion.editar','estudios.ver','estudios.crear','estudios.editar',
            'orden_recepcion.ver','orden_recepcion.procesar'];
        expected_reception := expected_reception || ARRAY['orden_recepcion.ver','orden_recepcion.procesar'];
        expected_doctor := expected_doctor || ARRAY['consultas.finalizar','tratamientos.ver','tratamientos.crear','tratamientos.editar',
            'vacunas.ver','vacunas.crear','vacunas.editar','desparasitacion.ver','desparasitacion.crear','desparasitacion.editar',
            'estudios.ver','estudios.crear','estudios.editar','orden_recepcion.ver'];
    END IF;
    IF to_regprocedure('public.vettrack_inventario(text,jsonb)') IS NOT NULL THEN
        expected_catalog := expected_catalog || ARRAY['inventario.crear','inventario.editar','inventario.ajustar','inventario.movimientos','inventario.uso_clinico','proveedores.crear','proveedores.editar','compras.crear','compras.recibir','medicamentos.ver','venta_libre.ver','venta_libre.preparar','inventario.entregar'];
        expected_reception := expected_reception || ARRAY['medicamentos.ver','venta_libre.ver','venta_libre.preparar','inventario.entregar'];
        expected_doctor := expected_doctor || ARRAY['medicamentos.ver','inventario.uso_clinico'];
    END IF;
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.permiso) = CASE WHEN to_regprocedure('public.vettrack_inventario(text,jsonb)') IS NOT NULL THEN 82 WHEN phase4 THEN 69 WHEN phase3 THEN 52 ELSE 45 END, 'exact permission catalog count for the installed phase');
    PERFORM pg_temp.assert_true(ARRAY(SELECT clave FROM public.permiso ORDER BY clave) = ARRAY(SELECT unnest(expected_catalog) ORDER BY 1), 'exact permission catalog keys');
    PERFORM pg_temp.assert_true(ARRAY(SELECT clave FROM public.rol_permiso WHERE rol='admin' ORDER BY clave) = ARRAY(SELECT unnest(expected_catalog) ORDER BY 1), 'exact administrator defaults');
    PERFORM pg_temp.assert_true(ARRAY(SELECT clave FROM public.rol_permiso WHERE rol='recepcionista' ORDER BY clave) = ARRAY(SELECT unnest(expected_reception) ORDER BY 1), 'exact receptionist defaults');
    PERFORM pg_temp.assert_true(ARRAY(SELECT clave FROM public.rol_permiso WHERE rol='medico' ORDER BY clave) = ARRAY(SELECT unnest(expected_doctor) ORDER BY 1), 'exact doctor defaults');
END;
$$;
SELECT pg_temp.state_capability('admin','admin',false);

SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
DO $$
DECLARE row_count integer; created public.perfilusuario; permissions jsonb; owner_id uuid; patient_id uuid;
BEGIN
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.get_my_permissions()) = (SELECT count(*) FROM public.permiso), 'admin has all clinic permissions');
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.dueno) = 1 AND (SELECT count(*) FROM public.mascota) = 1, 'admin sees own tenant only');
    PERFORM pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.perfilusuario WHERE id = current_setting('vettrack.test.super')::uuid), 'accidental Superadmin profile is hidden');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_autorizar_usuario(current_setting('vettrack.test.admin_b')::uuid, 'usuarios.editar')$q$, 'P0002');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_autorizar_usuario(current_setting('vettrack.test.super')::uuid, 'usuarios.editar')$q$, 'P0002');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.admin')::uuid, false,current_setting('vettrack.test.state_token'))$q$, '23514');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_editar_usuario(current_setting('vettrack.test.admin')::uuid, 'Self downgrade', NULL, 'medico')$q$, '23514');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_permisos_usuario(current_setting('vettrack.test.admin')::uuid, '{"usuarios.ver":false}')$q$, '22023');
    PERFORM pg_temp.expect_error($q$UPDATE public.perfilusuario SET rol = 'admin' WHERE id = auth.uid()$q$, '42501');
    PERFORM pg_temp.expect_error($q$UPDATE public.perfilusuario SET id_veterinaria = current_setting('vettrack.test.tenant_b')::uuid WHERE id = auth.uid()$q$, '42501');
    PERFORM pg_temp.expect_error($q$UPDATE public.perfilusuario SET activo = false WHERE id = auth.uid()$q$, '42501');
    PERFORM pg_temp.expect_error($q$INSERT INTO public.usuario_permiso VALUES (auth.uid(), 'pacientes.eliminar', true, current_setting('vettrack.test.tenant_a')::uuid)$q$, '42501');
    PERFORM pg_temp.expect_error($q$INSERT INTO public.rol_permiso VALUES ('recepcionista', 'pacientes.eliminar')$q$, '42501');
    PERFORM pg_temp.expect_error($q$DELETE FROM public.dueno WHERE id_dueno = current_setting('vettrack.test.owner')::uuid$q$, '23503');
    PERFORM pg_temp.expect_error($q$INSERT INTO public.dueno (nombre,id_veterinaria) VALUES ('foreign',current_setting('vettrack.test.tenant_b')::uuid)$q$, '42501');
    PERFORM pg_temp.expect_error($q$UPDATE public.dueno SET id_veterinaria = current_setting('vettrack.test.tenant_b')::uuid WHERE id_dueno = current_setting('vettrack.test.owner')::uuid$q$, '42501');
    PERFORM pg_temp.expect_error($q$UPDATE public.mascota SET id_dueno = current_setting('vettrack.test.owner_b')::uuid WHERE id_mascota = current_setting('vettrack.test.patient')::uuid$q$, '42501');
    UPDATE public.mascota SET nombre = 'foreign' WHERE id_mascota = current_setting('vettrack.test.patient_b')::uuid;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    PERFORM pg_temp.assert_true(row_count = 0, 'foreign UUID update denied');
    INSERT INTO public.dueno (nombre,id_veterinaria) VALUES ('own',current_setting('vettrack.test.tenant_a')::uuid) RETURNING id_dueno INTO owner_id;
    INSERT INTO public.mascota (nombre,id_dueno) VALUES ('own',owner_id) RETURNING id_mascota INTO patient_id;
    UPDATE public.dueno SET nombre = 'updated' WHERE id_dueno = owner_id;
    UPDATE public.mascota SET nombre = 'updated' WHERE id_mascota = patient_id;
    DELETE FROM public.mascota WHERE id_mascota = patient_id;
    DELETE FROM public.dueno WHERE id_dueno = owner_id;
    PERFORM pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.dueno WHERE id_dueno = owner_id), 'admin CRUD works');

    created := public.vettrack_crear_usuario(current_setting('vettrack.test.new_rec')::uuid, 'New receptionist', '5550000000', 'recepcionista');
    PERFORM pg_temp.assert_true(created.rol = 'recepcionista' AND created.id_veterinaria = current_setting('vettrack.test.tenant_a')::uuid, 'create derives tenant');
    created := public.vettrack_crear_usuario(current_setting('vettrack.test.new_med')::uuid, 'New doctor', NULL, 'medico', ARRAY[current_setting('vettrack.test.specialty')::uuid]);
    PERFORM pg_temp.assert_true(EXISTS (SELECT 1 FROM public.medico_especialidad WHERE id_usuario = created.id), 'doctor specialties assigned');
    created := public.vettrack_crear_usuario(current_setting('vettrack.test.new_admin')::uuid, 'New administrator', NULL, 'admin');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_crear_usuario(current_setting('vettrack.test.forged')::uuid,'Forged',NULL,'recepcionista')$q$, '42501');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_crear_usuario(current_setting('vettrack.test.foreign_marker')::uuid,'Foreign',NULL,'recepcionista')$q$, '42501');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_crear_usuario(current_setting('vettrack.test.expired')::uuid,'Expired',NULL,'recepcionista')$q$, '42501');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_crear_usuario(current_setting('vettrack.test.rec')::uuid,'Existing',NULL,'recepcionista')$q$, '42501');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_editar_usuario(current_setting('vettrack.test.new_med')::uuid,'Doctor',NULL,'medico',ARRAY[current_setting('vettrack.test.specialty_b')::uuid])$q$, '42501');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_editar_usuario(current_setting('vettrack.test.new_med')::uuid,'Doctor',NULL,'recepcionista',ARRAY[current_setting('vettrack.test.specialty')::uuid])$q$, '22023');
    created := public.vettrack_editar_usuario(current_setting('vettrack.test.new_med')::uuid, 'Edited doctor', '123', 'medico', ARRAY[current_setting('vettrack.test.specialty')::uuid]);
    PERFORM pg_temp.assert_true(created.nombre = 'Edited doctor', 'profile edit works');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_permisos_usuario(current_setting('vettrack.test.rec')::uuid,'{"unknown.permission":true}')$q$, '22023');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_permisos_usuario(current_setting('vettrack.test.rec')::uuid,'{"usuarios.permisos":true}')$q$, '22023');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_permisos_usuario(current_setting('vettrack.test.rec')::uuid,'{"pagos.ver":"true"}')$q$, '22023');
    permissions := public.vettrack_permisos_usuario(current_setting('vettrack.test.rec')::uuid,'{"pacientes.eliminar":true,"pagos.ver":false}');
    PERFORM pg_temp.assert_true(permissions->'permisos_efectivos' ? 'pacientes.eliminar' AND NOT (permissions->'permisos_efectivos' ? 'pagos.ver'), 'override allow and deny win');
    permissions := public.vettrack_permisos_usuario(current_setting('vettrack.test.rec')::uuid,'{"pacientes.eliminar":null}');
    PERFORM pg_temp.assert_true(NOT (permissions->'overrides' ? 'pacientes.eliminar'), 'null removes one override');
    permissions := public.vettrack_permisos_usuario(current_setting('vettrack.test.rec')::uuid,'{}',true);
    PERFORM pg_temp.assert_true(permissions->'overrides' = '{}'::jsonb AND permissions->'permisos_efectivos' ? 'pagos.ver', 'restore removes all overrides');
    PERFORM public.vettrack_guardar_especialidad('Dermatology','Local specialty');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_guardar_especialidad('Foreign',NULL,current_setting('vettrack.test.specialty_b')::uuid)$q$, 'P0002');
    RAISE NOTICE 'Admin: tenant isolation, RPC membership, validation, override and owner/patient CRUD passed';
END;
$$;
RESET ROLE;

SELECT pg_temp.jwt('rec');
SET LOCAL ROLE authenticated;
DO $$
DECLARE affected integer; owner_id uuid; patient_id uuid;
BEGIN
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.get_my_permissions()) =
        CASE WHEN to_regprocedure('public.vettrack_inventario(text,jsonb)') IS NOT NULL THEN 25 WHEN to_regprocedure('public.vettrack_iniciar_consulta(uuid)') IS NOT NULL THEN 21 WHEN to_regprocedure('public.vettrack_guardar_cita(uuid,jsonb)') IS NOT NULL THEN 19 ELSE 18 END, 'receptionist defaults');
    PERFORM pg_temp.assert_true(public.has_permission('pacientes.editar') AND NOT public.has_permission('pacientes.eliminar') AND NOT public.has_permission('usuarios.ver'), 'receptionist default restrictions');
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.cita) = 1 AND NOT EXISTS (SELECT 1 FROM public.diagnostico), 'receptionist cannot bypass clinical permission through dashboard tables');
    DELETE FROM public.mascota WHERE id_mascota = current_setting('vettrack.test.patient')::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    PERFORM pg_temp.assert_true(affected = 0, 'receptionist direct DELETE patient denied');
    DELETE FROM public.dueno WHERE id_dueno = current_setting('vettrack.test.owner')::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    PERFORM pg_temp.assert_true(affected = 0, 'receptionist direct DELETE owner denied');
    INSERT INTO public.dueno (nombre,id_veterinaria) VALUES ('receptionist owner',current_setting('vettrack.test.tenant_a')::uuid) RETURNING id_dueno INTO owner_id;
    INSERT INTO public.mascota (nombre,id_dueno) VALUES ('receptionist patient',owner_id) RETURNING id_mascota INTO patient_id;
    UPDATE public.mascota SET nombre = 'updated by receptionist' WHERE id_mascota = patient_id;
    PERFORM pg_temp.assert_true(EXISTS (SELECT 1 FROM public.mascota WHERE id_mascota = patient_id AND nombre = 'updated by receptionist'), 'receptionist create/edit defaults');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_autorizar_usuario(current_setting('vettrack.test.admin')::uuid,'usuarios.editar')$q$, '42501');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.rec')::uuid,false)$q$, '42501');
    RAISE NOTICE 'Receptionist defaults and direct PostgREST-style DELETE restrictions passed';
END;
$$;
RESET ROLE;

SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
SELECT public.vettrack_permisos_usuario(current_setting('vettrack.test.med')::uuid,'{"propietarios.ver":false}');
SELECT public.vettrack_permisos_usuario(current_setting('vettrack.test.rec')::uuid,'{"usuarios.ver":true,"usuarios.editar":true,"usuarios.desactivar":true,"propietarios.eliminar":true}');
DO $$ BEGIN
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.new_rec')::uuid,false)$q$, '42501');
END; $$;
RESET ROLE;
SELECT pg_temp.state_capability('new_rec','rec',false);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.new_rec')::uuid,false,current_setting('vettrack.test.state_token'))$q$, '42501');
END; $$;
RESET ROLE;
SELECT pg_temp.state_capability('new_rec','admin',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.new_rec')::uuid,false,current_setting('vettrack.test.state_token'))$q$, '42501');
END; $$;
RESET ROLE;
SELECT pg_temp.state_capability('new_rec','admin',false,now() - interval '1 second');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.new_rec')::uuid,false,current_setting('vettrack.test.state_token'))$q$, '42501');
END; $$;
RESET ROLE;
SELECT pg_temp.state_capability('new_rec','admin',false,now() + interval '3 minutes');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.new_rec')::uuid,false,current_setting('vettrack.test.state_token'))$q$, '42501');
END; $$;
RESET ROLE;
SELECT pg_temp.state_capability('new_rec','admin',false);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.new_rec')::uuid,false,'wrong-nonce')$q$, '42501');
END; $$;
SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.new_rec')::uuid,false,current_setting('vettrack.test.state_token'));
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'vettrack_state_change' WHERE id = current_setting('vettrack.test.new_rec')::uuid;

SELECT pg_temp.jwt('med');
SET LOCAL ROLE authenticated;
DO $$
DECLARE own_patient uuid; affected integer;
BEGIN
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.get_my_permissions()) =
        CASE WHEN to_regprocedure('public.vettrack_inventario(text,jsonb)') IS NOT NULL THEN 35 WHEN to_regprocedure('public.vettrack_iniciar_consulta(uuid)') IS NOT NULL THEN 33 WHEN to_regprocedure('public.vettrack_guardar_cita(uuid,jsonb)') IS NOT NULL THEN 19 ELSE 16 END, 'doctor defaults minus owner override');
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.diagnostico) = 1, 'doctor clinical read permission preserved');
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.dueno) = 0 AND (SELECT count(*) FROM public.mascota) >= 1, 'patient access independent of propietarios.ver');
    PERFORM pg_temp.assert_true((SELECT count(*) FROM public.vettrack_propietarios_pacientes()) >= 1, 'minimal owner selector available');
    INSERT INTO public.mascota (nombre,id_dueno) VALUES ('Doctor patient',current_setting('vettrack.test.owner')::uuid) RETURNING id_mascota INTO own_patient;
    UPDATE public.mascota SET nombre = 'Doctor updated' WHERE id_mascota = own_patient;
    PERFORM pg_temp.assert_true(EXISTS (SELECT 1 FROM public.mascota WHERE id_mascota = own_patient AND nombre = 'Doctor updated'), 'doctor create/update without owners.ver');
    DELETE FROM public.mascota WHERE id_mascota = own_patient;
    GET DIAGNOSTICS affected = ROW_COUNT;
    PERFORM pg_temp.assert_true(affected = 0, 'doctor no delete default');
    PERFORM pg_temp.expect_error($q$INSERT INTO public.mascota (nombre,id_dueno) VALUES ('foreign',current_setting('vettrack.test.owner_b')::uuid)$q$, '42501');
    RAISE NOTICE 'Doctor permissions and independent patient tenant checks passed';
END;
$$;
RESET ROLE;

SELECT pg_temp.jwt('rec');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM public.vettrack_autorizar_usuario(current_setting('vettrack.test.admin')::uuid,'usuarios.ver');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_autorizar_usuario(current_setting('vettrack.test.admin')::uuid,'usuarios.editar')$q$, '42501');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_editar_usuario(current_setting('vettrack.test.med')::uuid,'Promotion',NULL,'admin')$q$, '42501');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_permisos_usuario(current_setting('vettrack.test.rec')::uuid,'{"pacientes.eliminar":true}')$q$, '42501');
    PERFORM pg_temp.expect_error($q$DELETE FROM public.dueno WHERE id_dueno = current_setting('vettrack.test.owner')::uuid$q$, '23503');
    PERFORM public.vettrack_editar_usuario(current_setting('vettrack.test.med')::uuid,'Delegated edit',NULL,'medico');
    RAISE NOTICE 'Delegated user actions cannot administer admins or bypass patient DELETE';
END;
$$;
RESET ROLE;

SELECT pg_temp.jwt('new_rec');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.assert_true(public.get_my_veterinaria() IS NULL AND NOT EXISTS(SELECT 1 FROM public.get_my_permissions()), 'inactive user loses old-JWT permissions');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dueno) AND NOT EXISTS(SELECT 1 FROM public.mascota) AND NOT EXISTS(SELECT 1 FROM public.perfilusuario), 'inactive JWT reads closed');
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_propietarios_pacientes()$q$, '42501');
END; $$;
RESET ROLE;
SELECT pg_temp.jwt('admin');
SELECT pg_temp.state_capability('new_rec','admin',true);
SELECT pg_temp.state_capability('admin2','admin',false);
SET LOCAL ROLE authenticated;
SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.new_rec')::uuid,true,current_setting('vettrack.test.state_token'));
SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.admin2')::uuid,false,current_setting('vettrack.test.state_token'));
RESET ROLE;
SELECT pg_temp.jwt('admin2');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.expect_error($q$SELECT public.vettrack_estado_usuario(current_setting('vettrack.test.admin')::uuid,false)$q$, '42501');
END; $$;
RESET ROLE;
SELECT pg_temp.jwt('new_rec');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.assert_true(public.get_my_veterinaria() = current_setting('vettrack.test.tenant_a')::uuid, 'reactivation restores current permissions');
END; $$;
RESET ROLE;
SELECT pg_temp.jwt('super');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM pg_temp.assert_true(public.get_my_veterinaria() IS NULL AND NOT EXISTS(SELECT 1 FROM public.get_my_permissions()), 'Superadmin never becomes clinic admin');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.perfilusuario), 'Superadmin clinic profile remains hidden');
END; $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
    PERFORM pg_temp.expect_error('SELECT * FROM public.get_my_permissions()', '42501');
    PERFORM pg_temp.expect_error('SELECT * FROM public.perfilusuario', '42501');
    PERFORM pg_temp.expect_error('SELECT * FROM public.permiso', '42501');
    PERFORM pg_temp.expect_error('SELECT * FROM public.mascota', '42501');
END; $$;
RESET ROLE;
DO $$ DECLARE relation text; privilege_name text; secured_function record; BEGIN
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('permiso','rol_permiso','usuario_permiso','especialidad','medico_especialidad') AND NOT c.relrowsecurity), 'all new public tables have RLS');
    PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.perfilusuario','TRUNCATE')
        AND NOT has_column_privilege('authenticated','public.perfilusuario','rol','UPDATE'), 'profile direct escalation grants absent');
    FOREACH relation IN ARRAY ARRAY['permiso','rol_permiso','usuario_permiso','especialidad','medico_especialidad'] LOOP
        FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'] LOOP
            PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated', format('public.%I', relation), privilege_name), 'new membership tables allow no direct mutations');
        END LOOP;
        PERFORM pg_temp.assert_true(NOT has_table_privilege('anon', format('public.%I', relation), 'SELECT'), 'new tables closed to anon');
    END LOOP;
    FOR secured_function IN SELECT p.oid, p.prosecdef, p.proconfig, n.nspname
        FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private' OR (n.nspname = 'public' AND p.proname IN (
            'get_my_veterinaria','get_my_permissions','has_permission','vettrack_propietarios_pacientes',
            'vettrack_autorizar_usuario','vettrack_crear_usuario','vettrack_editar_usuario',
            'vettrack_estado_usuario','vettrack_ver_permisos_usuario','vettrack_permisos_usuario','vettrack_guardar_especialidad')) LOOP
        PERFORM pg_temp.assert_true(NOT has_function_privilege('anon', secured_function.oid, 'EXECUTE'), 'no anonymous function execution');
        IF secured_function.nspname = 'public' THEN
            PERFORM pg_temp.assert_true(NOT secured_function.prosecdef, 'public wrappers are SECURITY INVOKER');
        ELSIF secured_function.prosecdef THEN
            PERFORM pg_temp.assert_true(secured_function.proconfig @> ARRAY['search_path=""'], 'private definers use an empty search path');
        END IF;
    END LOOP;
    RAISE NOTICE 'Phase 2 RLS/RPC suite passed; rolling back every fixture';
END; $$;
ROLLBACK;
