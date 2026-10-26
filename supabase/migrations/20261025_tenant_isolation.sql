BEGIN;

ALTER TABLE public.dueno ADD COLUMN IF NOT EXISTS id_veterinaria uuid;
ALTER TABLE public.perfilusuario ADD COLUMN IF NOT EXISTS id_veterinaria uuid;

-- Reuse equivalent foreign keys, including those with older names.
DO $$
DECLARE
    relation record;
BEGIN
    FOR relation IN
        SELECT * FROM (VALUES
            ('dueno', 'id_veterinaria', 'public', 'veterinaria', 'id_veterinaria', 'fk_dueno_veterinaria'),
            ('perfilusuario', 'id_veterinaria', 'public', 'veterinaria', 'id_veterinaria', 'fk_perfilusuario_veterinaria'),
            ('perfilusuario', 'id', 'auth', 'users', 'id', 'fk_perfilusuario_auth')
        ) AS relations(table_name, column_name, target_schema, target_table, target_column, constraint_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_constraint AS constraint_definition
            JOIN pg_catalog.pg_attribute AS source_column
              ON source_column.attrelid = constraint_definition.conrelid
             AND source_column.attname = relation.column_name
            JOIN pg_catalog.pg_attribute AS target_column
              ON target_column.attrelid = constraint_definition.confrelid
             AND target_column.attname = relation.target_column
            WHERE constraint_definition.contype = 'f'
              AND constraint_definition.conrelid = pg_catalog.to_regclass(format('public.%I', relation.table_name))
              AND constraint_definition.confrelid = pg_catalog.to_regclass(format('%I.%I', relation.target_schema, relation.target_table))
              AND constraint_definition.conkey = ARRAY[source_column.attnum]::smallint[]
              AND constraint_definition.confkey = ARRAY[target_column.attnum]::smallint[]
        ) THEN
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I (%I)%s',
                relation.table_name, relation.constraint_name, relation.column_name,
                relation.target_schema, relation.target_table, relation.target_column,
                CASE WHEN relation.target_schema = 'auth' THEN ' ON DELETE CASCADE' ELSE '' END
            );
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_veterinaria()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT profile.id_veterinaria
    FROM public.perfilusuario AS profile
    WHERE profile.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_veterinaria() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_veterinaria() TO authenticated, service_role;

-- Tenant creation is restricted to the backend's service-role client.
DO $$
DECLARE
    registration_function record;
BEGIN
    FOR registration_function IN
        SELECT procedure.oid::regprocedure AS signature
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public' AND procedure.proname = 'registrar_veterinaria'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', registration_function.signature);
    END LOOP;
END;
$$;

ALTER TABLE public.dueno ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfilusuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veterinaria ENABLE ROW LEVEL SECURITY;

-- Permissive policies combine with OR, so replace every policy in this scope.
DO $$
DECLARE
    existing_policy record;
    protected_table text;
    column_names text;
BEGIN
    FOR existing_policy IN
        SELECT tablename, policyname FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename IN ('dueno', 'perfilusuario', 'veterinaria')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', existing_policy.policyname, existing_policy.tablename);
    END LOOP;

    FOREACH protected_table IN ARRAY ARRAY['dueno', 'perfilusuario', 'veterinaria']
    LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', protected_table);
        SELECT string_agg(format('%I', column_definition.attname), ', ' ORDER BY column_definition.attnum)
        INTO column_names
        FROM pg_catalog.pg_attribute AS column_definition
        WHERE column_definition.attrelid = pg_catalog.to_regclass(format('public.%I', protected_table))
          AND column_definition.attnum > 0 AND NOT column_definition.attisdropped;
        EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated', column_names, protected_table);
        EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', protected_table);
    END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dueno TO authenticated;
GRANT SELECT ON TABLE public.veterinaria, public.perfilusuario TO authenticated;
GRANT UPDATE (nombre, telefono) ON TABLE public.perfilusuario TO authenticated;

CREATE POLICY tenant_crud_dueno ON public.dueno
FOR ALL TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()))
WITH CHECK (id_veterinaria = (SELECT public.get_my_veterinaria()));

CREATE POLICY tenant_select_veterinaria ON public.veterinaria
FOR SELECT TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()));

CREATE POLICY profile_select_own ON public.perfilusuario
FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY profile_update_own ON public.perfilusuario
FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

COMMIT;
