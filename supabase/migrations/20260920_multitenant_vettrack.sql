-- ============================================================
-- VetTrack - Configuracion Multi-Tenant
-- Migracion: 20260920_multitenant_vettrack
-- ============================================================

-- ============================================================
-- 1. AGREGAR RELACION DE TENANT A DUENO
-- ============================================================

ALTER TABLE public.dueno
ADD COLUMN IF NOT EXISTS id_veterinaria uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_dueno_veterinaria'
    ) THEN
        ALTER TABLE public.dueno
        ADD CONSTRAINT fk_dueno_veterinaria
        FOREIGN KEY (id_veterinaria)
        REFERENCES public.veterinaria(id_veterinaria);
    END IF;
END
$$;


-- ============================================================
-- 2. AGREGAR RELACION DE TENANT A DIAGNOSTICO
-- ============================================================

ALTER TABLE public.diagnostico
ADD COLUMN IF NOT EXISTS id_veterinaria uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_diagnostico_veterinaria'
    ) THEN
        ALTER TABLE public.diagnostico
        ADD CONSTRAINT fk_diagnostico_veterinaria
        FOREIGN KEY (id_veterinaria)
        REFERENCES public.veterinaria(id_veterinaria);
    END IF;
END
$$;


-- ============================================================
-- 3. PERFIL DE USUARIO
-- ============================================================

ALTER TABLE public.perfilusuario
ADD COLUMN IF NOT EXISTS id_veterinaria uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_perfilusuario_veterinaria'
    ) THEN
        ALTER TABLE public.perfilusuario
        ADD CONSTRAINT fk_perfilusuario_veterinaria
        FOREIGN KEY (id_veterinaria)
        REFERENCES public.veterinaria(id_veterinaria);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_perfilusuario_auth'
    ) THEN
        ALTER TABLE public.perfilusuario
        ADD CONSTRAINT fk_perfilusuario_auth
        FOREIGN KEY (id)
        REFERENCES auth.users(id)
        ON DELETE CASCADE;
    END IF;
END
$$;


-- ============================================================
-- 4. FUNCION PARA OBTENER EL TENANT DEL USUARIO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_veterinaria()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id_veterinaria
    FROM public.perfilusuario
    WHERE id = auth.uid()
    LIMIT 1;
$$;


-- ============================================================
-- 5. FUNCION PARA REGISTRAR UNA NUEVA VETERINARIA
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_veterinaria(
    p_nombre varchar,
    p_direccion text DEFAULT NULL,
    p_telefono varchar DEFAULT NULL,
    p_correo varchar DEFAULT NULL,
    p_horario varchar DEFAULT NULL,
    p_descripcion text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_veterinaria_id uuid;
BEGIN

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    INSERT INTO public.veterinaria (
        nombre,
        direccion,
        telefono,
        correo,
        horario,
        descripcion
    )
    VALUES (
        p_nombre,
        p_direccion,
        p_telefono,
        p_correo,
        p_horario,
        p_descripcion
    )
    RETURNING id_veterinaria
    INTO v_veterinaria_id;

    INSERT INTO public.perfilusuario (
        id,
        rol,
        id_veterinaria
    )
    VALUES (
        auth.uid(),
        'admin',
        v_veterinaria_id
    );

    RETURN v_veterinaria_id;
END;
$$;


-- ============================================================
-- 6. PERMISOS DE LA FUNCION
-- ============================================================

REVOKE ALL
ON FUNCTION public.registrar_veterinaria(
    varchar,
    text,
    varchar,
    varchar,
    varchar,
    text
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.registrar_veterinaria(
    varchar,
    text,
    varchar,
    varchar,
    varchar,
    text
)
TO authenticated;


-- ============================================================
-- 7. HABILITAR RLS
-- ============================================================

ALTER TABLE public.cita ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dueno ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historialmedico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mascota ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metododepago ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfilusuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudadopcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ubicacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.valoracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veterinaria ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 8. POLITICAS MULTI-TENANT
-- ============================================================

-- DUENO
DROP POLICY IF EXISTS "tenant_select_dueno" ON public.dueno;

CREATE POLICY "tenant_select_dueno"
ON public.dueno
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- DIAGNOSTICO
DROP POLICY IF EXISTS "tenant_select_diagnostico" ON public.diagnostico;

CREATE POLICY "tenant_select_diagnostico"
ON public.diagnostico
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- CITA
DROP POLICY IF EXISTS "tenant_select_cita" ON public.cita;

CREATE POLICY "tenant_select_cita"
ON public.cita
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- EXPERTO
DROP POLICY IF EXISTS "tenant_select_experto" ON public.experto;

CREATE POLICY "tenant_select_experto"
ON public.experto
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- SERVICIO
DROP POLICY IF EXISTS "tenant_select_servicio" ON public.servicio;

CREATE POLICY "tenant_select_servicio"
ON public.servicio
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- PRODUCTO
DROP POLICY IF EXISTS "tenant_select_producto" ON public.producto;

CREATE POLICY "tenant_select_producto"
ON public.producto
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- PROMOCION
DROP POLICY IF EXISTS "tenant_select_promocion" ON public.promocion;

CREATE POLICY "tenant_select_promocion"
ON public.promocion
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- UBICACION
DROP POLICY IF EXISTS "tenant_select_ubicacion" ON public.ubicacion;

CREATE POLICY "tenant_select_ubicacion"
ON public.ubicacion
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- VALORACION
DROP POLICY IF EXISTS "tenant_select_valoracion" ON public.valoracion;

CREATE POLICY "tenant_select_valoracion"
ON public.valoracion
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);


-- VETERINARIA
DROP POLICY IF EXISTS "tenant_select_veterinaria" ON public.veterinaria;

CREATE POLICY "tenant_select_veterinaria"
ON public.veterinaria
FOR SELECT
TO authenticated
USING (
    id_veterinaria = public.get_my_veterinaria()
);

-- PERFIL DE USUARIO
DROP POLICY IF EXISTS "profile_select_own" ON public.perfilusuario;

CREATE POLICY "profile_select_own"
ON public.perfilusuario
FOR SELECT
TO authenticated
USING (
    id = auth.uid()
);

DROP POLICY IF EXISTS "profile_update_own" ON public.perfilusuario;

CREATE POLICY "profile_update_own"
ON public.perfilusuario
FOR UPDATE
TO authenticated
USING (
    id = auth.uid()
)
WITH CHECK (
    id = auth.uid()
);


-- ============================================================
-- 9. TABLAS INDIRECTAMENTE RELACIONADAS CON EL TENANT
-- ============================================================

-- MASCOTA -> DUENO -> VETERINARIA
DROP POLICY IF EXISTS "tenant_select_mascota" ON public.mascota;

CREATE POLICY "tenant_select_mascota"
ON public.mascota
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.dueno d
        WHERE d.id_dueno = mascota.id_dueno
          AND d.id_veterinaria = public.get_my_veterinaria()
    )
);


-- HISTORIAL MEDICO -> MASCOTA -> DUENO -> VETERINARIA
DROP POLICY IF EXISTS "tenant_select_historialmedico"
ON public.historialmedico;

CREATE POLICY "tenant_select_historialmedico"
ON public.historialmedico
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.mascota m
        JOIN public.dueno d
          ON d.id_dueno = m.id_dueno
        WHERE m.id_mascota = historialmedico.id_mascota
          AND d.id_veterinaria = public.get_my_veterinaria()
    )
);


-- PAGO -> CITA / DUENO -> VETERINARIA
DROP POLICY IF EXISTS "tenant_select_pago" ON public.pago;

CREATE POLICY "tenant_select_pago"
ON public.pago
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.cita c
        WHERE c.id_cita = pago.id_cita
          AND c.id_veterinaria = public.get_my_veterinaria()
    )
    OR
    EXISTS (
        SELECT 1
        FROM public.dueno d
        WHERE d.id_dueno = pago.id_dueno
          AND d.id_veterinaria = public.get_my_veterinaria()
    )
);


-- RECETA -> DIAGNOSTICO -> VETERINARIA
DROP POLICY IF EXISTS "tenant_select_receta" ON public.receta;

CREATE POLICY "tenant_select_receta"
ON public.receta
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.diagnostico d
        WHERE d.id_diagnostico = receta.id_diagnostico
          AND d.id_veterinaria = public.get_my_veterinaria()
    )
);


-- METODO DE PAGO
-- Esta tabla es catalogo general, por lo que no se filtra
-- por veterinaria.


-- ============================================================
-- FIN DE MIGRACION
-- ============================================================