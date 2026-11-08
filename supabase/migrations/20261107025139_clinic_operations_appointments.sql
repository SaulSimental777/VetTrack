-- Phase 3: REVIEW ONLY. Never apply automatically to the remote project.
BEGIN;
LOCK TABLE public.cita, public.servicio IN ACCESS EXCLUSIVE MODE;
-- MATCH SIMPLE composite FKs skip nullable legacy keys. Check these explicitly
-- before copying history, including a patient whose cita.id_dueno was NULL.
-- A legacy appointment keeps its recorded owner even if the patient changed
-- owners. Both the recorded owner and the current owner must be in its clinic.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.cita c WHERE c.id_veterinaria IS NULL
  OR (c.id_dueno IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.dueno d WHERE d.id_dueno=c.id_dueno AND d.id_veterinaria=c.id_veterinaria))
  OR (c.id_mascota IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.mascota m JOIN public.dueno d USING(id_dueno)
   WHERE m.id_mascota=c.id_mascota AND d.id_veterinaria=c.id_veterinaria))
  OR (c.id_servicio IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.servicio s WHERE s.id_servicio=c.id_servicio AND s.id_veterinaria=c.id_veterinaria))) THEN
  RAISE EXCEPTION 'Legacy appointment tenant/reference mismatch: review data before migration';
 END IF;
END $$;

INSERT INTO public.permiso (clave, modulo, accion, descripcion)
SELECT m||'.'||a,m,a,d FROM (VALUES
 ('medicos','ver','Ver médicos de la clínica'),('medicos','administrar','Administrar especialidades'),
 ('servicios','crear','Crear servicios'),('servicios','editar','Editar servicios'),
 ('servicios','eliminar','Desactivar servicios'),('servicios','editar_precio','Editar precios del catálogo'),
 ('citas','forzar_horario','Permitir una cita fuera del horario semanal; no omite bloqueos ni solapamientos')
) AS p(m,a,d) ON CONFLICT DO NOTHING;
INSERT INTO public.rol_permiso SELECT 'admin',clave FROM public.permiso ON CONFLICT DO NOTHING;
INSERT INTO public.rol_permiso VALUES ('recepcionista','medicos.ver'),('medico','medicos.ver'),
 ('medico','horarios.ver'),('medico','servicios.ver') ON CONFLICT DO NOTHING;

ALTER TABLE public.servicio ADD COLUMN duracion_minutos integer NOT NULL DEFAULT 30,
 ADD COLUMN activo boolean NOT NULL DEFAULT true;
UPDATE public.servicio SET costo=0 WHERE costo IS NULL;
ALTER TABLE public.servicio ALTER COLUMN costo SET DEFAULT 0, ALTER COLUMN costo SET NOT NULL,
 ADD CONSTRAINT servicio_costo_check CHECK (costo BETWEEN 0 AND 99999999.99),
 ADD CONSTRAINT servicio_duracion_check CHECK (duracion_minutos BETWEEN 1 AND 1440),
 ADD CONSTRAINT servicio_id_tenant_key UNIQUE(id_servicio,id_veterinaria);
CREATE INDEX servicio_tenant_activo_idx ON public.servicio(id_veterinaria,activo);
CREATE UNIQUE INDEX dueno_id_tenant_key ON public.dueno(id_dueno,id_veterinaria);

CREATE TABLE public.horario_medico (
 id_horario uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_medico uuid NOT NULL,
 id_veterinaria uuid NOT NULL REFERENCES public.veterinaria(id_veterinaria),
 dia_semana smallint NOT NULL CHECK(dia_semana BETWEEN 0 AND 6),
 hora_inicio time NOT NULL, hora_fin time NOT NULL, activo boolean NOT NULL DEFAULT true,
 CHECK(hora_inicio<hora_fin),
 FOREIGN KEY(id_medico,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria) ON DELETE RESTRICT
);
CREATE INDEX horario_medico_tenant_dia_idx ON public.horario_medico(id_veterinaria,id_medico,dia_semana);
CREATE TABLE public.bloqueo_medico (
 id_bloqueo uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_medico uuid NOT NULL,
 id_veterinaria uuid NOT NULL REFERENCES public.veterinaria(id_veterinaria),
 fecha_inicio timestamptz NOT NULL, fecha_fin timestamptz NOT NULL,
 motivo text CHECK(length(motivo)<=2000), tipo text NOT NULL CHECK(tipo IN ('vacaciones','comida','cirugia','ausencia','manual')),
 CHECK(isfinite(fecha_inicio) AND isfinite(fecha_fin) AND fecha_inicio<fecha_fin),
 FOREIGN KEY(id_medico,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria) ON DELETE RESTRICT
);
CREATE INDEX bloqueo_medico_tenant_fecha_idx ON public.bloqueo_medico(id_veterinaria,id_medico,fecha_inicio,fecha_fin);
CREATE TABLE public.servicio_especialidad (
 id_servicio uuid NOT NULL, id_especialidad uuid NOT NULL,
 id_veterinaria uuid NOT NULL REFERENCES public.veterinaria(id_veterinaria),
 PRIMARY KEY(id_servicio,id_especialidad),
 FOREIGN KEY(id_servicio,id_veterinaria) REFERENCES public.servicio(id_servicio,id_veterinaria) ON DELETE RESTRICT,
 FOREIGN KEY(id_especialidad,id_veterinaria) REFERENCES public.especialidad(id_especialidad,id_veterinaria) ON DELETE RESTRICT
);
CREATE INDEX servicio_especialidad_tenant_idx ON public.servicio_especialidad(id_veterinaria);
CREATE INDEX servicio_especialidad_especialidad_idx ON public.servicio_especialidad(id_especialidad,id_veterinaria);

-- Existing fecha is a wall-clock timestamp. Preserve it, and explicitly interpret
-- legacy appointments in America/Tijuana. Future per-clinic timezones can replace
-- this single documented zone; no browser timezone determines persisted times.
ALTER TABLE public.cita ADD COLUMN fecha_inicio timestamptz, ADD COLUMN fecha_fin timestamptz,
 ADD COLUMN id_medico uuid, ADD COLUMN motivo text, ADD COLUMN estado_legacy text;
UPDATE public.cita SET fecha_inicio=fecha AT TIME ZONE 'America/Tijuana',
 fecha_fin=(fecha AT TIME ZONE 'America/Tijuana') + make_interval(mins=>coalesce((SELECT s.duracion_minutos FROM public.servicio s WHERE s.id_servicio=cita.id_servicio),30)),
 estado_legacy=estado,
 estado=CASE lower(btrim(coalesce(estado,'pendiente')))
  WHEN 'pendiente' THEN 'programada' WHEN 'programada' THEN 'programada'
  WHEN 'confirmada' THEN 'confirmada' WHEN 'en_espera' THEN 'en_espera'
  WHEN 'en_consulta' THEN 'en_consulta' WHEN 'completada' THEN 'completada'
  WHEN 'cancelada' THEN 'cancelada' WHEN 'no_asistio' THEN 'no_asistio'
  ELSE NULL END;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.cita WHERE estado IS NULL) THEN
  RAISE EXCEPTION 'Unknown legacy appointment status: review estado_legacy before migration';
 END IF;
 IF EXISTS(SELECT 1 FROM public.cita c JOIN public.servicio s USING(id_servicio)
  WHERE c.id_servicio IS NOT NULL AND c.id_veterinaria IS DISTINCT FROM s.id_veterinaria) THEN
  RAISE EXCEPTION 'Legacy appointment/service tenant mismatch: review data before migration';
 END IF;
END $$;
ALTER TABLE public.cita ALTER COLUMN fecha_inicio SET NOT NULL, ALTER COLUMN fecha_fin SET NOT NULL,
 ALTER COLUMN estado SET NOT NULL, ALTER COLUMN estado SET DEFAULT 'programada',
 ADD CONSTRAINT cita_estado_check CHECK(estado IN ('programada','confirmada','en_espera','en_consulta','completada','cancelada','no_asistio')),
 ADD CONSTRAINT cita_fechas_check CHECK(isfinite(fecha_inicio) AND isfinite(fecha_fin) AND fecha_inicio<fecha_fin),
 ADD CONSTRAINT cita_motivo_check CHECK(length(motivo)<=2000),
 ADD CONSTRAINT cita_id_tenant_key UNIQUE(id_cita,id_veterinaria),
 ADD CONSTRAINT cita_medico_tenant_fkey FOREIGN KEY(id_medico,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria) ON DELETE RESTRICT,
 ADD CONSTRAINT cita_dueno_tenant_fkey FOREIGN KEY(id_dueno,id_veterinaria) REFERENCES public.dueno(id_dueno,id_veterinaria) ON DELETE RESTRICT;
-- Keep the existing FK on cita.id_mascota, without binding the recorded owner
-- to mascota.id_dueno. The booking RPC below still requires the current owner
-- for new operations; later owner transfers must not rewrite old appointments.
-- Protect appointment history from an older owner's ON DELETE CASCADE FK.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='public.cita'::regclass AND confrelid='public.dueno'::regclass AND confdeltype IN ('c','n','d') LOOP
  EXECUTE format('ALTER TABLE public.cita DROP CONSTRAINT %I',r.conname);
 END LOOP;
END $$;
CREATE INDEX cita_tenant_medico_fecha_idx ON public.cita(id_veterinaria,id_medico,fecha_inicio,fecha_fin);
CREATE INDEX cita_dueno_idx ON public.cita(id_dueno);
CREATE INDEX cita_legacy_servicio_idx ON public.cita(id_servicio);
CREATE TABLE public.cita_servicio (
 id_cita uuid NOT NULL, id_servicio uuid NOT NULL,
 id_veterinaria uuid NOT NULL REFERENCES public.veterinaria(id_veterinaria),
 precio_aplicado numeric(10,2) NOT NULL CHECK(precio_aplicado>=0),
 duracion_aplicada integer NOT NULL CHECK(duracion_aplicada BETWEEN 1 AND 1440),
 estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','realizado','cancelado')),
 creado_en timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(id_cita,id_servicio),
 FOREIGN KEY(id_cita,id_veterinaria) REFERENCES public.cita(id_cita,id_veterinaria) ON DELETE RESTRICT,
 FOREIGN KEY(id_servicio,id_veterinaria) REFERENCES public.servicio(id_servicio,id_veterinaria) ON DELETE RESTRICT
);
CREATE INDEX cita_servicio_tenant_idx ON public.cita_servicio(id_veterinaria);
CREATE INDEX cita_servicio_servicio_idx ON public.cita_servicio(id_servicio,id_veterinaria);
-- There was no historic price column: legacy snapshots use the current catalog
-- cost, never claim to reconstruct an unknown past amount. Preserve id_servicio.
INSERT INTO public.cita_servicio(id_cita,id_servicio,id_veterinaria,precio_aplicado,duracion_aplicada,estado)
SELECT c.id_cita,s.id_servicio,c.id_veterinaria,s.costo,s.duracion_minutos,
 CASE WHEN c.estado='cancelada' THEN 'cancelado' WHEN c.estado='completada' THEN 'realizado' ELSE 'pendiente' END
FROM public.cita c JOIN public.servicio s ON s.id_servicio=c.id_servicio;
COMMENT ON COLUMN public.cita.id_servicio IS 'Legacy only. New code uses cita_servicio; never erase historical associations.';
COMMENT ON TABLE public.cita_servicio IS '0..N initial/additional services; snapshot price/duration per service. Phase 4 will add consultation services without rewriting existing prices.';

-- Private helpers are not callable by authenticated clients. Only the guarded
-- entrypoints listed at the end receive EXECUTE; public wrappers are INVOKER.
CREATE FUNCTION private.op_tenant(p_permiso text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid:=private.my_veterinaria(); BEGIN
 IF tenant IS NULL OR NOT private.has_permission(p_permiso) THEN
  RAISE EXCEPTION 'Permiso requerido: %',p_permiso USING ERRCODE='42501'; END IF;
 RETURN tenant;
END $$;
CREATE FUNCTION private.op_body(p_datos jsonb,p_claves text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF jsonb_typeof(p_datos) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_datos) k WHERE NOT(k=ANY(p_claves))) THEN
  RAISE EXCEPTION 'Campos no permitidos' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION private.op_doctor(p_id uuid,p_tenant uuid,p_activo boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.perfilusuario p WHERE p.id=p_id AND p.id_veterinaria=p_tenant AND p.rol='medico'
  AND (NOT p_activo OR p.activo) AND NOT private.is_superadmin(p.id)) THEN
  RAISE EXCEPTION 'Médico no disponible' USING ERRCODE='P0002'; END IF;
END $$;
CREATE FUNCTION private.op_specialties(p_servicio uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id_especialidad',e.id_especialidad,'nombre',e.nombre) ORDER BY e.nombre),'[]')
 FROM public.especialidad e JOIN public.servicio_especialidad se USING(id_especialidad,id_veterinaria) WHERE se.id_servicio=p_servicio;
$$;
CREATE FUNCTION private.op_service_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id_servicio',s.id_servicio,'nombre',s.nombre,'descripcion',s.descripcion,'costo',s.costo,
  'duracion_minutos',s.duracion_minutos,'activo',s.activo,'especialidades',private.op_specialties(s.id_servicio)) FROM public.servicio s WHERE s.id_servicio=p_id;
$$;
CREATE FUNCTION private.op_appointment_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id_cita',c.id_cita,'fecha_inicio',c.fecha_inicio,'fecha_fin',c.fecha_fin,'estado',c.estado,'motivo',c.motivo,
  'id_mascota',c.id_mascota,'id_dueno',c.id_dueno,'id_medico',c.id_medico,'paciente',m.nombre,'propietario',d.nombre,'medico',p.nombre,
  'servicios',coalesce((SELECT jsonb_agg(jsonb_build_object('id_servicio',s.id_servicio,'nombre',s.nombre,'precio_aplicado',cs.precio_aplicado,
   'duracion_aplicada',cs.duracion_aplicada,'estado',cs.estado) ORDER BY cs.creado_en,s.nombre) FROM public.cita_servicio cs
   JOIN public.servicio s USING(id_servicio) WHERE cs.id_cita=c.id_cita),'[]'),
  'subtotal',coalesce((SELECT sum(cs.precio_aplicado) FROM public.cita_servicio cs WHERE cs.id_cita=c.id_cita AND cs.estado<>'cancelado'),0))
 FROM public.cita c LEFT JOIN public.mascota m ON m.id_mascota=c.id_mascota
  AND EXISTS(SELECT 1 FROM public.dueno owner WHERE owner.id_dueno=m.id_dueno AND owner.id_veterinaria=c.id_veterinaria)
 LEFT JOIN public.dueno d ON d.id_dueno=c.id_dueno AND d.id_veterinaria=c.id_veterinaria
 LEFT JOIN public.perfilusuario p ON p.id=c.id_medico AND p.id_veterinaria=c.id_veterinaria AND NOT private.is_superadmin(p.id) WHERE c.id_cita=p_id;
$$;
CREATE FUNCTION private.op_medicos(p_q text,p_especialidad uuid,p_activo boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid:=private.op_tenant('medicos.ver'); BEGIN
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'activo',p.activo,
  'especialidades',coalesce((SELECT jsonb_agg(jsonb_build_object('id_especialidad',e.id_especialidad,'nombre',e.nombre) ORDER BY e.nombre)
   FROM public.medico_especialidad me JOIN public.especialidad e USING(id_especialidad,id_veterinaria) WHERE me.id_usuario=p.id),'[]'),
  'horario_hoy',CASE WHEN private.has_permission('horarios.ver') THEN coalesce((SELECT jsonb_agg(to_jsonb(h) - 'id_veterinaria' ORDER BY h.hora_inicio) FROM public.horario_medico h
   WHERE h.id_medico=p.id AND h.activo AND h.dia_semana=extract(dow FROM now() AT TIME ZONE 'America/Tijuana')),'[]') ELSE '[]'::jsonb END,
  'proxima_cita',CASE WHEN private.has_permission('citas.ver') THEN (SELECT jsonb_build_object('id_cita',c.id_cita,'fecha_inicio',c.fecha_inicio,'fecha_fin',c.fecha_fin)
   FROM public.cita c WHERE c.id_medico=p.id AND c.fecha_fin>now() AND c.estado IN ('programada','confirmada','en_espera','en_consulta') ORDER BY c.fecha_inicio LIMIT 1) ELSE NULL END
  ) ORDER BY p.nombre,p.id) FROM public.perfilusuario p WHERE p.id_veterinaria=tenant AND p.rol='medico' AND NOT private.is_superadmin(p.id)
  AND (p_activo IS NULL OR p.activo=p_activo) AND (p_q IS NULL OR p.nombre ILIKE '%'||p_q||'%')
  AND (p_especialidad IS NULL OR EXISTS(SELECT 1 FROM public.medico_especialidad me WHERE me.id_usuario=p.id AND me.id_especialidad=p_especialidad))),'[]');
END $$;
CREATE FUNCTION private.op_horarios(p_medico uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid:=private.op_tenant('horarios.ver'); BEGIN
 PERFORM private.op_doctor(p_medico,tenant);
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(h)-'id_veterinaria' ORDER BY dia_semana,hora_inicio) FROM public.horario_medico h WHERE h.id_medico=p_medico AND h.id_veterinaria=tenant),'[]');
END $$;
CREATE FUNCTION private.op_bloqueos(p_medico uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid:=private.op_tenant('horarios.ver'); BEGIN
 PERFORM private.op_doctor(p_medico,tenant);
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(b)-'id_veterinaria' ORDER BY fecha_inicio) FROM public.bloqueo_medico b WHERE b.id_medico=p_medico AND b.id_veterinaria=tenant),'[]');
END $$;
CREATE FUNCTION private.op_duration(p_servicios uuid[],p_tenant uuid,p_fallback integer,p_cita uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE duration integer; BEGIN
 IF p_servicios IS NULL THEN duration:=p_fallback;
 ELSE
  IF cardinality(p_servicios) NOT BETWEEN 1 AND 50 OR cardinality(p_servicios)<>(SELECT count(DISTINCT x) FROM unnest(p_servicios) x)
   OR (SELECT count(*) FROM public.servicio s WHERE s.id_servicio=ANY(p_servicios) AND s.id_veterinaria=p_tenant
    AND (s.activo OR EXISTS(SELECT 1 FROM public.cita_servicio cs WHERE cs.id_cita=p_cita AND cs.id_servicio=s.id_servicio AND cs.id_veterinaria=p_tenant)))<>cardinality(p_servicios) THEN
   RAISE EXCEPTION 'Servicios no disponibles' USING ERRCODE='22023'; END IF;
  SELECT sum(coalesce(cs.duracion_aplicada,s.duracion_minutos))::integer INTO duration FROM public.servicio s
   LEFT JOIN public.cita_servicio cs ON cs.id_cita=p_cita AND cs.id_servicio=s.id_servicio AND cs.id_veterinaria=p_tenant
   WHERE s.id_servicio=ANY(p_servicios) AND s.id_veterinaria=p_tenant;
 END IF;
 IF duration IS NULL OR duration NOT BETWEEN 1 AND 1440 THEN RAISE EXCEPTION 'Duración inválida' USING ERRCODE='22023'; END IF;
 RETURN duration;
END $$;
CREATE FUNCTION private.op_disponibilidad(p_medico uuid,p_fecha date,p_duracion integer,p_servicios uuid[],p_excluir_cita uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; duration integer; BEGIN
 tenant:=private.my_veterinaria();
 IF tenant IS NULL OR NOT(private.has_permission('horarios.ver') OR private.has_permission('citas.crear') OR private.has_permission('citas.editar')) THEN
  RAISE EXCEPTION 'Permiso de disponibilidad requerido' USING ERRCODE='42501'; END IF;
 PERFORM private.op_doctor(p_medico,tenant,true);
 IF p_fecha IS NULL OR NOT isfinite(p_fecha) THEN RAISE EXCEPTION 'Fecha inválida' USING ERRCODE='22023'; END IF;
 IF p_excluir_cita IS NOT NULL AND (NOT private.has_permission('citas.editar') OR NOT EXISTS(SELECT 1 FROM public.cita c WHERE c.id_cita=p_excluir_cita AND c.id_veterinaria=tenant)) THEN
  RAISE EXCEPTION 'Cita no encontrada o sin permiso' USING ERRCODE='42501'; END IF;
 duration:=private.op_duration(p_servicios,tenant,p_duracion,p_excluir_cita);
 RETURN jsonb_build_object('fecha',p_fecha,'duracion_minutos',duration,'zona_horaria','America/Tijuana','slots',coalesce((
  SELECT jsonb_agg(jsonb_build_object('fecha_inicio',slot,'fecha_fin',slot+make_interval(mins=>duration)) ORDER BY slot)
  FROM public.horario_medico h CROSS JOIN LATERAL generate_series((p_fecha+h.hora_inicio) AT TIME ZONE 'America/Tijuana',
   ((p_fecha+h.hora_fin) AT TIME ZONE 'America/Tijuana')-make_interval(mins=>duration),interval '15 minutes') slot
  WHERE h.id_veterinaria=tenant AND h.id_medico=p_medico AND h.activo AND h.dia_semana=extract(dow FROM p_fecha)
  AND NOT EXISTS(SELECT 1 FROM public.bloqueo_medico b WHERE b.id_medico=p_medico AND b.id_veterinaria=tenant AND b.fecha_inicio<slot+make_interval(mins=>duration) AND b.fecha_fin>slot)
  AND NOT EXISTS(SELECT 1 FROM public.cita c WHERE c.id_medico=p_medico AND c.id_veterinaria=tenant AND c.id_cita IS DISTINCT FROM p_excluir_cita
   AND c.estado IN ('programada','confirmada','en_espera','en_consulta') AND c.fecha_inicio<slot+make_interval(mins=>duration) AND c.fecha_fin>slot)
 ),'[]'));
END $$;
CREATE FUNCTION private.op_guardar_horarios(p_medico uuid,p_bloques jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; b jsonb; BEGIN
 actor:=private.lock_actor('horarios.administrar'); PERFORM private.op_doctor(p_medico,actor.id_veterinaria);
 IF jsonb_typeof(p_bloques) IS DISTINCT FROM 'array' OR jsonb_array_length(p_bloques)>100 THEN RAISE EXCEPTION 'Bloques inválidos' USING ERRCODE='22023'; END IF;
 DELETE FROM public.horario_medico WHERE id_medico=p_medico AND id_veterinaria=actor.id_veterinaria;
 FOR b IN SELECT value FROM jsonb_array_elements(p_bloques) LOOP
  PERFORM private.op_body(b,ARRAY['dia_semana','hora_inicio','hora_fin','activo']);
  IF jsonb_typeof(b->'dia_semana') IS DISTINCT FROM 'number' OR (b->>'dia_semana')!~'^[0-6]$'
   OR coalesce(b->>'hora_inicio','')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
   OR coalesce(b->>'hora_fin','')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
   OR (b?'activo' AND jsonb_typeof(b->'activo')<>'boolean') THEN RAISE EXCEPTION 'Bloque inválido' USING ERRCODE='22023'; END IF;
  INSERT INTO public.horario_medico(id_medico,id_veterinaria,dia_semana,hora_inicio,hora_fin,activo)
  VALUES(p_medico,actor.id_veterinaria,(b->>'dia_semana')::smallint,(b->>'hora_inicio')::time,(b->>'hora_fin')::time,coalesce((b->>'activo')::boolean,true));
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.horario_medico a JOIN public.horario_medico b ON a.id_medico=b.id_medico AND a.dia_semana=b.dia_semana AND a.id_horario<>b.id_horario
  WHERE a.id_medico=p_medico AND a.activo AND b.activo AND a.hora_inicio<b.hora_fin AND a.hora_fin>b.hora_inicio) THEN
  RAISE EXCEPTION 'Horarios solapados' USING ERRCODE='23514'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(h)-'id_veterinaria' ORDER BY dia_semana,hora_inicio) FROM public.horario_medico h WHERE h.id_medico=p_medico),'[]');
END $$;
CREATE FUNCTION private.op_guardar_bloqueo(p_medico uuid,p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; b public.bloqueo_medico; BEGIN
 actor:=private.lock_actor('horarios.administrar'); PERFORM private.op_doctor(p_medico,actor.id_veterinaria);
 PERFORM private.op_body(p_datos,ARRAY['fecha_inicio','fecha_fin','motivo','tipo']);
 IF coalesce(p_datos->>'fecha_inicio','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' OR coalesce(p_datos->>'fecha_fin','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
  RAISE EXCEPTION 'Fechas con zona requeridas' USING ERRCODE='22023'; END IF;
 INSERT INTO public.bloqueo_medico(id_medico,id_veterinaria,fecha_inicio,fecha_fin,motivo,tipo)
 VALUES(p_medico,actor.id_veterinaria,(p_datos->>'fecha_inicio')::timestamptz,(p_datos->>'fecha_fin')::timestamptz,nullif(btrim(p_datos->>'motivo'),''),p_datos->>'tipo') RETURNING * INTO b;
 -- Existing appointments remain visible; a new block must not strand one.
 IF EXISTS(SELECT 1 FROM public.cita c WHERE c.id_medico=p_medico AND c.estado IN ('programada','confirmada','en_espera','en_consulta') AND c.fecha_inicio<b.fecha_fin AND c.fecha_fin>b.fecha_inicio) THEN
  RAISE EXCEPTION 'El bloqueo afecta citas activas; reprograma primero' USING ERRCODE='23514'; END IF;
 RETURN to_jsonb(b)-'id_veterinaria';
END $$;
CREATE FUNCTION private.op_eliminar_bloqueo(p_medico uuid,p_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ DECLARE actor public.perfilusuario; BEGIN
 actor:=private.lock_actor('horarios.administrar'); PERFORM private.op_doctor(p_medico,actor.id_veterinaria);
 DELETE FROM public.bloqueo_medico WHERE id_bloqueo=p_id AND id_medico=p_medico AND id_veterinaria=actor.id_veterinaria;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bloqueo no encontrado' USING ERRCODE='P0002'; END IF; RETURN true;
END $$;
CREATE FUNCTION private.op_servicios() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid:=private.op_tenant('servicios.ver'); BEGIN
 RETURN coalesce((SELECT jsonb_agg(private.op_service_json(s.id_servicio) ORDER BY s.nombre,s.id_servicio) FROM public.servicio s WHERE s.id_veterinaria=tenant),'[]');
END $$;
CREATE FUNCTION private.op_guardar_servicio(p_id uuid,p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; old public.servicio; item public.servicio; ids uuid[]; price numeric; BEGIN
 PERFORM private.op_body(p_datos,ARRAY['nombre','descripcion','costo','duracion_minutos','activo','especialidades']);
 actor:=private.lock_actor(CASE WHEN p_id IS NULL THEN 'servicios.crear' WHEN EXISTS(SELECT 1 FROM jsonb_object_keys(p_datos) k WHERE k<>'costo') THEN 'servicios.editar' ELSE 'servicios.editar_precio' END);
 IF p_id IS NOT NULL THEN
  SELECT * INTO old FROM public.servicio s WHERE s.id_servicio=p_id AND s.id_veterinaria=actor.id_veterinaria FOR UPDATE;
  IF old.id_servicio IS NULL THEN RAISE EXCEPTION 'Servicio no encontrado' USING ERRCODE='P0002'; END IF;
 END IF;
 IF p_datos?'costo' AND (jsonb_typeof(p_datos->'costo')<>'number' OR (p_datos->>'costo')::numeric<>round((p_datos->>'costo')::numeric,2)) THEN
  RAISE EXCEPTION 'Precio inválido' USING ERRCODE='22023'; END IF;
 price:=coalesce((p_datos->>'costo')::numeric,old.costo,0);
 IF price IS DISTINCT FROM coalesce(old.costo,0) AND NOT private.has_permission('servicios.editar_precio') THEN
  RAISE EXCEPTION 'Permiso de precio requerido' USING ERRCODE='42501'; END IF;
 item.nombre:=CASE WHEN p_datos?'nombre' THEN btrim(p_datos->>'nombre') ELSE old.nombre END;
 item.descripcion:=CASE WHEN p_datos?'descripcion' THEN nullif(btrim(p_datos->>'descripcion'),'') ELSE old.descripcion END;
 IF item.nombre IS NULL OR item.nombre='' OR length(item.nombre)>100 OR length(item.descripcion)>5000
  OR (p_datos?'duracion_minutos' AND (p_datos->>'duracion_minutos')!~'^[0-9]+$')
  OR (p_datos?'activo' AND jsonb_typeof(p_datos->'activo')<>'boolean') THEN RAISE EXCEPTION 'Servicio inválido' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.servicio(nombre,descripcion,costo,duracion_minutos,activo,id_veterinaria)
  VALUES(item.nombre,item.descripcion,price,coalesce((p_datos->>'duracion_minutos')::integer,30),coalesce((p_datos->>'activo')::boolean,true),actor.id_veterinaria) RETURNING * INTO item;
 ELSE
  UPDATE public.servicio SET nombre=item.nombre,descripcion=item.descripcion,costo=price,
   duracion_minutos=CASE WHEN p_datos?'duracion_minutos' THEN (p_datos->>'duracion_minutos')::integer ELSE old.duracion_minutos END,
   activo=CASE WHEN p_datos?'activo' THEN (p_datos->>'activo')::boolean ELSE old.activo END
  WHERE id_servicio=p_id RETURNING * INTO item;
 END IF;
 IF p_datos?'especialidades' THEN
  IF jsonb_typeof(p_datos->'especialidades') IS DISTINCT FROM 'array' OR jsonb_array_length(p_datos->'especialidades')>50 THEN
   RAISE EXCEPTION 'Especialidades inválidas' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(value::uuid),'{}') INTO ids FROM jsonb_array_elements_text(p_datos->'especialidades');
  IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) OR cardinality(ids)<>(SELECT count(*) FROM public.especialidad e WHERE e.id_especialidad=ANY(ids) AND e.id_veterinaria=actor.id_veterinaria) THEN
   RAISE EXCEPTION 'Especialidades no disponibles' USING ERRCODE='22023'; END IF;
  DELETE FROM public.servicio_especialidad WHERE id_servicio=item.id_servicio;
  INSERT INTO public.servicio_especialidad SELECT item.id_servicio,x,actor.id_veterinaria FROM unnest(ids) x;
 END IF;
 RETURN private.op_service_json(item.id_servicio);
END $$;
CREATE FUNCTION private.op_eliminar_servicio(p_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ DECLARE actor public.perfilusuario; BEGIN
 actor:=private.lock_actor('servicios.eliminar');
 UPDATE public.servicio SET activo=false WHERE id_servicio=p_id AND id_veterinaria=actor.id_veterinaria;
 IF NOT FOUND THEN RAISE EXCEPTION 'Servicio no encontrado' USING ERRCODE='P0002'; END IF; RETURN true;
END $$;
CREATE FUNCTION private.op_citas(p_inicio timestamptz,p_fin timestamptz,p_medico uuid,p_estado text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE tenant uuid:=private.op_tenant('citas.ver'); BEGIN
 IF p_medico IS NOT NULL THEN PERFORM private.op_doctor(p_medico,tenant); END IF;
 RETURN coalesce((SELECT jsonb_agg(private.op_appointment_json(c.id_cita) ORDER BY c.fecha_inicio,c.id_cita) FROM public.cita c WHERE c.id_veterinaria=tenant
  AND (p_inicio IS NULL OR c.fecha_fin>p_inicio) AND (p_fin IS NULL OR c.fecha_inicio<p_fin) AND (p_medico IS NULL OR c.id_medico=p_medico) AND (p_estado IS NULL OR c.estado=p_estado)),'[]');
END $$;
CREATE FUNCTION private.op_guardar_cita(p_id uuid,p_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; old public.cita; item public.cita; ids uuid[]; duration integer; force_schedule boolean; starts_local timestamp; ends_local timestamp; BEGIN
 actor:=private.lock_actor(CASE WHEN p_id IS NULL THEN 'citas.crear' ELSE 'citas.editar' END);
 PERFORM private.op_body(p_datos,ARRAY['id_mascota','id_dueno','id_medico','fecha_inicio','motivo','servicios','forzar_horario','estado']);
 IF p_id IS NOT NULL THEN
  SELECT * INTO old FROM public.cita c WHERE c.id_cita=p_id AND c.id_veterinaria=actor.id_veterinaria FOR UPDATE;
  IF old.id_cita IS NULL THEN RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE='P0002'; END IF;
  IF old.estado NOT IN ('programada','confirmada','en_espera') THEN RAISE EXCEPTION 'Cita cerrada o en consulta' USING ERRCODE='23514'; END IF;
 END IF;
 item.id_medico:=(p_datos->>'id_medico')::uuid; item.id_dueno:=(p_datos->>'id_dueno')::uuid; item.id_mascota:=(p_datos->>'id_mascota')::uuid;
 IF item.id_medico IS DISTINCT FROM old.id_medico AND NOT private.has_permission('citas.asignar_medico') THEN
  RAISE EXCEPTION 'Permiso de asignación requerido' USING ERRCODE='42501'; END IF;
 PERFORM private.op_doctor(item.id_medico,actor.id_veterinaria,true);
 IF NOT EXISTS(SELECT 1 FROM public.mascota m JOIN public.dueno d USING(id_dueno) WHERE m.id_mascota=item.id_mascota AND m.id_dueno=item.id_dueno AND d.id_veterinaria=actor.id_veterinaria) THEN
  RAISE EXCEPTION 'Paciente/propietario no disponible' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_datos->'servicios') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Servicios requeridos' USING ERRCODE='22023'; END IF;
 SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(p_datos->'servicios');
 IF ids IS NULL THEN RAISE EXCEPTION 'Selecciona al menos un servicio' USING ERRCODE='22023'; END IF;
 duration:=private.op_duration(ids,actor.id_veterinaria,30,p_id);
 -- Existing service snapshots determine duration on edit; catalog changes never
 -- silently resize a booked service or change its applied price.
 IF coalesce(p_datos->>'fecha_inicio','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' OR (p_datos?'forzar_horario' AND jsonb_typeof(p_datos->'forzar_horario')<>'boolean') THEN
  RAISE EXCEPTION 'Fecha o excepción inválida' USING ERRCODE='22023'; END IF;
 item.fecha_inicio:=(p_datos->>'fecha_inicio')::timestamptz; item.fecha_fin:=item.fecha_inicio+make_interval(mins=>duration);
 IF NOT isfinite(item.fecha_inicio) THEN RAISE EXCEPTION 'Fecha inválida' USING ERRCODE='22023'; END IF;
 item.motivo:=nullif(btrim(p_datos->>'motivo'),''); item.estado:=coalesce(p_datos->>'estado',old.estado,'programada');
 IF item.estado NOT IN ('programada','confirmada','en_espera','no_asistio') OR length(item.motivo)>2000 THEN RAISE EXCEPTION 'Estado o motivo inválido' USING ERRCODE='22023'; END IF;
 force_schedule:=coalesce((p_datos->>'forzar_horario')::boolean,false);
 IF force_schedule AND NOT private.has_permission('citas.forzar_horario') THEN RAISE EXCEPTION 'Permiso de excepción requerido' USING ERRCODE='42501'; END IF;
 starts_local:=item.fecha_inicio AT TIME ZONE 'America/Tijuana'; ends_local:=item.fecha_fin AT TIME ZONE 'America/Tijuana';
 IF NOT force_schedule AND NOT EXISTS(SELECT 1 FROM public.horario_medico h WHERE h.id_medico=item.id_medico AND h.id_veterinaria=actor.id_veterinaria AND h.activo
  AND h.dia_semana=extract(dow FROM starts_local) AND starts_local::date=ends_local::date
  AND item.fecha_inicio>=(starts_local::date+h.hora_inicio) AT TIME ZONE 'America/Tijuana'
  AND item.fecha_fin<=(starts_local::date+h.hora_fin) AT TIME ZONE 'America/Tijuana') THEN
  RAISE EXCEPTION 'Cita fuera del horario del médico' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.bloqueo_medico b WHERE b.id_medico=item.id_medico AND b.fecha_inicio<item.fecha_fin AND b.fecha_fin>item.fecha_inicio) THEN
  RAISE EXCEPTION 'Médico bloqueado en ese horario' USING ERRCODE='23514'; END IF;
 IF item.estado<>'no_asistio' AND EXISTS(SELECT 1 FROM public.cita c WHERE c.id_medico=item.id_medico AND c.id_veterinaria=actor.id_veterinaria AND c.id_cita IS DISTINCT FROM p_id
  AND c.estado IN ('programada','confirmada','en_espera','en_consulta') AND c.fecha_inicio<item.fecha_fin AND c.fecha_fin>item.fecha_inicio) THEN
  RAISE EXCEPTION 'Cita solapada; actualiza la disponibilidad' USING ERRCODE='23514'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.cita(fecha,fecha_inicio,fecha_fin,estado,motivo,id_mascota,id_dueno,id_medico,id_veterinaria)
  VALUES(starts_local,item.fecha_inicio,item.fecha_fin,item.estado,item.motivo,item.id_mascota,item.id_dueno,item.id_medico,actor.id_veterinaria) RETURNING id_cita INTO p_id;
 ELSE
  UPDATE public.cita SET fecha=starts_local,fecha_inicio=item.fecha_inicio,fecha_fin=item.fecha_fin,estado=item.estado,motivo=item.motivo,
   id_mascota=item.id_mascota,id_dueno=item.id_dueno,id_medico=item.id_medico WHERE id_cita=p_id;
 END IF;
 DELETE FROM public.cita_servicio cs WHERE cs.id_cita=p_id AND NOT(cs.id_servicio=ANY(ids));
 INSERT INTO public.cita_servicio(id_cita,id_servicio,id_veterinaria,precio_aplicado,duracion_aplicada)
 SELECT p_id,s.id_servicio,actor.id_veterinaria,s.costo,s.duracion_minutos FROM public.servicio s WHERE s.id_servicio=ANY(ids)
 ON CONFLICT(id_cita,id_servicio) DO NOTHING;
 -- No specialty comparison here: labels/suggestions must never block booking.
 RETURN private.op_appointment_json(p_id);
END $$;
CREATE FUNCTION private.op_cancelar_cita(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ DECLARE actor public.perfilusuario; BEGIN
 actor:=private.lock_actor('citas.cancelar');
 UPDATE public.cita SET estado='cancelada' WHERE id_cita=p_id AND id_veterinaria=actor.id_veterinaria AND estado IN ('programada','confirmada','en_espera');
 IF NOT FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.cita WHERE id_cita=p_id AND id_veterinaria=actor.id_veterinaria) THEN RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE='P0002'; END IF;
  RAISE EXCEPTION 'Cita cerrada o en consulta' USING ERRCODE='23514'; END IF;
 UPDATE public.cita_servicio SET estado='cancelado' WHERE id_cita=p_id;
 RETURN private.op_appointment_json(p_id);
END $$;
CREATE FUNCTION private.op_selectores_citas() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE tenant uuid:=private.my_veterinaria(); BEGIN
 IF tenant IS NULL OR NOT(private.has_permission('citas.crear') OR private.has_permission('citas.editar')) THEN RAISE EXCEPTION 'Permiso de citas requerido' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('propietarios',coalesce((SELECT jsonb_agg(jsonb_build_object('id_dueno',d.id_dueno,'nombre',d.nombre) ORDER BY d.nombre) FROM public.dueno d WHERE d.id_veterinaria=tenant),'[]'),
  'pacientes',coalesce((SELECT jsonb_agg(jsonb_build_object('id_mascota',m.id_mascota,'nombre',m.nombre,'id_dueno',m.id_dueno) ORDER BY m.nombre) FROM public.mascota m JOIN public.dueno d USING(id_dueno) WHERE d.id_veterinaria=tenant),'[]'));
END $$;

-- Reuse Phase 2 specialty management without widening user administration.
CREATE OR REPLACE FUNCTION private.save_specialty(p_nombre text,p_descripcion text,p_id uuid)
RETURNS public.especialidad LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; specialty public.especialidad; BEGIN
 actor:=private.lock_actor(CASE WHEN private.has_permission('medicos.administrar') THEN 'medicos.administrar' WHEN p_id IS NULL THEN 'usuarios.crear' ELSE 'usuarios.editar' END);
 IF p_nombre IS NULL OR btrim(p_nombre)='' OR length(btrim(p_nombre))>100 OR length(p_descripcion)>2000 THEN RAISE EXCEPTION 'Especialidad inválida' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN INSERT INTO public.especialidad(nombre,descripcion,id_veterinaria) VALUES(btrim(p_nombre),nullif(btrim(p_descripcion),''),actor.id_veterinaria) RETURNING * INTO specialty;
 ELSE UPDATE public.especialidad SET nombre=btrim(p_nombre),descripcion=nullif(btrim(p_descripcion),'') WHERE id_especialidad=p_id AND id_veterinaria=actor.id_veterinaria RETURNING * INTO specialty;
  IF specialty.id_especialidad IS NULL THEN RAISE EXCEPTION 'Especialidad no encontrada' USING ERRCODE='P0002'; END IF;
 END IF; RETURN specialty;
END $$;

-- All operational writes are atomic guarded RPCs. Direct authenticated table
-- writes (including column grants) are revoked so price/schedule checks cannot
-- be bypassed through REST. RLS independently protects each permitted read.
DO $$ DECLARE t text; p record; cols text; BEGIN
 FOREACH t IN ARRAY ARRAY['servicio','cita','horario_medico','bloqueo_medico','servicio_especialidad','cita_servicio'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t); END LOOP;
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
  SELECT string_agg(format('%I',attname),',') INTO cols FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC,anon,authenticated',cols,t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
CREATE POLICY clinic_services_read ON public.servicio FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('servicios.ver')));
CREATE POLICY clinic_appointments_read ON public.cita FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('citas.ver')));
CREATE POLICY clinic_schedules_read ON public.horario_medico FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('horarios.ver')));
CREATE POLICY clinic_blocks_read ON public.bloqueo_medico FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('horarios.ver')));
CREATE POLICY clinic_service_specialties_read ON public.servicio_especialidad FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('servicios.ver')));
CREATE POLICY clinic_appointment_services_read ON public.cita_servicio FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission('citas.ver')));
CREATE POLICY operation_specialties_read ON public.especialidad FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (
 (SELECT public.has_permission('medicos.ver')) OR (SELECT public.has_permission('medicos.administrar')) OR (SELECT public.has_permission('servicios.ver')) OR (SELECT public.has_permission('servicios.crear')) OR (SELECT public.has_permission('servicios.editar'))));
CREATE POLICY operation_doctor_specialties_read ON public.medico_especialidad FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND private.profile_in_my_tenant(id_usuario) AND (SELECT public.has_permission('medicos.ver')));

CREATE FUNCTION public.vettrack_medicos(p_q text DEFAULT NULL,p_especialidad uuid DEFAULT NULL,p_activo boolean DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_medicos(p_q,p_especialidad,p_activo); $$;
CREATE FUNCTION public.vettrack_horarios(p_medico uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_horarios(p_medico); $$;
CREATE FUNCTION public.vettrack_bloqueos(p_medico uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_bloqueos(p_medico); $$;
CREATE FUNCTION public.vettrack_disponibilidad(p_medico uuid,p_fecha date,p_duracion integer DEFAULT 30,p_servicios uuid[] DEFAULT NULL,p_excluir_cita uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_disponibilidad(p_medico,p_fecha,p_duracion,p_servicios,p_excluir_cita); $$;
CREATE FUNCTION public.vettrack_guardar_horarios(p_medico uuid,p_bloques jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_guardar_horarios(p_medico,p_bloques); $$;
CREATE FUNCTION public.vettrack_guardar_bloqueo(p_medico uuid,p_datos jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_guardar_bloqueo(p_medico,p_datos); $$;
CREATE FUNCTION public.vettrack_eliminar_bloqueo(p_medico uuid,p_id uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_eliminar_bloqueo(p_medico,p_id); $$;
CREATE FUNCTION public.vettrack_servicios() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_servicios(); $$;
CREATE FUNCTION public.vettrack_guardar_servicio(p_id uuid,p_datos jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_guardar_servicio(p_id,p_datos); $$;
CREATE FUNCTION public.vettrack_eliminar_servicio(p_id uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_eliminar_servicio(p_id); $$;
CREATE FUNCTION public.vettrack_citas(p_inicio timestamptz DEFAULT NULL,p_fin timestamptz DEFAULT NULL,p_medico uuid DEFAULT NULL,p_estado text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_citas(p_inicio,p_fin,p_medico,p_estado); $$;
CREATE FUNCTION public.vettrack_guardar_cita(p_id uuid,p_datos jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_guardar_cita(p_id,p_datos); $$;
CREATE FUNCTION public.vettrack_cancelar_cita(p_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_cancelar_cita(p_id); $$;
CREATE FUNCTION public.vettrack_selectores_citas() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.op_selectores_citas(); $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature,p.proname,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='private' AND p.proname LIKE 'op\_%' ESCAPE '\') OR (n.nspname='public' AND p.proname IN (
   'vettrack_medicos','vettrack_horarios','vettrack_bloqueos','vettrack_disponibilidad','vettrack_guardar_horarios','vettrack_guardar_bloqueo','vettrack_eliminar_bloqueo',
   'vettrack_servicios','vettrack_guardar_servicio','vettrack_eliminar_servicio','vettrack_citas','vettrack_guardar_cita','vettrack_cancelar_cita','vettrack_selectores_citas')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.nspname='public' OR f.proname IN ('op_medicos','op_horarios','op_bloqueos','op_disponibilidad','op_guardar_horarios','op_guardar_bloqueo','op_eliminar_bloqueo',
   'op_servicios','op_guardar_servicio','op_eliminar_servicio','op_citas','op_guardar_cita','op_cancelar_cita','op_selectores_citas') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  END IF;
 END LOOP;
END $$;
COMMIT;
