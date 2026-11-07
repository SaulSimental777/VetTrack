-- LOCAL ONLY: minimal verified pre-Phase-2 schema, not a production migration.
BEGIN;
DO $$ BEGIN
    IF current_database() NOT LIKE 'vettrack_phase2_%' THEN
        RAISE EXCEPTION 'This fixture only runs in a temporary vettrack_phase2_* database';
    END IF;
END; $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END; $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (
    id uuid PRIMARY KEY, aud varchar(255), role varchar(255), email varchar(255),
    raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
CREATE TABLE public.veterinaria (
    id_veterinaria uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre varchar(150) NOT NULL,
    direccion text, telefono varchar(20), correo varchar(100), horario varchar(100),
    valoracion numeric(2,1), foto_veterinaria text, descripcion text
);
CREATE TABLE public.perfilusuario (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre varchar(100), telefono varchar(20), rol varchar(20) DEFAULT 'user',
    creado_en timestamp DEFAULT now(), id_veterinaria uuid REFERENCES public.veterinaria(id_veterinaria),
    CONSTRAINT perfilusuario_rol_check CHECK (rol IN ('user', 'admin'))
);
CREATE TABLE public.dueno (
    id_dueno uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre varchar(100) NOT NULL,
    telefono varchar(20), correo varchar(100), direccion text, user_id uuid,
    fecha_registro timestamp DEFAULT now(), id_veterinaria uuid REFERENCES public.veterinaria(id_veterinaria),
    UNIQUE (id_veterinaria, correo)
);
CREATE TABLE public.mascota (
    id_mascota uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre varchar(100) NOT NULL,
    edad integer, raza varchar(100), foto_mascota text,
    id_dueno uuid NOT NULL REFERENCES public.dueno(id_dueno) ON UPDATE CASCADE ON DELETE CASCADE,
    especie varchar(100), sexo varchar(50), fecha_nacimiento date, peso_actual numeric(8,3), observaciones text,
    CONSTRAINT mascota_peso_actual_check CHECK (peso_actual IS NULL OR (peso_actual > 0 AND peso_actual < 100000))
);
CREATE INDEX mascota_id_dueno_idx ON public.mascota (id_dueno);
CREATE TABLE public.cita (
    id_cita uuid PRIMARY KEY DEFAULT gen_random_uuid(), fecha timestamp NOT NULL,
    estado varchar(50) DEFAULT 'Pendiente', id_mascota uuid REFERENCES public.mascota(id_mascota) ON DELETE RESTRICT,
    id_dueno uuid REFERENCES public.dueno(id_dueno), id_servicio uuid, id_veterinaria uuid REFERENCES public.veterinaria(id_veterinaria)
);
CREATE TABLE public.diagnostico (
    id_diagnostico uuid PRIMARY KEY DEFAULT gen_random_uuid(), fecha timestamp DEFAULT now(), descripcion text,
    id_mascota uuid REFERENCES public.mascota(id_mascota) ON DELETE RESTRICT,
    id_dueno uuid REFERENCES public.dueno(id_dueno), id_veterinaria uuid REFERENCES public.veterinaria(id_veterinaria)
);
CREATE TABLE public.metododepago (id_metodopago uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo varchar(50) NOT NULL, descripcion text);
DO $$ DECLARE name text; BEGIN
    FOREACH name IN ARRAY ARRAY['historialmedico','receta','producto','servicio','pago','experto','promocion','ubicacion','valoracion','solicitudadopcion','refugio'] LOOP
        EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid())', name);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
    END LOOP;
END; $$;
CREATE FUNCTION public.get_my_veterinaria() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p.id_veterinaria FROM public.perfilusuario AS p WHERE p.id = auth.uid();
$$;
ALTER TABLE public.veterinaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfilusuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dueno ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mascota ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cita ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metododepago ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_select_veterinaria ON public.veterinaria FOR SELECT TO authenticated
USING (id_veterinaria = public.get_my_veterinaria());
CREATE POLICY profile_select_own ON public.perfilusuario FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profile_update_own ON public.perfilusuario FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY tenant_crud_dueno ON public.dueno FOR ALL TO authenticated
USING (id_veterinaria = public.get_my_veterinaria()) WITH CHECK (id_veterinaria = public.get_my_veterinaria());
CREATE POLICY tenant_mascota ON public.mascota FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.dueno d WHERE d.id_dueno = mascota.id_dueno AND d.id_veterinaria = public.get_my_veterinaria()))
WITH CHECK (EXISTS (SELECT 1 FROM public.dueno d WHERE d.id_dueno = mascota.id_dueno AND d.id_veterinaria = public.get_my_veterinaria()));
CREATE POLICY tenant_cita ON public.cita FOR ALL TO authenticated
USING (id_veterinaria = public.get_my_veterinaria()) WITH CHECK (id_veterinaria = public.get_my_veterinaria());
CREATE POLICY tenant_diagnostico ON public.diagnostico FOR ALL TO authenticated
USING (id_veterinaria = public.get_my_veterinaria()) WITH CHECK (id_veterinaria = public.get_my_veterinaria());
CREATE POLICY authenticated_select_metododepago ON public.metododepago FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.veterinaria, public.perfilusuario TO authenticated;
GRANT UPDATE (nombre, telefono) ON public.perfilusuario TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dueno, public.mascota TO authenticated;
GRANT SELECT ON public.cita, public.diagnostico, public.metododepago TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
INSERT INTO public.veterinaria (id_veterinaria, nombre) VALUES ('10000000-0000-4000-8000-000000000001', 'Preserved clinic');
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
    ('20000000-0000-4000-8000-000000000001', 'preserved-1@example.invalid', '{}'),
    ('20000000-0000-4000-8000-000000000002', 'preserved-2@example.invalid', '{}');
INSERT INTO public.perfilusuario (id, nombre, telefono, rol, id_veterinaria) VALUES
    ('20000000-0000-4000-8000-000000000001', 'Preserved administrator', '5551234567', 'admin', '10000000-0000-4000-8000-000000000001'),
    ('20000000-0000-4000-8000-000000000002', 'Preserved administrator 2', NULL, 'admin', '10000000-0000-4000-8000-000000000001');
COMMIT;
