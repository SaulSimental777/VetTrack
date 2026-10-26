-- Run after 20261025_tenant_isolation.sql as postgres, in a dedicated SQL session.
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
BEGIN
    PERFORM set_config('vettrack.test.tenant_a', tenant_a::text, true);
    PERFORM set_config('vettrack.test.tenant_b', tenant_b::text, true);
    PERFORM set_config('vettrack.test.user_a', user_a::text, true);
    PERFORM set_config('vettrack.test.user_b', user_b::text, true);
    PERFORM set_config('vettrack.test.owner_a', owner_a::text, true);
    PERFORM set_config('vettrack.test.owner_b', owner_b::text, true);

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

    UPDATE public.perfilusuario SET nombre = 'Own profile update', telefono = '5550000000' WHERE id = auth.uid();
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN RAISE EXCEPTION 'Own permitted profile UPDATE failed'; END IF;
    UPDATE public.perfilusuario SET nombre = 'Foreign profile update' WHERE id = current_setting('vettrack.test.user_b')::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN RAISE EXCEPTION 'Foreign profile UPDATE succeeded'; END IF;

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
    RAISE NOTICE 'User B: reciprocal SELECT isolation passed';
END;
$$;

RESET ROLE;
ROLLBACK;
