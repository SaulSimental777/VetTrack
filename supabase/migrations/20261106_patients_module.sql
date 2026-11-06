-- Phase 1: patients. Prepared for review; do not apply automatically.
BEGIN;

-- Fail closed on policy drift before enabling writes. This is the canonical
-- expression inspected on yugbrcyrztwksiewzuvy; do not replace tenant_mascota.
DO $$
DECLARE
    expected_expression text := '(EXISTS ( SELECT 1 FROM dueno d WHERE ((d.id_dueno = mascota.id_dueno) AND (d.id_veterinaria = get_my_veterinaria()))))';
BEGIN
    IF (SELECT count(*) FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'mascota') <> 1
       OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'mascota'
          AND policyname = 'tenant_mascota' AND cmd = 'ALL'
          AND roles = ARRAY['authenticated']::name[] AND permissive = 'PERMISSIVE'
          AND regexp_replace(qual, '[[:space:]]', '', 'g') = regexp_replace(expected_expression, '[[:space:]]', '', 'g')
          AND regexp_replace(with_check, '[[:space:]]', '', 'g') = regexp_replace(expected_expression, '[[:space:]]', '', 'g')
    ) THEN
        RAISE EXCEPTION 'Unexpected mascota policies: review USING and WITH CHECK before granting writes';
    END IF;
END;
$$;

-- No backfill: the four historical patients keep their unknown values as NULL.
ALTER TABLE public.mascota
    ADD COLUMN IF NOT EXISTS especie varchar(100),
    ADD COLUMN IF NOT EXISTS sexo varchar(50),
    ADD COLUMN IF NOT EXISTS fecha_nacimiento date,
    ADD COLUMN IF NOT EXISTS peso_actual numeric(8,3),
    ADD COLUMN IF NOT EXISTS observaciones text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.mascota'::regclass AND conname = 'mascota_peso_actual_check') THEN
        ALTER TABLE public.mascota ADD CONSTRAINT mascota_peso_actual_check
        CHECK (peso_actual IS NULL OR (peso_actual > 0 AND peso_actual < 100000));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = 'public.mascota'::regclass AND c.confrelid = 'public.dueno'::regclass AND c.contype = 'f'
          AND c.conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.conrelid AND attname = 'id_dueno')]::smallint[]
          AND c.confkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.confrelid AND attname = 'id_dueno')]::smallint[]
    ) THEN
        ALTER TABLE public.mascota ADD CONSTRAINT mascota_id_dueno_fkey
        FOREIGN KEY (id_dueno) REFERENCES public.dueno(id_dueno);
    END IF;
END;
$$;
ALTER TABLE public.mascota ALTER COLUMN id_dueno SET NOT NULL;
CREATE INDEX IF NOT EXISTS mascota_id_dueno_idx ON public.mascota (id_dueno);

-- Closed modules cannot be queried by normal clients. Enforce safe deletion in
-- the database, including hidden dependencies and concurrent references.
-- Retain constraint names, update actions, validation and deferrability.
DO $$
DECLARE
    relation record;
    definition text;
BEGIN
    FOR relation IN
        SELECT c.conname, c.conrelid::regclass AS source_table, pg_catalog.pg_get_constraintdef(c.oid) AS definition
        FROM pg_catalog.pg_constraint c
        WHERE c.contype = 'f' AND c.confrelid = 'public.mascota'::regclass
          AND c.confdeltype IN ('c', 'n', 'd')
    LOOP
        definition := regexp_replace(relation.definition, 'ON DELETE (CASCADE|SET NULL|SET DEFAULT)', 'ON DELETE RESTRICT');
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', relation.source_table, relation.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', relation.source_table, relation.conname, definition);
    END LOOP;
END;
$$;

ALTER TABLE public.mascota ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.mascota FROM PUBLIC, anon, authenticated;
DO $$
DECLARE columns_sql text;
BEGIN
    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum) INTO columns_sql
    FROM pg_catalog.pg_attribute WHERE attrelid = 'public.mascota'::regclass AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.mascota FROM PUBLIC, anon, authenticated', columns_sql);
END;
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mascota TO authenticated;

COMMIT;
