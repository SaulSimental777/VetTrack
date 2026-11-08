-- Incremental hardening. Review and apply separately; no data is deleted.
BEGIN;

-- Fail closed if the historical tenant policy is absent. Do not reconstruct or
-- replace it from the older, incomplete migration history in this repository.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'mascota'
          AND policyname = 'tenant_mascota'
    ) THEN
        RAISE EXCEPTION 'Required policy public.mascota.tenant_mascota is missing; review the schema before applying hardening';
    END IF;
END;
$$;
DROP POLICY IF EXISTS "Permitir todo" ON public.mascota;

-- Remove inherited PUBLIC access as well as direct anon grants. Clear column
-- grants too: table-level REVOKE alone does not revoke those grants.
DO $$
DECLARE
    table_name text;
    columns_sql text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'dueno', 'mascota', 'cita', 'diagnostico', 'historialmedico',
        'receta', 'producto', 'servicio', 'pago', 'experto', 'promocion',
        'ubicacion', 'valoracion', 'perfilusuario', 'veterinaria',
        'metododepago', 'solicitudadopcion', 'refugio'
    ] LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon', table_name);
        SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
        INTO columns_sql FROM pg_catalog.pg_attribute
        WHERE attrelid = format('public.%I', table_name)::regclass
          AND attnum > 0 AND NOT attisdropped;
        EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon', columns_sql, table_name);

        -- Preserve the special authenticated grants from 20261025 unchanged.
        IF table_name NOT IN ('dueno', 'perfilusuario', 'veterinaria') THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', table_name);
            EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM authenticated', columns_sql, table_name);
            -- Only the current dashboard needs these tables, for reading.
            -- Unimplemented modules retain no client privileges.
            IF table_name IN ('mascota', 'cita', 'diagnostico') THEN
                EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', table_name);
            END IF;
        END IF;
    END LOOP;
END;
$$;

ALTER TABLE public.metododepago ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "permitir todo" ON public.metododepago;
DROP POLICY IF EXISTS authenticated_select_metododepago ON public.metododepago;
CREATE POLICY authenticated_select_metododepago ON public.metododepago
FOR SELECT TO authenticated USING (true);
GRANT SELECT ON TABLE public.metododepago TO authenticated;

DROP POLICY IF EXISTS "permitir todo" ON public.solicitudadopcion;
-- solicitudadopcion and refugio remain closed by the revocations above.

DO $$
DECLARE
    registration_function record;
BEGIN
    FOR registration_function IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'registrar_veterinaria'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', registration_function.signature);
    END LOOP;
END;
$$;
-- get_my_veterinaria(), service_role and auth schema are intentionally untouched.

-- Prevent concurrent writes between duplicate detection and constraint creation.
LOCK TABLE public.dueno IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE
    email_column smallint;
    tenant_column smallint;
    existing_constraint record;
    existing_index record;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.dueno
        WHERE id_veterinaria IS NOT NULL AND correo IS NOT NULL
        GROUP BY id_veterinaria, correo HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce owner email uniqueness: duplicate (id_veterinaria, correo) pairs exist; review data manually';
    END IF;

    SELECT attnum INTO STRICT email_column FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.dueno'::regclass AND attname = 'correo' AND NOT attisdropped;
    SELECT attnum INTO STRICT tenant_column FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.dueno'::regclass AND attname = 'id_veterinaria' AND NOT attisdropped;

    FOR existing_constraint IN
        SELECT conname FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.dueno'::regclass AND contype = 'u'
          AND conkey = ARRAY[email_column]::smallint[]
    LOOP
        EXECUTE format('ALTER TABLE public.dueno DROP CONSTRAINT %I', existing_constraint.conname);
    END LOOP;

    -- Also handle a legacy standalone UNIQUE index on correo, without CASCADE.
    FOR existing_index IN
        SELECT n.nspname, c.relname
        FROM pg_catalog.pg_index AS i
        JOIN pg_catalog.pg_class AS c ON c.oid = i.indexrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE i.indrelid = 'public.dueno'::regclass AND i.indisunique
          AND NOT i.indisprimary AND i.indnkeyatts = 1
          AND i.indkey[0] = email_column
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conindid = i.indexrelid)
    LOOP
        EXECUTE format('DROP INDEX %I.%I', existing_index.nspname, existing_index.relname);
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.dueno'::regclass AND contype = 'u'
          AND conkey = ARRAY[tenant_column, email_column]::smallint[]
    ) THEN
        ALTER TABLE public.dueno ADD CONSTRAINT dueno_tenant_correo_key
        UNIQUE (id_veterinaria, correo);
    END IF;
END;
$$;

COMMIT;
