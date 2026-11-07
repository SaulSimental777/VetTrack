-- Phase 2. Review before applying to the remote project.
BEGIN;

LOCK TABLE public.perfilusuario IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.perfilusuario'::regclass AND conname = 'perfilusuario_roles_clinica_check') THEN
        IF EXISTS (SELECT 1 FROM public.perfilusuario WHERE rol IS DISTINCT FROM 'admin') THEN
            RAISE EXCEPTION 'Legacy profiles must all be admin; review incompatible roles before applying Phase 2';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.perfilusuario WHERE rol IS NULL OR rol NOT IN ('admin', 'recepcionista', 'medico')) THEN
        RAISE EXCEPTION 'Incompatible clinic roles; review profiles before applying Phase 2';
    END IF;
END;
$$;

ALTER TABLE public.perfilusuario
    ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public.perfilusuario
    ALTER COLUMN activo SET DEFAULT true,
    ALTER COLUMN activo SET NOT NULL,
    ALTER COLUMN rol SET DEFAULT 'recepcionista',
    ALTER COLUMN rol SET NOT NULL;
ALTER TABLE public.perfilusuario DROP CONSTRAINT IF EXISTS perfilusuario_rol_check;
ALTER TABLE public.perfilusuario DROP CONSTRAINT IF EXISTS perfilusuario_roles_clinica_check;
ALTER TABLE public.perfilusuario ADD CONSTRAINT perfilusuario_roles_clinica_check
    CHECK (rol IN ('admin', 'recepcionista', 'medico'));
CREATE UNIQUE INDEX IF NOT EXISTS perfilusuario_id_tenant_key ON public.perfilusuario (id, id_veterinaria);
CREATE INDEX IF NOT EXISTS perfilusuario_tenant_rol_activo_idx ON public.perfilusuario (id_veterinaria, rol, activo);
CREATE INDEX IF NOT EXISTS dueno_id_veterinaria_idx ON public.dueno (id_veterinaria);

-- Owner deletion must not bypass pacientes.eliminar through an FK cascade.
DO $$
DECLARE relation record; definition text;
BEGIN
    FOR relation IN SELECT c.conname, pg_catalog.pg_get_constraintdef(c.oid) AS definition
        FROM pg_catalog.pg_constraint AS c WHERE c.conrelid = 'public.mascota'::regclass
          AND c.confrelid = 'public.dueno'::regclass AND c.contype = 'f' AND c.confdeltype IN ('c', 'n', 'd') LOOP
        definition := regexp_replace(relation.definition, 'ON DELETE (CASCADE|SET NULL|SET DEFAULT)', 'ON DELETE RESTRICT');
        EXECUTE format('ALTER TABLE public.mascota DROP CONSTRAINT %I', relation.conname);
        EXECUTE format('ALTER TABLE public.mascota ADD CONSTRAINT %I %s', relation.conname, definition);
    END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS public.permiso (
    clave text PRIMARY KEY,
    modulo text NOT NULL,
    accion text NOT NULL,
    descripcion text NOT NULL,
    CONSTRAINT permiso_clave_check CHECK (clave = modulo || '.' || accion)
);
CREATE TABLE IF NOT EXISTS public.rol_permiso (
    rol varchar(20) NOT NULL CHECK (rol IN ('admin', 'recepcionista', 'medico')),
    clave text NOT NULL REFERENCES public.permiso(clave) ON DELETE CASCADE,
    PRIMARY KEY (rol, clave)
);
CREATE TABLE IF NOT EXISTS public.usuario_permiso (
    id_usuario uuid NOT NULL,
    clave text NOT NULL REFERENCES public.permiso(clave),
    permitido boolean NOT NULL,
    id_veterinaria uuid NOT NULL REFERENCES public.veterinaria(id_veterinaria),
    PRIMARY KEY (id_usuario, clave),
    FOREIGN KEY (id_usuario, id_veterinaria) REFERENCES public.perfilusuario(id, id_veterinaria) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS usuario_permiso_tenant_idx ON public.usuario_permiso (id_veterinaria);
CREATE INDEX IF NOT EXISTS rol_permiso_clave_idx ON public.rol_permiso (clave);
CREATE INDEX IF NOT EXISTS usuario_permiso_clave_idx ON public.usuario_permiso (clave);
CREATE TABLE IF NOT EXISTS public.especialidad (
    id_especialidad uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre varchar(100) NOT NULL CHECK (btrim(nombre) <> ''),
    descripcion text CHECK (descripcion IS NULL OR length(descripcion) <= 2000),
    id_veterinaria uuid NOT NULL REFERENCES public.veterinaria(id_veterinaria),
    UNIQUE (id_especialidad, id_veterinaria)
);
CREATE UNIQUE INDEX IF NOT EXISTS especialidad_tenant_nombre_key ON public.especialidad (id_veterinaria, lower(btrim(nombre)));
CREATE TABLE IF NOT EXISTS public.medico_especialidad (
    id_usuario uuid NOT NULL,
    id_especialidad uuid NOT NULL,
    id_veterinaria uuid NOT NULL REFERENCES public.veterinaria(id_veterinaria),
    PRIMARY KEY (id_usuario, id_especialidad),
    FOREIGN KEY (id_usuario, id_veterinaria) REFERENCES public.perfilusuario(id, id_veterinaria) ON DELETE CASCADE,
    FOREIGN KEY (id_especialidad, id_veterinaria) REFERENCES public.especialidad(id_especialidad, id_veterinaria) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS medico_especialidad_especialidad_tenant_idx ON public.medico_especialidad (id_especialidad, id_veterinaria);
CREATE INDEX IF NOT EXISTS medico_especialidad_tenant_idx ON public.medico_especialidad (id_veterinaria);

INSERT INTO public.permiso (clave, modulo, accion, descripcion)
SELECT module || '.' || action, module, action, description
FROM (VALUES
    ('dashboard', 'ver', 'Ver el dashboard'),
    ('propietarios', 'ver', 'Ver propietarios'), ('propietarios', 'crear', 'Crear propietarios'),
    ('propietarios', 'editar', 'Editar propietarios'), ('propietarios', 'eliminar', 'Eliminar propietarios'),
    ('pacientes', 'ver', 'Ver pacientes'), ('pacientes', 'crear', 'Crear pacientes'),
    ('pacientes', 'editar', 'Editar pacientes'), ('pacientes', 'eliminar', 'Eliminar pacientes'),
    ('usuarios', 'ver', 'Ver usuarios de la clínica'), ('usuarios', 'crear', 'Crear usuarios de la clínica'),
    ('usuarios', 'editar', 'Editar usuarios de la clínica'), ('usuarios', 'desactivar', 'Activar o desactivar usuarios'),
    ('usuarios', 'permisos', 'Personalizar permisos; reservado a administradores'),
    ('citas', 'ver', 'Ver citas'), ('citas', 'crear', 'Crear citas'), ('citas', 'editar', 'Editar citas'),
    ('citas', 'cancelar', 'Cancelar citas'), ('citas', 'asignar_medico', 'Asignar médico a citas'),
    ('consultas', 'ver', 'Ver consultas'), ('consultas', 'crear', 'Crear consultas'), ('consultas', 'editar', 'Editar consultas'),
    ('expediente', 'ver', 'Ver expedientes'),
    ('diagnosticos', 'ver', 'Ver diagnósticos'), ('diagnosticos', 'crear', 'Crear diagnósticos'), ('diagnosticos', 'editar', 'Editar diagnósticos'),
    ('recetas', 'ver', 'Ver recetas'), ('recetas', 'crear', 'Crear recetas'), ('recetas', 'editar', 'Editar recetas'),
    ('servicios', 'ver', 'Ver servicios'), ('servicios', 'administrar', 'Administrar servicios'),
    ('horarios', 'ver', 'Ver horarios'), ('horarios', 'administrar', 'Administrar horarios'),
    ('inventario', 'ver', 'Ver inventario'), ('inventario', 'administrar', 'Administrar inventario'), ('inventario', 'vender', 'Vender inventario'),
    ('proveedores', 'ver', 'Ver proveedores'), ('proveedores', 'administrar', 'Administrar proveedores'),
    ('compras', 'ver', 'Ver compras'), ('compras', 'administrar', 'Administrar compras'),
    ('pagos', 'ver', 'Ver pagos'), ('pagos', 'crear', 'Crear pagos'),
    ('reportes', 'ver', 'Ver reportes'),
    ('configuracion', 'ver', 'Ver configuración'), ('configuracion', 'editar', 'Editar configuración')
) AS catalog(module, action, description)
ON CONFLICT (clave) DO UPDATE SET modulo = EXCLUDED.modulo, accion = EXCLUDED.accion, descripcion = EXCLUDED.descripcion;

INSERT INTO public.rol_permiso (rol, clave)
SELECT 'admin', clave FROM public.permiso
UNION ALL
SELECT 'recepcionista', unnest(ARRAY[
    'dashboard.ver', 'propietarios.ver', 'propietarios.crear', 'propietarios.editar',
    'pacientes.ver', 'pacientes.crear', 'pacientes.editar',
    'citas.ver', 'citas.crear', 'citas.editar', 'citas.cancelar', 'citas.asignar_medico',
    'servicios.ver', 'horarios.ver', 'inventario.ver', 'inventario.vender', 'pagos.ver', 'pagos.crear'
])
UNION ALL
SELECT 'medico', unnest(ARRAY[
    'dashboard.ver', 'propietarios.ver', 'pacientes.ver', 'pacientes.crear', 'pacientes.editar',
    'citas.ver', 'expediente.ver', 'consultas.ver', 'consultas.crear', 'consultas.editar',
    'diagnosticos.ver', 'diagnosticos.crear', 'diagnosticos.editar',
    'recetas.ver', 'recetas.crear', 'recetas.editar', 'inventario.ver'
])
ON CONFLICT DO NOTHING;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Read current Auth metadata, not stale JWT claims or editable user_metadata.
CREATE OR REPLACE FUNCTION private.is_superadmin(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = p_id
        AND coalesce(u.raw_app_meta_data, '{}'::jsonb) @> '{"super_admin":true}'::jsonb);
$$;
CREATE OR REPLACE FUNCTION private.my_veterinaria()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p.id_veterinaria FROM public.perfilusuario AS p
    WHERE p.id = (SELECT auth.uid()) AND p.activo AND p.rol IN ('admin', 'recepcionista', 'medico')
      AND NOT private.is_superadmin(p.id);
$$;
CREATE OR REPLACE FUNCTION private.my_permissions()
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT permission.clave
    FROM public.perfilusuario AS profile
    CROSS JOIN public.permiso AS permission
    LEFT JOIN public.rol_permiso AS role_permission ON role_permission.rol = profile.rol AND role_permission.clave = permission.clave
    LEFT JOIN public.usuario_permiso AS override_permission ON override_permission.id_usuario = profile.id AND override_permission.clave = permission.clave
    WHERE profile.id = (SELECT auth.uid()) AND profile.activo AND profile.id_veterinaria IS NOT NULL
      AND NOT private.is_superadmin(profile.id)
      AND (profile.rol = 'admin' OR (profile.rol IN ('recepcionista', 'medico')
           AND permission.clave <> 'usuarios.permisos'
           AND coalesce(override_permission.permitido, role_permission.clave IS NOT NULL)))
    ORDER BY permission.clave;
$$;
CREATE OR REPLACE FUNCTION private.has_permission(p_clave text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM private.my_permissions() AS permission WHERE permission = p_clave);
$$;
CREATE OR REPLACE FUNCTION public.get_my_veterinaria()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.my_veterinaria();
$$;
CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS SETOF text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.my_permissions();
$$;
CREATE OR REPLACE FUNCTION public.has_permission(p_clave text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.has_permission(p_clave);
$$;
CREATE OR REPLACE FUNCTION private.owner_in_my_tenant(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.dueno AS d WHERE d.id_dueno = p_id AND d.id_veterinaria = private.my_veterinaria());
$$;
CREATE OR REPLACE FUNCTION private.profile_in_my_tenant(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.perfilusuario AS p WHERE p.id = p_id
        AND p.id_veterinaria = private.my_veterinaria() AND NOT private.is_superadmin(p.id));
$$;
CREATE OR REPLACE FUNCTION private.patient_owners()
RETURNS TABLE(id_dueno uuid, nombre varchar(100)) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF private.my_veterinaria() IS NULL OR NOT (private.has_permission('pacientes.ver')
        OR private.has_permission('pacientes.crear') OR private.has_permission('pacientes.editar')) THEN
        RAISE EXCEPTION 'Permiso de pacientes requerido' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT d.id_dueno, d.nombre FROM public.dueno AS d WHERE d.id_veterinaria = private.my_veterinaria() ORDER BY d.nombre, d.id_dueno;
END;
$$;
CREATE OR REPLACE FUNCTION public.vettrack_propietarios_pacientes()
RETURNS TABLE(id_dueno uuid, nombre varchar(100)) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT * FROM private.patient_owners();
$$;

-- Serialize clinic membership changes on the clinic row, then recheck the actor.
CREATE OR REPLACE FUNCTION private.lock_actor(p_permiso text)
RETURNS public.perfilusuario LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.perfilusuario;
BEGIN
    SELECT p.* INTO actor FROM public.perfilusuario AS p WHERE p.id = auth.uid();
    IF actor.id IS NULL OR actor.id_veterinaria IS NULL THEN
        RAISE EXCEPTION 'Perfil de clínica requerido' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.veterinaria AS v WHERE v.id_veterinaria = actor.id_veterinaria FOR UPDATE;
    SELECT p.* INTO actor FROM public.perfilusuario AS p WHERE p.id = auth.uid() FOR UPDATE;
    IF NOT coalesce(actor.activo, false) OR private.is_superadmin(actor.id) OR NOT private.has_permission(p_permiso) THEN
        RAISE EXCEPTION 'Permiso requerido: %', p_permiso USING ERRCODE = '42501';
    END IF;
    IF p_permiso = 'usuarios.permisos' AND actor.rol <> 'admin' THEN
        RAISE EXCEPTION 'Solo administradores personalizan permisos' USING ERRCODE = '42501';
    END IF;
    RETURN actor;
END;
$$;
CREATE OR REPLACE FUNCTION private.authorize_target(p_id uuid, p_permiso text)
RETURNS public.perfilusuario LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.perfilusuario; target public.perfilusuario;
BEGIN
    IF p_permiso NOT IN ('usuarios.ver', 'usuarios.editar', 'usuarios.desactivar', 'usuarios.permisos') OR p_permiso IS NULL THEN
        RAISE EXCEPTION 'Operación de usuario inválida' USING ERRCODE = '22023';
    END IF;
    actor := private.lock_actor(p_permiso);
    SELECT p.* INTO target FROM public.perfilusuario AS p
    WHERE p.id = p_id AND p.id_veterinaria = actor.id_veterinaria AND NOT private.is_superadmin(p.id) FOR UPDATE;
    IF target.id IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = 'P0002'; END IF;
    IF p_permiso <> 'usuarios.ver' AND target.rol = 'admin' AND actor.rol <> 'admin' THEN
        RAISE EXCEPTION 'Solo administradores administran administradores' USING ERRCODE = '42501';
    END IF;
    RETURN target;
END;
$$;
CREATE OR REPLACE FUNCTION public.vettrack_autorizar_usuario(p_id uuid, p_permiso text)
RETURNS public.perfilusuario LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT * FROM private.authorize_target(p_id, p_permiso);
$$;
CREATE OR REPLACE FUNCTION private.validate_profile(p_nombre text, p_telefono text, p_rol text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
    IF p_nombre IS NULL OR btrim(p_nombre) = '' OR length(btrim(p_nombre)) > 100
       OR length(p_telefono) > 20 OR p_rol IS NULL OR p_rol NOT IN ('admin', 'recepcionista', 'medico') THEN
        RAISE EXCEPTION 'Nombre, teléfono o rol inválido' USING ERRCODE = '22023';
    END IF;
END;
$$;
CREATE OR REPLACE FUNCTION private.set_specialties(p_target public.perfilusuario, p_especialidades uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF cardinality(coalesce(p_especialidades, ARRAY[]::uuid[])) > 50
       OR (p_target.rol <> 'medico' AND cardinality(coalesce(p_especialidades, ARRAY[]::uuid[])) > 0) THEN
        RAISE EXCEPTION 'Especialidades inválidas para el rol' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(coalesce(p_especialidades, ARRAY[]::uuid[])) AS requested(id)
        WHERE requested.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.especialidad AS e
            WHERE e.id_especialidad = requested.id AND e.id_veterinaria = p_target.id_veterinaria)) THEN
        RAISE EXCEPTION 'Especialidad fuera de la clínica' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.medico_especialidad WHERE id_usuario = p_target.id;
    INSERT INTO public.medico_especialidad (id_usuario, id_especialidad, id_veterinaria)
    SELECT p_target.id, id, p_target.id_veterinaria FROM unnest(coalesce(p_especialidades, ARRAY[]::uuid[])) AS requested(id)
    ON CONFLICT DO NOTHING;
END;
$$;
CREATE OR REPLACE FUNCTION private.set_overrides(p_target public.perfilusuario, p_overrides jsonb, p_restaurar boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE requested record;
BEGIN
    IF p_target.rol = 'admin' THEN
        RAISE EXCEPTION 'Los permisos de administradores no son personalizables' USING ERRCODE = '22023';
    END IF;
    IF p_overrides IS NULL OR jsonb_typeof(p_overrides) <> 'object' OR p_restaurar IS NULL THEN
        RAISE EXCEPTION 'Overrides debe ser un objeto' USING ERRCODE = '22023';
    END IF;
    FOR requested IN SELECT key, value FROM jsonb_each(p_overrides) LOOP
        IF NOT EXISTS (SELECT 1 FROM public.permiso AS p WHERE p.clave = requested.key)
           OR jsonb_typeof(requested.value) NOT IN ('boolean', 'null')
           OR (requested.key = 'usuarios.permisos' AND requested.value = 'true'::jsonb) THEN
            RAISE EXCEPTION 'Permiso u override inválido: %', requested.key USING ERRCODE = '22023';
        END IF;
    END LOOP;
    IF p_restaurar THEN DELETE FROM public.usuario_permiso WHERE id_usuario = p_target.id; END IF;
    FOR requested IN SELECT key, value FROM jsonb_each(p_overrides) LOOP
        IF requested.value = 'null'::jsonb THEN
            DELETE FROM public.usuario_permiso WHERE id_usuario = p_target.id AND clave = requested.key;
        ELSE
            INSERT INTO public.usuario_permiso (id_usuario, clave, permitido, id_veterinaria)
            VALUES (p_target.id, requested.key, requested.value = 'true'::jsonb, p_target.id_veterinaria)
            ON CONFLICT (id_usuario, clave) DO UPDATE SET permitido = EXCLUDED.permitido;
        END IF;
    END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION private.create_user(p_id uuid, p_nombre text, p_telefono text, p_rol text, p_especialidades uuid[], p_overrides jsonb)
RETURNS public.perfilusuario LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.perfilusuario; target public.perfilusuario;
BEGIN
    actor := private.lock_actor('usuarios.crear');
    PERFORM private.validate_profile(p_nombre, p_telefono, p_rol);
    IF p_rol = 'admin' AND actor.rol <> 'admin' THEN
        RAISE EXCEPTION 'Solo administradores crean administradores' USING ERRCODE = '42501';
    END IF;
    IF p_overrides IS NULL OR jsonb_typeof(p_overrides) <> 'object' THEN
        RAISE EXCEPTION 'Overrides debe ser un objeto' USING ERRCODE = '22023';
    END IF;
    IF p_overrides <> '{}'::jsonb AND (actor.rol <> 'admin' OR p_rol = 'admin') THEN
        RAISE EXCEPTION 'No puede asignar permisos personalizados a este usuario' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.perfilusuario AS p WHERE p.id = p_id) OR NOT EXISTS (
        SELECT 1 FROM auth.users AS u WHERE u.id = p_id AND NOT private.is_superadmin(u.id)
          AND u.created_at >= statement_timestamp() - interval '15 minutes'
          AND u.raw_app_meta_data ->> 'vettrack_tenant_id' = actor.id_veterinaria::text
          AND u.raw_app_meta_data ->> 'vettrack_created_by' = actor.id::text
    ) THEN
        RAISE EXCEPTION 'Auth user no autorizado para vincular a esta clínica' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.perfilusuario (id, nombre, telefono, rol, id_veterinaria, activo)
    VALUES (p_id, btrim(p_nombre), nullif(btrim(p_telefono), ''), p_rol, actor.id_veterinaria, true)
    RETURNING * INTO target;
    PERFORM private.set_specialties(target, p_especialidades);
    IF p_overrides <> '{}'::jsonb THEN PERFORM private.set_overrides(target, p_overrides, false); END IF;
    RETURN target;
END;
$$;
CREATE OR REPLACE FUNCTION public.vettrack_crear_usuario(
    p_id uuid, p_nombre text, p_telefono text, p_rol text,
    p_especialidades uuid[] DEFAULT ARRAY[]::uuid[], p_overrides jsonb DEFAULT '{}'::jsonb
)
RETURNS public.perfilusuario LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT * FROM private.create_user(p_id, p_nombre, p_telefono, p_rol, p_especialidades, p_overrides);
$$;
CREATE OR REPLACE FUNCTION private.edit_user(p_id uuid, p_nombre text, p_telefono text, p_rol text, p_especialidades uuid[])
RETURNS public.perfilusuario LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.perfilusuario; actor public.perfilusuario;
BEGIN
    target := private.authorize_target(p_id, 'usuarios.editar');
    SELECT p.* INTO actor FROM public.perfilusuario AS p WHERE p.id = auth.uid();
    PERFORM private.validate_profile(p_nombre, p_telefono, p_rol);
    IF p_rol = 'admin' AND actor.rol <> 'admin' THEN
        RAISE EXCEPTION 'Solo administradores asignan el rol admin' USING ERRCODE = '42501';
    END IF;
    IF target.rol = 'admin' AND p_rol <> 'admin' THEN
        IF target.id = actor.id OR (target.activo AND NOT EXISTS (SELECT 1 FROM public.perfilusuario AS p
            WHERE p.id_veterinaria = target.id_veterinaria AND p.rol = 'admin' AND p.activo
              AND p.id <> target.id AND NOT private.is_superadmin(p.id))) THEN
            RAISE EXCEPTION 'No puede degradarse a sí mismo ni eliminar al último administrador activo' USING ERRCODE = '23514';
        END IF;
    END IF;
    UPDATE public.perfilusuario SET nombre = btrim(p_nombre), telefono = nullif(btrim(p_telefono), ''), rol = p_rol
    WHERE id = target.id RETURNING * INTO target;
    IF target.rol = 'admin' THEN DELETE FROM public.usuario_permiso WHERE id_usuario = target.id; END IF;
    PERFORM private.set_specialties(target, p_especialidades);
    RETURN target;
END;
$$;
CREATE OR REPLACE FUNCTION public.vettrack_editar_usuario(p_id uuid, p_nombre text, p_telefono text, p_rol text, p_especialidades uuid[] DEFAULT ARRAY[]::uuid[])
RETURNS public.perfilusuario LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT * FROM private.edit_user(p_id, p_nombre, p_telefono, p_rol, p_especialidades);
$$;
DROP FUNCTION IF EXISTS public.vettrack_estado_usuario(uuid, boolean);
DROP FUNCTION IF EXISTS private.set_user_state(uuid, boolean);
CREATE OR REPLACE FUNCTION private.set_user_state(p_id uuid, p_activo boolean, p_token text)
RETURNS public.perfilusuario LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.perfilusuario; capability jsonb; expires_at timestamptz;
BEGIN
    target := private.authorize_target(p_id, 'usuarios.desactivar');
    IF p_activo IS NULL THEN RAISE EXCEPTION 'Estado requerido' USING ERRCODE = '22023'; END IF;
    -- Only the backend can issue this Auth app_metadata capability, while also
    -- coordinating ban/unban. Authenticated callers cannot forge it in public.
    SELECT u.raw_app_meta_data -> 'vettrack_state_change' INTO capability FROM auth.users AS u WHERE u.id = target.id;
    BEGIN
        expires_at := (capability ->> 'expires_at')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
        RAISE EXCEPTION 'Autorización temporal de Auth inválida' USING ERRCODE = '42501';
    END;
    IF p_token IS NULL OR p_token = '' OR capability IS NULL OR expires_at IS NULL
       OR capability ->> 'actor_id' IS DISTINCT FROM auth.uid()::text
       OR capability -> 'activo' IS DISTINCT FROM to_jsonb(p_activo)
       OR capability ->> 'nonce' IS DISTINCT FROM p_token
       OR expires_at < statement_timestamp() OR expires_at > statement_timestamp() + interval '2 minutes' THEN
        RAISE EXCEPTION 'Cambio de estado requiere autorización temporal de Auth del backend' USING ERRCODE = '42501';
    END IF;
    IF NOT p_activo AND target.rol = 'admin' THEN
        IF target.id = auth.uid() OR (target.activo AND NOT EXISTS (SELECT 1 FROM public.perfilusuario AS p
            WHERE p.id_veterinaria = target.id_veterinaria AND p.rol = 'admin' AND p.activo
              AND p.id <> target.id AND NOT private.is_superadmin(p.id))) THEN
            RAISE EXCEPTION 'No puede desactivarse a sí mismo ni desactivar al último administrador activo' USING ERRCODE = '23514';
        END IF;
    END IF;
    UPDATE public.perfilusuario SET activo = p_activo WHERE id = target.id RETURNING * INTO target;
    RETURN target;
END;
$$;
CREATE OR REPLACE FUNCTION public.vettrack_estado_usuario(p_id uuid, p_activo boolean, p_token text DEFAULT NULL)
RETURNS public.perfilusuario LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT * FROM private.set_user_state(p_id, p_activo, p_token);
$$;
CREATE OR REPLACE FUNCTION private.user_permissions(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.perfilusuario; role_permissions jsonb; overrides jsonb; effective jsonb;
BEGIN
    target := private.authorize_target(p_id, 'usuarios.permisos');
    SELECT coalesce(jsonb_agg(r.clave ORDER BY r.clave), '[]'::jsonb) INTO role_permissions
    FROM public.rol_permiso AS r WHERE r.rol = target.rol;
    SELECT coalesce(jsonb_object_agg(u.clave, u.permitido), '{}'::jsonb) INTO overrides
    FROM public.usuario_permiso AS u WHERE u.id_usuario = target.id AND target.rol <> 'admin';
    SELECT coalesce(jsonb_agg(p.clave ORDER BY p.clave), '[]'::jsonb) INTO effective
    FROM public.permiso AS p
    LEFT JOIN public.rol_permiso AS r ON r.rol = target.rol AND r.clave = p.clave
    LEFT JOIN public.usuario_permiso AS u ON u.id_usuario = target.id AND u.clave = p.clave
    WHERE target.activo AND (target.rol = 'admin' OR (p.clave <> 'usuarios.permisos' AND coalesce(u.permitido, r.clave IS NOT NULL)));
    RETURN jsonb_build_object('rol', target.rol, 'permisos_rol', role_permissions, 'overrides', overrides, 'permisos_efectivos', effective);
END;
$$;
CREATE OR REPLACE FUNCTION public.vettrack_ver_permisos_usuario(p_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.user_permissions(p_id);
$$;
CREATE OR REPLACE FUNCTION private.update_user_permissions(p_id uuid, p_overrides jsonb, p_restaurar boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.perfilusuario;
BEGIN
    target := private.authorize_target(p_id, 'usuarios.permisos');
    PERFORM private.set_overrides(target, p_overrides, p_restaurar);
    RETURN private.user_permissions(target.id);
END;
$$;
CREATE OR REPLACE FUNCTION public.vettrack_permisos_usuario(p_id uuid, p_overrides jsonb DEFAULT '{}'::jsonb, p_restaurar boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT private.update_user_permissions(p_id, p_overrides, p_restaurar);
$$;
CREATE OR REPLACE FUNCTION private.save_specialty(p_nombre text, p_descripcion text, p_id uuid)
RETURNS public.especialidad LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor public.perfilusuario; specialty public.especialidad;
BEGIN
    actor := private.lock_actor(CASE WHEN p_id IS NULL THEN 'usuarios.crear' ELSE 'usuarios.editar' END);
    IF p_nombre IS NULL OR btrim(p_nombre) = '' OR length(btrim(p_nombre)) > 100 OR length(p_descripcion) > 2000 THEN
        RAISE EXCEPTION 'Nombre o descripción de especialidad inválidos' USING ERRCODE = '22023';
    END IF;
    IF p_id IS NULL THEN
        INSERT INTO public.especialidad (nombre, descripcion, id_veterinaria)
        VALUES (btrim(p_nombre), nullif(btrim(p_descripcion), ''), actor.id_veterinaria) RETURNING * INTO specialty;
    ELSE
        UPDATE public.especialidad SET nombre = btrim(p_nombre), descripcion = nullif(btrim(p_descripcion), '')
        WHERE id_especialidad = p_id AND id_veterinaria = actor.id_veterinaria RETURNING * INTO specialty;
        IF specialty.id_especialidad IS NULL THEN RAISE EXCEPTION 'Especialidad no encontrada' USING ERRCODE = 'P0002'; END IF;
    END IF;
    RETURN specialty;
END;
$$;
CREATE OR REPLACE FUNCTION public.vettrack_guardar_especialidad(p_nombre text, p_descripcion text DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS public.especialidad LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT * FROM private.save_specialty(p_nombre, p_descripcion, p_id);
$$;

-- No direct writes to membership, roles, overrides or specialties through REST.
DO $$
DECLARE item record; columns_sql text; table_name text;
BEGIN
    FOR item IN SELECT schemaname, tablename, policyname FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename IN ('perfilusuario', 'permiso', 'rol_permiso', 'usuario_permiso', 'especialidad', 'medico_especialidad', 'dueno', 'mascota') LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I', item.policyname, item.schemaname, item.tablename);
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY['perfilusuario', 'permiso', 'rol_permiso', 'usuario_permiso', 'especialidad', 'medico_especialidad', 'dueno', 'mascota'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
        SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum) INTO columns_sql
        FROM pg_catalog.pg_attribute WHERE attrelid = format('public.%I', table_name)::regclass AND attnum > 0 AND NOT attisdropped;
        EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated', columns_sql, table_name);
    END LOOP;
END;
$$;
GRANT SELECT ON TABLE public.perfilusuario, public.permiso, public.rol_permiso, public.usuario_permiso, public.especialidad, public.medico_especialidad TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dueno, public.mascota TO authenticated;

CREATE POLICY clinic_select_profiles ON public.perfilusuario FOR SELECT TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()) AND private.profile_in_my_tenant(id)
    AND (id = (SELECT auth.uid()) OR (SELECT public.has_permission('usuarios.ver'))));
CREATE POLICY clinic_select_permissions ON public.permiso FOR SELECT TO authenticated
USING ((SELECT public.get_my_veterinaria()) IS NOT NULL);
CREATE POLICY clinic_select_role_permissions ON public.rol_permiso FOR SELECT TO authenticated
USING ((SELECT public.get_my_veterinaria()) IS NOT NULL);
CREATE POLICY clinic_select_user_permissions ON public.usuario_permiso FOR SELECT TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()) AND private.profile_in_my_tenant(id_usuario)
    AND (id_usuario = (SELECT auth.uid()) OR (SELECT public.has_permission('usuarios.permisos'))));
CREATE POLICY clinic_select_specialties ON public.especialidad FOR SELECT TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()) AND (
    (SELECT public.has_permission('usuarios.ver')) OR (SELECT public.has_permission('usuarios.crear'))
    OR (SELECT public.has_permission('usuarios.editar')) OR (SELECT public.has_permission('usuarios.desactivar')) OR (SELECT public.has_permission('usuarios.permisos'))));
CREATE POLICY clinic_select_doctor_specialties ON public.medico_especialidad FOR SELECT TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()) AND private.profile_in_my_tenant(id_usuario)
    AND (id_usuario = (SELECT auth.uid()) OR (SELECT public.has_permission('usuarios.ver'))
    OR (SELECT public.has_permission('usuarios.crear')) OR (SELECT public.has_permission('usuarios.editar'))
    OR (SELECT public.has_permission('usuarios.desactivar')) OR (SELECT public.has_permission('usuarios.permisos'))));

CREATE POLICY owners_select ON public.dueno FOR SELECT TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('propietarios.ver')));
CREATE POLICY owners_insert ON public.dueno FOR INSERT TO authenticated
WITH CHECK (id_veterinaria = (SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('propietarios.crear')));
CREATE POLICY owners_update ON public.dueno FOR UPDATE TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('propietarios.editar')))
WITH CHECK (id_veterinaria = (SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('propietarios.editar')));
CREATE POLICY owners_delete ON public.dueno FOR DELETE TO authenticated
USING (id_veterinaria = (SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('propietarios.eliminar')));

-- Tenant lookup intentionally bypasses dueno SELECT permissions, not tenant checks.
CREATE POLICY patients_select ON public.mascota FOR SELECT TO authenticated
USING (private.owner_in_my_tenant(id_dueno) AND (SELECT public.has_permission('pacientes.ver')));
CREATE POLICY patients_insert ON public.mascota FOR INSERT TO authenticated
WITH CHECK (private.owner_in_my_tenant(id_dueno) AND (SELECT public.has_permission('pacientes.crear')));
CREATE POLICY patients_update ON public.mascota FOR UPDATE TO authenticated
USING (private.owner_in_my_tenant(id_dueno) AND (SELECT public.has_permission('pacientes.editar')))
WITH CHECK (private.owner_in_my_tenant(id_dueno) AND (SELECT public.has_permission('pacientes.editar')));
CREATE POLICY patients_delete ON public.mascota FOR DELETE TO authenticated
USING (private.owner_in_my_tenant(id_dueno) AND (SELECT public.has_permission('pacientes.eliminar')));

-- Existing dashboard read access also needs its functional permission.
DROP POLICY IF EXISTS phase2_select_citas_permission ON public.cita;
CREATE POLICY phase2_select_citas_permission ON public.cita AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT public.has_permission('citas.ver')));
DROP POLICY IF EXISTS phase2_select_diagnosticos_permission ON public.diagnostico;
CREATE POLICY phase2_select_diagnosticos_permission ON public.diagnostico AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT public.has_permission('diagnosticos.ver')));

REVOKE ALL ON FUNCTION private.is_superadmin(uuid), private.my_veterinaria(), private.my_permissions(), private.has_permission(text),
    private.owner_in_my_tenant(uuid), private.profile_in_my_tenant(uuid), private.patient_owners(), private.lock_actor(text),
    private.authorize_target(uuid, text), private.validate_profile(text, text, text),
    private.set_specialties(public.perfilusuario, uuid[]), private.set_overrides(public.perfilusuario, jsonb, boolean),
    private.create_user(uuid, text, text, text, uuid[], jsonb), private.edit_user(uuid, text, text, text, uuid[]),
    private.set_user_state(uuid, boolean, text), private.user_permissions(uuid), private.update_user_permissions(uuid, jsonb, boolean),
    private.save_specialty(text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.my_veterinaria(), private.my_permissions(), private.has_permission(text),
    private.owner_in_my_tenant(uuid), private.profile_in_my_tenant(uuid), private.patient_owners(),
    private.authorize_target(uuid, text), private.create_user(uuid, text, text, text, uuid[], jsonb),
    private.edit_user(uuid, text, text, text, uuid[]), private.set_user_state(uuid, boolean, text), private.user_permissions(uuid),
    private.update_user_permissions(uuid, jsonb, boolean), private.save_specialty(text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_veterinaria(), public.get_my_permissions(), public.has_permission(text),
    public.vettrack_propietarios_pacientes(), public.vettrack_autorizar_usuario(uuid, text),
    public.vettrack_crear_usuario(uuid, text, text, text, uuid[], jsonb), public.vettrack_editar_usuario(uuid, text, text, text, uuid[]),
    public.vettrack_estado_usuario(uuid, boolean, text), public.vettrack_ver_permisos_usuario(uuid),
    public.vettrack_permisos_usuario(uuid, jsonb, boolean), public.vettrack_guardar_especialidad(text, text, uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_veterinaria(), public.get_my_permissions(), public.has_permission(text),
    public.vettrack_propietarios_pacientes(), public.vettrack_autorizar_usuario(uuid, text),
    public.vettrack_crear_usuario(uuid, text, text, text, uuid[], jsonb), public.vettrack_editar_usuario(uuid, text, text, text, uuid[]),
    public.vettrack_estado_usuario(uuid, boolean, text), public.vettrack_ver_permisos_usuario(uuid),
    public.vettrack_permisos_usuario(uuid, jsonb, boolean), public.vettrack_guardar_especialidad(text, text, uuid)
TO authenticated;

COMMIT;
