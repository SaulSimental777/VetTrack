-- Phase 1 updates: PREPARED, NOT EXECUTED against Supabase.
-- Review before running on the approved project yugbrcyrztwksiewzuvy.
-- Requires the real schema, Phase 0 and 20261106_patients_module.sql applied.
-- Also supports the approved Phase 2 and Phase 3 schema and privilege changes.
-- Run as postgres in a dedicated session with psql ON_ERROR_STOP enabled.
-- Every fixture and successful test write is discarded by the final ROLLBACK.
BEGIN;

DO $$
DECLARE
    tenant_a uuid := gen_random_uuid();
    tenant_b uuid := gen_random_uuid();
    user_a uuid := gen_random_uuid();
    user_b uuid := gen_random_uuid();
    owner_a uuid := gen_random_uuid();
    owner_b uuid := gen_random_uuid();
    patient_a uuid := gen_random_uuid();
    patient_b uuid := gen_random_uuid();
    appointment_a uuid := gen_random_uuid();
    appointment_b uuid := gen_random_uuid();
    diagnosis_a uuid := gen_random_uuid();
    diagnosis_b uuid := gen_random_uuid();
BEGIN
    PERFORM set_config('vettrack.test.tenant_a', tenant_a::text, true);
    PERFORM set_config('vettrack.test.tenant_b', tenant_b::text, true);
    PERFORM set_config('vettrack.test.user_a', user_a::text, true);
    PERFORM set_config('vettrack.test.user_b', user_b::text, true);
    PERFORM set_config('vettrack.test.owner_a', owner_a::text, true);
    PERFORM set_config('vettrack.test.owner_b', owner_b::text, true);
    PERFORM set_config('vettrack.test.patient_a', patient_a::text, true);
    PERFORM set_config('vettrack.test.patient_b', patient_b::text, true);
    PERFORM set_config('vettrack.test.appointment_a', appointment_a::text, true);
    PERFORM set_config('vettrack.test.appointment_b', appointment_b::text, true);
    PERFORM set_config('vettrack.test.diagnosis_a', diagnosis_a::text, true);
    PERFORM set_config('vettrack.test.diagnosis_b', diagnosis_b::text, true);

    INSERT INTO public.veterinaria (id_veterinaria, nombre)
    VALUES (tenant_a, 'RLS test A'), (tenant_b, 'RLS test B');

    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES
        (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}'::jsonb, '{}'::jsonb),
        (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}'::jsonb, '{}'::jsonb);

    INSERT INTO public.perfilusuario (id, nombre, rol, id_veterinaria)
    VALUES (user_a, 'RLS user A', 'admin', tenant_a), (user_b, 'RLS user B', 'admin', tenant_b)
    ON CONFLICT (id) DO UPDATE SET rol = EXCLUDED.rol, id_veterinaria = EXCLUDED.id_veterinaria;

    INSERT INTO public.dueno (id_dueno, nombre, id_veterinaria)
    VALUES (owner_a, 'RLS owner A', tenant_a), (owner_b, 'RLS owner B', tenant_b);

    -- The same email must work across tenants, but not twice in one tenant.
    UPDATE public.dueno SET correo = user_a::text || '@example.invalid'
    WHERE id_dueno IN (owner_a, owner_b);
    BEGIN
        INSERT INTO public.dueno (nombre, id_veterinaria, correo)
        VALUES ('Duplicate email', tenant_a, user_a::text || '@example.invalid');
        RAISE EXCEPTION 'Duplicate owner email within one tenant was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    INSERT INTO public.mascota (id_mascota, nombre, id_dueno)
    VALUES (patient_a, 'Patient A', owner_a), (patient_b, 'Patient B', owner_b);

    IF to_regprocedure('public.vettrack_guardar_cita(uuid,jsonb)') IS NOT NULL THEN
        INSERT INTO public.cita (id_cita, fecha, fecha_inicio, fecha_fin, id_mascota, id_dueno, id_veterinaria)
        VALUES
            (appointment_a, timestamp '2030-01-01 10:00:00', timestamptz '2030-01-01 10:00:00 America/Tijuana', timestamptz '2030-01-01 10:30:00 America/Tijuana', patient_a, owner_a, tenant_a),
            (appointment_b, timestamp '2030-01-01 11:00:00', timestamptz '2030-01-01 11:00:00 America/Tijuana', timestamptz '2030-01-01 11:30:00 America/Tijuana', patient_b, owner_b, tenant_b);
    ELSE
        INSERT INTO public.cita (id_cita, fecha, id_mascota, id_dueno, id_veterinaria)
        VALUES
            (appointment_a, timestamp '2030-01-01 10:00:00', patient_a, owner_a, tenant_a),
            (appointment_b, timestamp '2030-01-01 11:00:00', patient_b, owner_b, tenant_b);
    END IF;
    INSERT INTO public.diagnostico (id_diagnostico, descripcion, id_mascota, id_dueno, id_veterinaria)
    VALUES
        (diagnosis_a, 'RLS diagnosis A', patient_a, owner_a, tenant_a),
        (diagnosis_b, 'RLS diagnosis B', patient_b, owner_b, tenant_b);
END;
$$;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('vettrack.test.user_a'), 'role', 'authenticated'
)::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    affected_rows integer;
    inserted_owner uuid;
    readonly_table record;
    visible_count integer;
    inserted_patient uuid;
BEGIN
    IF public.get_my_veterinaria() IS DISTINCT FROM current_setting('vettrack.test.tenant_a')::uuid THEN
        RAISE EXCEPTION 'Tenant lookup failed for user A';
    END IF;
    IF (SELECT count(*) FROM public.dueno) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.dueno WHERE id_dueno = current_setting('vettrack.test.owner_a')::uuid) THEN
        RAISE EXCEPTION 'Owner SELECT isolation failed';
    END IF;
    IF (SELECT count(*) FROM public.veterinaria) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.veterinaria WHERE id_veterinaria = current_setting('vettrack.test.tenant_a')::uuid) THEN
        RAISE EXCEPTION 'Veterinaria SELECT isolation failed';
    END IF;
    IF (SELECT count(*) FROM public.perfilusuario) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.perfilusuario WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Profile SELECT isolation failed';
    END IF;

    FOR readonly_table IN
        SELECT * FROM (VALUES
            ('mascota', 'id_mascota', 'patient_a', 'patient_b'),
            ('cita', 'id_cita', 'appointment_a', 'appointment_b'),
            ('diagnostico', 'id_diagnostico', 'diagnosis_a', 'diagnosis_b')
        ) AS tables(table_name, id_column, own_setting, foreign_setting)
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', readonly_table.table_name, readonly_table.id_column)
        INTO visible_count USING current_setting('vettrack.test.' || readonly_table.own_setting)::uuid;
        IF visible_count <> 1 THEN RAISE EXCEPTION 'Own SELECT failed on % for tenant A', readonly_table.table_name; END IF;
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', readonly_table.table_name, readonly_table.id_column)
        INTO visible_count USING current_setting('vettrack.test.' || readonly_table.foreign_setting)::uuid;
        IF visible_count <> 0 THEN RAISE EXCEPTION 'Foreign SELECT succeeded on % for tenant A', readonly_table.table_name; END IF;

        -- Patients now have CRUD; appointments and diagnoses remain read-only.
        IF readonly_table.table_name = 'mascota' THEN CONTINUE; END IF;
        -- These modules have no write privileges even for the user's own rows.
        -- A zero-row INSERT still requires INSERT, without needing extra fixtures.
        BEGIN
            EXECUTE format('INSERT INTO public.%I SELECT * FROM public.%I WHERE false', readonly_table.table_name, readonly_table.table_name);
            RAISE EXCEPTION 'INSERT did not fail on read-only table %', readonly_table.table_name;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        BEGIN
            EXECUTE format('UPDATE public.%I SET %I = %I WHERE %I = $1', readonly_table.table_name,
                readonly_table.id_column, readonly_table.id_column, readonly_table.id_column)
            USING current_setting('vettrack.test.' || readonly_table.own_setting)::uuid;
            RAISE EXCEPTION 'UPDATE did not fail on read-only table %', readonly_table.table_name;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        BEGIN
            EXECUTE format('DELETE FROM public.%I WHERE %I = $1', readonly_table.table_name, readonly_table.id_column)
            USING current_setting('vettrack.test.' || readonly_table.own_setting)::uuid;
            RAISE EXCEPTION 'DELETE did not fail on read-only table %', readonly_table.table_name;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
    END LOOP;
    -- The catalog must remain readable, even if it currently has no rows.
    PERFORM 1 FROM public.metododepago;

    -- Own patient CRUD is allowed; do not populate or change historical edad.
    INSERT INTO public.mascota (nombre, id_dueno, especie, sexo, fecha_nacimiento, peso_actual)
    VALUES ('Own patient', current_setting('vettrack.test.owner_a')::uuid, 'Gato', 'Hembra', date '2020-02-29', 3.5)
    RETURNING id_mascota INTO inserted_patient;
    IF NOT EXISTS (SELECT 1 FROM public.mascota WHERE id_mascota = inserted_patient) THEN
        RAISE EXCEPTION 'Own patient INSERT/SELECT failed';
    END IF;
    UPDATE public.mascota SET nombre = 'Own patient updated' WHERE id_mascota = inserted_patient;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN RAISE EXCEPTION 'Own patient UPDATE failed'; END IF;
    BEGIN
        INSERT INTO public.mascota (nombre, id_dueno)
        VALUES ('Foreign patient', current_setting('vettrack.test.owner_b')::uuid);
        RAISE EXCEPTION 'Patient INSERT under foreign owner succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.mascota SET id_dueno = current_setting('vettrack.test.owner_b')::uuid
        WHERE id_mascota = inserted_patient;
        RAISE EXCEPTION 'Patient reassignment to foreign owner succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE public.mascota SET nombre = 'Foreign update'
    WHERE id_mascota = current_setting('vettrack.test.patient_b')::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN RAISE EXCEPTION 'Foreign patient UPDATE succeeded'; END IF;
    DELETE FROM public.mascota WHERE id_mascota = current_setting('vettrack.test.patient_b')::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN RAISE EXCEPTION 'Foreign patient DELETE succeeded'; END IF;

    -- A visible owner in the same tenant is a valid reassignment target.
    INSERT INTO public.dueno (nombre, id_veterinaria)
    VALUES ('Second own owner', current_setting('vettrack.test.tenant_a')::uuid)
    RETURNING id_dueno INTO inserted_owner;
    UPDATE public.mascota SET id_dueno = inserted_owner WHERE id_mascota = inserted_patient;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN RAISE EXCEPTION 'Same-tenant patient reassignment failed'; END IF;
    DELETE FROM public.mascota WHERE id_mascota = inserted_patient;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN RAISE EXCEPTION 'Own patient DELETE failed'; END IF;
    DELETE FROM public.dueno WHERE id_dueno = inserted_owner;

    -- Dependencies must block deletion instead of CASCADE or SET NULL.
    BEGIN
        DELETE FROM public.mascota WHERE id_mascota = current_setting('vettrack.test.patient_a')::uuid;
        RAISE EXCEPTION 'Patient with clinical dependencies was deleted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    IF NOT EXISTS (SELECT 1 FROM public.cita WHERE id_cita = current_setting('vettrack.test.appointment_a')::uuid
                   AND id_mascota = current_setting('vettrack.test.patient_a')::uuid)
       OR NOT EXISTS (SELECT 1 FROM public.diagnostico WHERE id_diagnostico = current_setting('vettrack.test.diagnosis_a')::uuid
                      AND id_mascota = current_setting('vettrack.test.patient_a')::uuid) THEN
        RAISE EXCEPTION 'Patient dependencies were modified by deletion';
    END IF;

    UPDATE public.dueno SET nombre = 'Foreign update' WHERE id_dueno = current_setting('vettrack.test.owner_b')::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN RAISE EXCEPTION 'Foreign owner UPDATE succeeded'; END IF;
    DELETE FROM public.dueno WHERE id_dueno = current_setting('vettrack.test.owner_b')::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN RAISE EXCEPTION 'Foreign owner DELETE succeeded'; END IF;

    BEGIN
        INSERT INTO public.dueno (nombre, id_veterinaria)
        VALUES ('Foreign insert', current_setting('vettrack.test.tenant_b')::uuid);
        RAISE EXCEPTION 'Foreign owner INSERT succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.dueno SET id_veterinaria = current_setting('vettrack.test.tenant_b')::uuid
        WHERE id_dueno = current_setting('vettrack.test.owner_a')::uuid;
        RAISE EXCEPTION 'Owner tenant reassignment succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.perfilusuario SET rol = 'user' WHERE id = auth.uid();
        RAISE EXCEPTION 'Profile role UPDATE succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.perfilusuario SET id_veterinaria = current_setting('vettrack.test.tenant_b')::uuid WHERE id = auth.uid();
        RAISE EXCEPTION 'Profile tenant UPDATE succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.perfilusuario SET id = current_setting('vettrack.test.user_b')::uuid WHERE id = auth.uid();
        RAISE EXCEPTION 'Profile identity UPDATE succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO public.perfilusuario (id, rol, id_veterinaria)
        VALUES (auth.uid(), 'admin', current_setting('vettrack.test.tenant_b')::uuid);
        RAISE EXCEPTION 'Profile INSERT succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    INSERT INTO public.dueno (nombre, id_veterinaria)
    VALUES ('Own insert', current_setting('vettrack.test.tenant_a')::uuid)
    RETURNING id_dueno INTO inserted_owner;
    UPDATE public.dueno SET nombre = 'Own update' WHERE id_dueno = inserted_owner;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN RAISE EXCEPTION 'Own owner UPDATE failed'; END IF;
    DELETE FROM public.dueno WHERE id_dueno = inserted_owner;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN RAISE EXCEPTION 'Own owner DELETE failed'; END IF;

    IF to_regprocedure('public.vettrack_editar_usuario(uuid,text,text,text,uuid[])') IS NOT NULL THEN
        -- Phase 2 routes membership/profile changes through the checked RPC.
        BEGIN
            UPDATE public.perfilusuario SET nombre = 'Direct update' WHERE id = auth.uid();
            RAISE EXCEPTION 'Direct profile UPDATE bypassed user administration';
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        PERFORM public.vettrack_editar_usuario(auth.uid(), 'Own profile update', '5550000000', 'admin', ARRAY[]::uuid[]);
        IF NOT EXISTS (SELECT 1 FROM public.perfilusuario WHERE id = auth.uid() AND nombre = 'Own profile update') THEN
            RAISE EXCEPTION 'Authorized own profile RPC UPDATE failed';
        END IF;
        BEGIN
            PERFORM public.vettrack_editar_usuario(current_setting('vettrack.test.user_b')::uuid, 'Foreign profile update', NULL, 'admin', ARRAY[]::uuid[]);
            RAISE EXCEPTION 'Foreign profile RPC UPDATE succeeded';
        EXCEPTION WHEN no_data_found THEN NULL;
        END;
    ELSE
        UPDATE public.perfilusuario SET nombre = 'Own profile update', telefono = '5550000000' WHERE id = auth.uid();
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows <> 1 THEN RAISE EXCEPTION 'Own permitted profile UPDATE failed'; END IF;
        UPDATE public.perfilusuario SET nombre = 'Foreign profile update' WHERE id = current_setting('vettrack.test.user_b')::uuid;
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows <> 0 THEN RAISE EXCEPTION 'Foreign profile UPDATE succeeded'; END IF;
    END IF;

    IF has_table_privilege('authenticated', 'public.dueno', 'TRUNCATE')
       OR has_table_privilege('anon', 'public.dueno', 'TRUNCATE') THEN
        RAISE EXCEPTION 'TRUNCATE is still granted to a client role';
    END IF;
    RAISE NOTICE 'User A: isolation, rejected writes, and permitted CRUD passed';
END;
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
    'sub', current_setting('vettrack.test.user_b'), 'role', 'authenticated'
)::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    readonly_table record;
    visible_count integer;
BEGIN
    IF public.get_my_veterinaria() IS DISTINCT FROM current_setting('vettrack.test.tenant_b')::uuid
       OR (SELECT count(*) FROM public.dueno) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.dueno WHERE id_dueno = current_setting('vettrack.test.owner_b')::uuid)
       OR (SELECT count(*) FROM public.veterinaria) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.veterinaria WHERE id_veterinaria = current_setting('vettrack.test.tenant_b')::uuid)
       OR (SELECT count(*) FROM public.perfilusuario) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.perfilusuario WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Tenant B isolation failed';
    END IF;
    FOR readonly_table IN
        SELECT * FROM (VALUES
            ('mascota', 'id_mascota', 'patient_b', 'patient_a'),
            ('cita', 'id_cita', 'appointment_b', 'appointment_a'),
            ('diagnostico', 'id_diagnostico', 'diagnosis_b', 'diagnosis_a')
        ) AS tables(table_name, id_column, own_setting, foreign_setting)
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', readonly_table.table_name, readonly_table.id_column)
        INTO visible_count USING current_setting('vettrack.test.' || readonly_table.own_setting)::uuid;
        IF visible_count <> 1 THEN RAISE EXCEPTION 'Own SELECT failed on % for tenant B', readonly_table.table_name; END IF;
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', readonly_table.table_name, readonly_table.id_column)
        INTO visible_count USING current_setting('vettrack.test.' || readonly_table.foreign_setting)::uuid;
        IF visible_count <> 0 THEN RAISE EXCEPTION 'Foreign SELECT succeeded on % for tenant B', readonly_table.table_name; END IF;
    END LOOP;
    RAISE NOTICE 'User B: reciprocal SELECT isolation passed';
END;
$$;

RESET ROLE;

-- Check effective privileges, including inherited PUBLIC and column grants.
DO $$
DECLARE
    table_name text;
    privilege_name text;
    registration_function record;
    phase3 boolean := to_regprocedure('public.vettrack_guardar_cita(uuid,jsonb)') IS NOT NULL;
    phase4 boolean := to_regprocedure('public.vettrack_iniciar_consulta(uuid)') IS NOT NULL;
    read_only_tables text[] := ARRAY['cita', 'diagnostico', 'metododepago'];
    operational_tables text[] := ARRAY[]::text[];
BEGIN
    IF phase3 THEN
        operational_tables := ARRAY['horario_medico', 'bloqueo_medico', 'servicio_especialidad', 'cita_servicio'];
        read_only_tables := read_only_tables || ARRAY['servicio'] || operational_tables;
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_class
            WHERE oid = ANY(ARRAY['public.servicio'::regclass, 'public.horario_medico'::regclass, 'public.bloqueo_medico'::regclass,
                'public.servicio_especialidad'::regclass, 'public.cita_servicio'::regclass]) AND NOT relrowsecurity) THEN
            RAISE EXCEPTION 'A Phase 3 operational table lost RLS';
        END IF;
    END IF;
    IF phase4 THEN
        operational_tables := operational_tables || ARRAY['consulta','tratamiento','receta_detalle','vacunacion','desparasitacion','estudio_clinico','orden_recepcion','documento_clinico'];
        read_only_tables := read_only_tables || ARRAY['consulta','tratamiento','receta','receta_detalle','vacunacion','desparasitacion','estudio_clinico','orden_recepcion'];
    END IF;
    IF to_regprocedure('public.vettrack_inventario(text,jsonb)') IS NOT NULL THEN
        operational_tables := operational_tables || ARRAY['proveedor','compra','compra_detalle','venta_preparada','venta_preparada_detalle','movimiento_inventario'];
    END IF;
    IF to_regclass('public.lote_inventario') IS NOT NULL THEN
        operational_tables := operational_tables || ARRAY['lote_inventario','recepcion_compra_detalle','movimiento_lote'];
    END IF;
    FOREACH table_name IN ARRAY ARRAY[
        'dueno', 'mascota', 'cita', 'diagnostico', 'historialmedico', 'receta',
        'producto', 'servicio', 'pago', 'experto', 'promocion', 'ubicacion',
        'valoracion', 'perfilusuario', 'veterinaria', 'metododepago', 'solicitudadopcion', 'refugio'
    ] || operational_tables LOOP
        FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'] LOOP
            IF has_table_privilege('anon', format('public.%I', table_name), privilege_name) THEN
                RAISE EXCEPTION 'anon still has % on %', privilege_name, table_name;
            END IF;
        END LOOP;
        FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
            IF has_any_column_privilege('anon', format('public.%I', table_name), privilege_name) THEN
                RAISE EXCEPTION 'anon still has column privilege % on %', privilege_name, table_name;
            END IF;
        END LOOP;
    END LOOP;

    -- dueno and mascota retain CRUD; every other module is read-only or closed.
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF NOT has_table_privilege('authenticated', 'public.dueno', privilege_name) THEN
            RAISE EXCEPTION 'authenticated lost % on dueno', privilege_name;
        END IF;
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY[
        'mascota', 'cita', 'diagnostico', 'metododepago', 'historialmedico',
        'receta', 'producto', 'servicio', 'pago', 'experto', 'promocion',
        'ubicacion', 'valoracion', 'solicitudadopcion', 'refugio'
    ] || operational_tables LOOP
        FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'] LOOP
            IF has_table_privilege('authenticated', format('public.%I', table_name), privilege_name)
               IS DISTINCT FROM (
                   (table_name = 'mascota' AND privilege_name IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
                   OR (table_name = ANY(read_only_tables) AND privilege_name = 'SELECT')
               ) THEN
                RAISE EXCEPTION 'Unexpected authenticated privilege % on %', privilege_name, table_name;
            END IF;
        END LOOP;
        FOREACH privilege_name IN ARRAY ARRAY['INSERT', 'UPDATE', 'REFERENCES'] LOOP
            IF has_any_column_privilege('authenticated', format('public.%I', table_name), privilege_name)
               AND NOT (table_name = 'mascota' AND privilege_name IN ('INSERT', 'UPDATE')) THEN
                RAISE EXCEPTION 'Unexpected authenticated column privilege % on %', privilege_name, table_name;
            END IF;
        END LOOP;
        IF table_name <> 'mascota' AND NOT (table_name = ANY(read_only_tables))
           AND has_any_column_privilege('authenticated', format('public.%I', table_name), 'SELECT') THEN
            RAISE EXCEPTION 'Closed table % still has column SELECT', table_name;
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
               WHERE contype = 'f' AND confrelid = 'public.mascota'::regclass
                 AND confdeltype NOT IN ('a', 'r')) THEN
        RAISE EXCEPTION 'A patient dependency still permits destructive delete propagation';
    END IF;

    FOR registration_function IN
        SELECT p.oid FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'registrar_veterinaria'
    LOOP
        IF has_function_privilege('anon', registration_function.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', registration_function.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'Client can execute registrar_veterinaria overload %', registration_function.oid;
        END IF;
    END LOOP;
    IF has_function_privilege('anon', 'public.get_my_veterinaria()', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.get_my_veterinaria()', 'EXECUTE') THEN
        RAISE EXCEPTION 'Unexpected get_my_veterinaria execute privileges';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public'
        AND tablename = 'mascota' AND policyname = 'Permitir todo') THEN
        RAISE EXCEPTION 'Unexpected mascota policies after hardening';
    END IF;
    IF to_regprocedure('public.get_my_permissions()') IS NOT NULL THEN
        IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'mascota') <> 4
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'mascota'
               AND (policyname NOT IN ('patients_select', 'patients_insert', 'patients_update', 'patients_delete')
                    OR roles <> ARRAY['authenticated']::name[])) THEN
            RAISE EXCEPTION 'Expected four permission-aware patient policies in Phase 2';
        END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public'
        AND tablename = 'mascota' AND policyname = 'tenant_mascota') THEN
        RAISE EXCEPTION 'Original tenant policy is missing in Phase 1';
    END IF;
    RAISE NOTICE 'Client privilege checks passed';
END;
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM public.mascota;
        RAISE EXCEPTION 'anon could read patients';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;
RESET ROLE;
ROLLBACK;
