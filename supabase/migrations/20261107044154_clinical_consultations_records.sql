-- Phase 4. Clinical writes are atomic JWT-authorized RPCs; snapshots preserve history.
BEGIN;
INSERT INTO public.permiso(clave,modulo,accion,descripcion)
SELECT m||'.'||a,m,a,d FROM (VALUES
 ('consultas','finalizar','Finalizar consulta y preparar documentos'),
 ('consultas','tomar_ajenas','Atender citas asignadas a otro médico'),
 ('consultas','reabrir','Reabrir consulta cerrada con motivo y nueva revisión'),
 ('tratamientos','ver','Ver tratamientos'),('tratamientos','crear','Crear tratamientos'),('tratamientos','editar','Editar tratamientos'),
 ('vacunas','ver','Ver vacunaciones'),('vacunas','crear','Registrar vacunaciones'),('vacunas','editar','Editar vacunaciones'),
 ('desparasitacion','ver','Ver desparasitaciones'),('desparasitacion','crear','Registrar desparasitaciones'),('desparasitacion','editar','Editar desparasitaciones'),
 ('estudios','ver','Ver estudios'),('estudios','crear','Registrar estudios'),('estudios','editar','Editar estudios'),
 ('orden_recepcion','ver','Ver órdenes administrativas de cierre'),('orden_recepcion','procesar','Procesar órdenes de recepción')
) p(m,a,d) ON CONFLICT DO NOTHING;
INSERT INTO public.rol_permiso SELECT 'admin',clave FROM public.permiso ON CONFLICT DO NOTHING;
INSERT INTO public.rol_permiso SELECT 'medico',clave FROM public.permiso WHERE modulo IN ('tratamientos','vacunas','desparasitacion','estudios')
 OR clave IN ('consultas.finalizar','orden_recepcion.ver') ON CONFLICT DO NOTHING;
INSERT INTO public.rol_permiso VALUES('recepcionista','orden_recepcion.ver'),('recepcionista','orden_recepcion.procesar') ON CONFLICT DO NOTHING;

ALTER TABLE public.perfilusuario ADD COLUMN cedula_profesional varchar(30)
 CHECK(cedula_profesional IS NULL OR cedula_profesional ~ '^[0-9]{5,20}$');
CREATE TABLE public.consulta (
 id_consulta uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,
 id_cita uuid NOT NULL UNIQUE, id_mascota uuid NOT NULL REFERENCES public.mascota ON DELETE RESTRICT,
 id_dueno uuid NOT NULL, id_medico uuid NOT NULL, fecha_inicio timestamptz NOT NULL DEFAULT now(),fecha_fin timestamptz,
 motivo_consulta text NOT NULL,anamnesis text,exploracion_fisica text,
 temperatura numeric(5,2) CHECK(temperatura>0 AND temperatura<70),
 frecuencia_cardiaca integer CHECK(frecuencia_cardiaca BETWEEN 0 AND 500),
 frecuencia_respiratoria integer CHECK(frecuencia_respiratoria BETWEEN 0 AND 400),mucosas text,trc text,
 peso numeric(10,3) CHECK(peso>0 AND peso<100000),observaciones text,pronostico text,indicaciones text,
 observaciones_administrativas text,proxima_cita date,
 estado text NOT NULL DEFAULT 'en_curso' CHECK(estado IN ('en_curso','finalizada')),
 contexto jsonb NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),auditoria jsonb NOT NULL DEFAULT '[]',
 creado_en timestamptz NOT NULL DEFAULT now(),actualizado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id_consulta,id_veterinaria),
 FOREIGN KEY(id_cita,id_veterinaria) REFERENCES public.cita(id_cita,id_veterinaria) ON DELETE RESTRICT,
 FOREIGN KEY(id_dueno,id_veterinaria) REFERENCES public.dueno(id_dueno,id_veterinaria) ON DELETE RESTRICT,
 FOREIGN KEY(id_medico,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria) ON DELETE RESTRICT,
 CHECK((estado='en_curso' AND fecha_fin IS NULL) OR (estado='finalizada' AND fecha_fin IS NOT NULL))
);
CREATE INDEX consulta_tenant_medico_fecha_idx ON public.consulta(id_veterinaria,id_medico,fecha_inicio DESC);
CREATE INDEX consulta_medico_tenant_idx ON public.consulta(id_medico,id_veterinaria);
CREATE INDEX consulta_dueno_tenant_idx ON public.consulta(id_dueno,id_veterinaria);
CREATE INDEX consulta_paciente_fecha_idx ON public.consulta(id_mascota,fecha_inicio DESC);
CREATE INDEX consulta_cita_tenant_idx ON public.consulta(id_cita,id_veterinaria);

ALTER TABLE public.diagnostico ADD COLUMN id_consulta uuid, ADD COLUMN id_medico uuid,
 ADD COLUMN tipo text CHECK(tipo IN ('presuntivo','definitivo')),
 ADD CONSTRAINT diagnostico_consulta_tenant_fk FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria) ON DELETE RESTRICT,
 ADD CONSTRAINT diagnostico_medico_tenant_fk FOREIGN KEY(id_medico,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria) ON DELETE RESTRICT;
CREATE INDEX diagnostico_consulta_tenant_idx ON public.diagnostico(id_consulta,id_veterinaria);
CREATE INDEX diagnostico_medico_tenant_idx ON public.diagnostico(id_medico,id_veterinaria);
CREATE INDEX diagnostico_paciente_idx ON public.diagnostico(id_mascota);
CREATE INDEX diagnostico_dueno_idx ON public.diagnostico(id_dueno);
CREATE INDEX diagnostico_tenant_idx ON public.diagnostico(id_veterinaria);
CREATE TABLE public.tratamiento (
 id_tratamiento uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_consulta uuid NOT NULL,id_veterinaria uuid NOT NULL,
 descripcion text NOT NULL,indicaciones text,duracion text,observaciones text,creado_en timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria) ON DELETE RESTRICT
);
ALTER TABLE public.receta ADD COLUMN id_consulta uuid,ADD COLUMN id_medico uuid,ADD COLUMN id_veterinaria uuid,
 ADD COLUMN creado_en timestamptz NOT NULL DEFAULT now(),
 ADD CONSTRAINT receta_consulta_key UNIQUE(id_consulta),ADD CONSTRAINT receta_id_tenant_key UNIQUE(id_receta,id_veterinaria),
 ADD CONSTRAINT receta_consulta_tenant_fk FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria) ON DELETE RESTRICT,
 ADD CONSTRAINT receta_medico_tenant_fk FOREIGN KEY(id_medico,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria) ON DELETE RESTRICT;
-- A legacy diagnosis uniquely determines its prescription's clinic; never invent a consultation.
UPDATE public.receta r SET id_veterinaria=d.id_veterinaria FROM public.diagnostico d WHERE r.id_diagnostico=d.id_diagnostico AND r.id_veterinaria IS NULL;
CREATE INDEX receta_consulta_tenant_idx ON public.receta(id_consulta,id_veterinaria);
CREATE INDEX receta_medico_tenant_idx ON public.receta(id_medico,id_veterinaria);
CREATE INDEX receta_diagnostico_idx ON public.receta(id_diagnostico);
CREATE INDEX receta_producto_legacy_idx ON public.receta(id_producto);
CREATE INDEX receta_tenant_idx ON public.receta(id_veterinaria);
CREATE TABLE public.receta_detalle (
 id_detalle uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_receta uuid NOT NULL,id_veterinaria uuid NOT NULL,
 nombre_medicamento text NOT NULL,principio_activo text,concentracion text,presentacion text,
 dosis text NOT NULL,frecuencia text NOT NULL,duracion text NOT NULL,via_administracion text NOT NULL,
 cantidad numeric(12,3) NOT NULL CHECK(cantidad>0),indicaciones text,tiempo_retiro text,
 grupo_prescripcion text NOT NULL DEFAULT 'no_clasificado' CHECK(grupo_prescripcion IN ('I','II','III','no_clasificado')),
 entregar boolean NOT NULL DEFAULT false,
 FOREIGN KEY(id_receta,id_veterinaria) REFERENCES public.receta(id_receta,id_veterinaria) ON DELETE RESTRICT
);
CREATE TABLE public.vacunacion (
 id_vacuna uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_consulta uuid NOT NULL,id_mascota uuid NOT NULL REFERENCES public.mascota ON DELETE RESTRICT,
 id_veterinaria uuid NOT NULL,nombre text NOT NULL,laboratorio text,lote text,fecha_aplicacion date NOT NULL,proxima_aplicacion date,observaciones text,
 FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria) ON DELETE RESTRICT,
 CHECK(proxima_aplicacion IS NULL OR proxima_aplicacion>=fecha_aplicacion)
);
CREATE INDEX vacunacion_paciente_idx ON public.vacunacion(id_mascota);
CREATE TABLE public.desparasitacion (
 id_desparasitacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_consulta uuid NOT NULL,id_mascota uuid NOT NULL REFERENCES public.mascota ON DELETE RESTRICT,
 id_veterinaria uuid NOT NULL,producto text NOT NULL,dosis text NOT NULL,peso numeric(10,3) CHECK(peso>0),fecha date NOT NULL,proxima_fecha date,observaciones text,
 FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria) ON DELETE RESTRICT,
 CHECK(proxima_fecha IS NULL OR proxima_fecha>=fecha)
);
CREATE INDEX desparasitacion_paciente_idx ON public.desparasitacion(id_mascota);
CREATE TABLE public.estudio_clinico (
 id_estudio uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_consulta uuid NOT NULL,id_mascota uuid NOT NULL REFERENCES public.mascota ON DELETE RESTRICT,
 id_veterinaria uuid NOT NULL,tipo text NOT NULL CHECK(tipo IN ('radiografia','ultrasonido','laboratorio','otro')),
 nombre text NOT NULL,resultado text,observaciones text,fecha date NOT NULL,archivo_url text CHECK(archivo_url IS NULL OR archivo_url ~ '^https://'),
 FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria) ON DELETE RESTRICT
);
CREATE INDEX estudio_paciente_idx ON public.estudio_clinico(id_mascota);
CREATE TABLE public.orden_recepcion (
 id_orden uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_consulta uuid NOT NULL,id_veterinaria uuid NOT NULL,
 revision integer NOT NULL,estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','procesada','anulada')),
 contenido jsonb NOT NULL,creado_en timestamptz NOT NULL DEFAULT now(),procesado_en timestamptz,procesado_por uuid,
 UNIQUE(id_consulta,revision),UNIQUE(id_orden,id_veterinaria),
 FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria) ON DELETE RESTRICT,
 FOREIGN KEY(procesado_por,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria) ON DELETE RESTRICT
);
CREATE INDEX orden_recepcion_tenant_estado_idx ON public.orden_recepcion(id_veterinaria,estado,creado_en);
CREATE INDEX orden_recepcion_procesador_idx ON public.orden_recepcion(procesado_por,id_veterinaria);
CREATE TABLE public.documento_clinico (
 id_documento uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_consulta uuid NOT NULL,id_veterinaria uuid NOT NULL,
 revision integer NOT NULL,tipo text NOT NULL CHECK(tipo IN ('nota_consulta','plan_tratamiento','orden_recepcion','receta_simple')),
 contenido jsonb NOT NULL,creado_en timestamptz NOT NULL DEFAULT now(),UNIQUE(id_consulta,revision,tipo),
 FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria) ON DELETE RESTRICT
);
COMMENT ON TABLE public.documento_clinico IS 'Immutable finalized data snapshots. Backend automatically renders PDFKit documents from these snapshots, including authenticated downloads; no legal signature or official folios are invented.';

CREATE FUNCTION private.cl_can(p_permiso text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.my_veterinaria() IS NOT NULL AND private.has_permission(p_permiso)
 AND EXISTS(SELECT 1 FROM public.perfilusuario p WHERE p.id=auth.uid() AND p.rol IN ('admin','medico') AND p.activo);
$$;
CREATE FUNCTION private.cl_authorize(p_id uuid,p_permiso text,p_write boolean DEFAULT false) RETURNS public.consulta
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; c public.consulta; tenant uuid; BEGIN
 IF p_write THEN actor:=private.lock_actor(p_permiso);tenant:=actor.id_veterinaria; ELSE tenant:=private.my_veterinaria(); END IF;
 IF NOT private.cl_can(p_permiso) THEN RAISE EXCEPTION 'Acceso clínico requerido' USING ERRCODE='42501'; END IF;
 IF p_write THEN SELECT * INTO c FROM public.consulta WHERE id_consulta=p_id AND id_veterinaria=tenant FOR UPDATE;
 ELSE SELECT * INTO c FROM public.consulta WHERE id_consulta=p_id AND id_veterinaria=tenant; END IF;
 IF c.id_consulta IS NULL THEN RAISE EXCEPTION 'Consulta no encontrada' USING ERRCODE='P0002'; END IF;
 IF p_write AND c.id_medico<>auth.uid() AND NOT private.has_permission('consultas.tomar_ajenas') THEN
  RAISE EXCEPTION 'Consulta asignada a otro médico' USING ERRCODE='42501'; END IF;
 RETURN c;
END $$;
CREATE FUNCTION private.cl_open(p_id uuid,p_permiso text) RETURNS public.consulta
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ DECLARE c public.consulta; BEGIN
 c:=private.cl_authorize(p_id,p_permiso,true);
 IF c.estado<>'en_curso' THEN RAISE EXCEPTION 'Consulta finalizada; requiere reapertura autorizada' USING ERRCODE='23514'; END IF;
 RETURN c;
END $$;
CREATE FUNCTION private.cl_raw(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('consulta',to_jsonb(c)-'contexto','contexto',c.contexto,
 'diagnosticos',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY fecha,id_diagnostico) FROM public.diagnostico x WHERE id_consulta=c.id_consulta),'[]'),
 'tratamientos',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY creado_en,id_tratamiento) FROM public.tratamiento x WHERE id_consulta=c.id_consulta),'[]'),
 'receta',(SELECT to_jsonb(r)||jsonb_build_object('detalles',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY id_detalle) FROM public.receta_detalle d WHERE d.id_receta=r.id_receta),'[]')) FROM public.receta r WHERE r.id_consulta=c.id_consulta),
 'vacunas',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY fecha_aplicacion,id_vacuna) FROM public.vacunacion x WHERE id_consulta=c.id_consulta),'[]'),
 'desparasitaciones',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY fecha,id_desparasitacion) FROM public.desparasitacion x WHERE id_consulta=c.id_consulta),'[]'),
 'estudios',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY fecha,id_estudio) FROM public.estudio_clinico x WHERE id_consulta=c.id_consulta),'[]'),
 'servicios',coalesce((SELECT jsonb_agg(jsonb_build_object('id_servicio',s.id_servicio,'nombre',s.nombre,'precio_aplicado',cs.precio_aplicado,'duracion_aplicada',cs.duracion_aplicada,'estado',cs.estado) ORDER BY cs.creado_en,s.nombre) FROM public.cita_servicio cs JOIN public.servicio s USING(id_servicio) WHERE cs.id_cita=c.id_cita),'[]'),
 'documentos',coalesce((SELECT jsonb_agg(to_jsonb(x)-'contenido' ORDER BY creado_en,tipo) FROM public.documento_clinico x WHERE id_consulta=c.id_consulta),'[]'),
 'ordenes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY creado_en) FROM public.orden_recepcion x WHERE id_consulta=c.id_consulta),'[]'))
 FROM public.consulta c WHERE c.id_consulta=p_id;
$$;
CREATE FUNCTION private.cl_view(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.consulta; data jsonb; BEGIN
 c:=private.cl_authorize(p_id,'consultas.ver');data:=private.cl_raw(c.id_consulta);
 IF NOT private.has_permission('diagnosticos.ver') THEN data:=data-'diagnosticos'; END IF;
 IF NOT private.has_permission('tratamientos.ver') THEN data:=data-'tratamientos'; END IF;
 IF NOT private.has_permission('recetas.ver') THEN data:=data-'receta'; END IF;
 IF NOT private.has_permission('vacunas.ver') THEN data:=data-'vacunas'; END IF;
 IF NOT private.has_permission('desparasitacion.ver') THEN data:=data-'desparasitaciones'; END IF;
 IF NOT private.has_permission('estudios.ver') THEN data:=data-'estudios'; END IF;
 IF NOT private.has_permission('orden_recepcion.ver') THEN data:=data-'ordenes'; END IF;
 data:=jsonb_set(data,'{documentos}',coalesce((SELECT jsonb_agg(d) FROM jsonb_array_elements(data->'documentos') d
  WHERE private.has_permission(CASE d->>'tipo' WHEN 'orden_recepcion' THEN 'orden_recepcion.ver' WHEN 'receta_simple' THEN 'recetas.ver'
   WHEN 'plan_tratamiento' THEN 'tratamientos.ver' ELSE 'consultas.ver' END)),'[]'));
 -- Metadata alone does not authorize downloading each document; cl_document checks its own permission.
 RETURN data;
END $$;
CREATE FUNCTION private.cl_list(p_mias boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT private.cl_can('consultas.ver') THEN RAISE EXCEPTION 'Acceso clínico requerido' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id_consulta',c.id_consulta,'id_cita',c.id_cita,'id_medico',c.id_medico,'id_mascota',c.id_mascota,
 'paciente',c.contexto->'paciente'->>'nombre','propietario',c.contexto->'propietario'->>'nombre','medico',c.contexto->'medico'->>'nombre',
 'fecha_inicio',c.fecha_inicio,'estado',c.estado,'motivo_consulta',c.motivo_consulta) ORDER BY c.fecha_inicio DESC)
 FROM public.consulta c WHERE c.id_veterinaria=private.my_veterinaria() AND (NOT coalesce(p_mias,false) OR c.id_medico=auth.uid())),'[]');
END $$;
CREATE FUNCTION private.cl_start(p_cita uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; a public.cita; cid uuid; context jsonb; BEGIN
 actor:=private.lock_actor('consultas.crear');
 IF NOT private.cl_can('consultas.crear') THEN RAISE EXCEPTION 'Acceso clínico requerido' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.cita WHERE id_cita=p_cita AND id_veterinaria=actor.id_veterinaria FOR UPDATE;
 IF a.id_cita IS NULL THEN RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE='P0002'; END IF;
 IF a.id_medico IS NULL OR (a.id_medico<>actor.id AND NOT private.has_permission('consultas.tomar_ajenas')) THEN
  RAISE EXCEPTION 'Se requiere el médico asignado' USING ERRCODE='42501'; END IF;
 PERFORM private.op_doctor(a.id_medico,actor.id_veterinaria,true);
 SELECT id_consulta INTO cid FROM public.consulta WHERE id_cita=a.id_cita;
 IF cid IS NOT NULL THEN RETURN private.cl_view(cid); END IF;
 IF a.estado NOT IN ('programada','confirmada','en_espera') THEN RAISE EXCEPTION 'Cita no disponible para consulta' USING ERRCODE='23514'; END IF;
 SELECT jsonb_build_object('clinica',jsonb_build_object('nombre',v.nombre,'direccion',v.direccion,'telefono',v.telefono),
  'paciente',jsonb_build_object('id_mascota',m.id_mascota,'nombre',m.nombre,'especie',m.especie,'raza',m.raza,'sexo',m.sexo,'peso',m.peso_actual),
  'propietario',jsonb_build_object('id_dueno',d.id_dueno,'nombre',d.nombre,'telefono',d.telefono,'direccion',d.direccion),
  'medico',jsonb_build_object('id',p.id,'nombre',p.nombre,'cedula_profesional',p.cedula_profesional)) INTO context
 FROM public.veterinaria v JOIN public.dueno d ON d.id_dueno=a.id_dueno AND d.id_veterinaria=v.id_veterinaria
 JOIN public.mascota m ON m.id_mascota=a.id_mascota
 JOIN public.perfilusuario p ON p.id=a.id_medico AND p.id_veterinaria=v.id_veterinaria
 WHERE v.id_veterinaria=actor.id_veterinaria AND private.owner_in_my_tenant(m.id_dueno);
 IF context IS NULL THEN RAISE EXCEPTION 'Referencias clínicas no válidas' USING ERRCODE='23514'; END IF;
 INSERT INTO public.consulta(id_cita,id_mascota,id_dueno,id_medico,id_veterinaria,motivo_consulta,contexto,peso)
 VALUES(a.id_cita,a.id_mascota,a.id_dueno,a.id_medico,actor.id_veterinaria,coalesce(a.motivo,'Consulta veterinaria'),context,(context->'paciente'->>'peso')::numeric)
 RETURNING id_consulta INTO cid;
 UPDATE public.cita SET estado='en_consulta' WHERE id_cita=a.id_cita;
 RETURN private.cl_view(cid);
END $$;
CREATE FUNCTION private.cl_save(p_id uuid,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.consulta; key text; v text; BEGIN
 c:=private.cl_open(p_id,'consultas.editar');
 PERFORM private.op_body(p_datos,ARRAY['motivo_consulta','anamnesis','exploracion_fisica','temperatura','frecuencia_cardiaca','frecuencia_respiratoria','mucosas','trc','peso','observaciones','pronostico','indicaciones','observaciones_administrativas','proxima_cita']);
 FOR key,v IN SELECT * FROM jsonb_each_text(p_datos) LOOP
  IF length(v)>20000 THEN RAISE EXCEPTION 'Campo clínico demasiado largo' USING ERRCODE='22023'; END IF;
 END LOOP;
 UPDATE public.consulta SET
 motivo_consulta=CASE WHEN p_datos?'motivo_consulta' THEN nullif(btrim(p_datos->>'motivo_consulta'),'') ELSE motivo_consulta END,
 anamnesis=CASE WHEN p_datos?'anamnesis' THEN p_datos->>'anamnesis' ELSE anamnesis END,
 exploracion_fisica=CASE WHEN p_datos?'exploracion_fisica' THEN p_datos->>'exploracion_fisica' ELSE exploracion_fisica END,
 temperatura=CASE WHEN p_datos?'temperatura' THEN (p_datos->>'temperatura')::numeric ELSE temperatura END,
 frecuencia_cardiaca=CASE WHEN p_datos?'frecuencia_cardiaca' THEN (p_datos->>'frecuencia_cardiaca')::integer ELSE frecuencia_cardiaca END,
 frecuencia_respiratoria=CASE WHEN p_datos?'frecuencia_respiratoria' THEN (p_datos->>'frecuencia_respiratoria')::integer ELSE frecuencia_respiratoria END,
 mucosas=CASE WHEN p_datos?'mucosas' THEN p_datos->>'mucosas' ELSE mucosas END,trc=CASE WHEN p_datos?'trc' THEN p_datos->>'trc' ELSE trc END,
 peso=CASE WHEN p_datos?'peso' THEN (p_datos->>'peso')::numeric ELSE peso END,
 observaciones=CASE WHEN p_datos?'observaciones' THEN p_datos->>'observaciones' ELSE observaciones END,
 pronostico=CASE WHEN p_datos?'pronostico' THEN p_datos->>'pronostico' ELSE pronostico END,
 indicaciones=CASE WHEN p_datos?'indicaciones' THEN p_datos->>'indicaciones' ELSE indicaciones END,
 observaciones_administrativas=CASE WHEN p_datos?'observaciones_administrativas' THEN p_datos->>'observaciones_administrativas' ELSE observaciones_administrativas END,
 proxima_cita=CASE WHEN p_datos?'proxima_cita' THEN (p_datos->>'proxima_cita')::date ELSE proxima_cita END,actualizado_en=now()
 WHERE id_consulta=c.id_consulta;
 RETURN private.cl_view(c.id_consulta);
END $$;
CREATE FUNCTION private.cl_license(p_medico uuid,p_cedula text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; BEGIN
 actor:=private.lock_actor(CASE WHEN p_medico=auth.uid() THEN 'consultas.editar' ELSE 'usuarios.editar' END);
 IF actor.rol NOT IN ('admin','medico') OR (p_medico<>actor.id AND actor.rol<>'admin') THEN RAISE EXCEPTION 'Acceso profesional requerido' USING ERRCODE='42501'; END IF;
 PERFORM private.op_doctor(p_medico,actor.id_veterinaria);
 IF p_cedula IS NOT NULL AND p_cedula!~'^[0-9]{5,20}$' THEN RAISE EXCEPTION 'Cédula inválida' USING ERRCODE='22023'; END IF;
 UPDATE public.perfilusuario SET cedula_profesional=p_cedula WHERE id=p_medico;
 RETURN jsonb_build_object('id',p_medico,'cedula_profesional',p_cedula);
END $$;
CREATE FUNCTION private.cl_clinic(p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; v public.veterinaria; BEGIN
 actor:=private.lock_actor('configuracion.editar');
 IF actor.rol<>'admin' THEN RAISE EXCEPTION 'Administrador de clínica requerido' USING ERRCODE='42501'; END IF;
 PERFORM private.op_body(p_datos,ARRAY['nombre','direccion','telefono']);
 IF (p_datos?'nombre' AND (nullif(btrim(p_datos->>'nombre'),'') IS NULL OR length(p_datos->>'nombre')>150))
  OR length(p_datos->>'direccion')>2000 OR length(p_datos->>'telefono')>20 THEN RAISE EXCEPTION 'Datos profesionales no válidos' USING ERRCODE='22023'; END IF;
 UPDATE public.veterinaria SET nombre=CASE WHEN p_datos?'nombre' THEN btrim(p_datos->>'nombre') ELSE nombre END,
  direccion=CASE WHEN p_datos?'direccion' THEN nullif(btrim(p_datos->>'direccion'),'') ELSE direccion END,
  telefono=CASE WHEN p_datos?'telefono' THEN nullif(btrim(p_datos->>'telefono'),'') ELSE telefono END
 WHERE id_veterinaria=actor.id_veterinaria RETURNING * INTO v;
 RETURN jsonb_build_object('nombre',v.nombre,'direccion',v.direccion,'telefono',v.telefono);
END $$;
CREATE FUNCTION private.cl_record(p_consulta uuid,p_tipo text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.consulta; rid uuid; r public.receta; detail jsonb; module text; idkey text; tab text; key text; value text; columns_sql text; values_sql text; update_sql text; allowed text[]; actor_perm text; BEGIN
 module:=CASE p_tipo WHEN 'diagnostico' THEN 'diagnosticos' WHEN 'tratamiento' THEN 'tratamientos' WHEN 'receta' THEN 'recetas'
  WHEN 'vacuna' THEN 'vacunas' WHEN 'desparasitacion' THEN 'desparasitacion' WHEN 'estudio' THEN 'estudios' ELSE NULL END;
 IF module IS NULL THEN RAISE EXCEPTION 'Tipo clínico inválido' USING ERRCODE='22023'; END IF;
 actor_perm:=module||CASE WHEN p_datos?'id' OR (p_tipo='receta' AND EXISTS(SELECT 1 FROM public.receta WHERE id_consulta=p_consulta)) THEN '.editar' ELSE '.crear' END;
 c:=private.cl_open(p_consulta,actor_perm);
 IF p_tipo='receta' THEN
  PERFORM private.op_body(p_datos,ARRAY['indicaciones','detalles']);
  IF jsonb_typeof(p_datos->'detalles') IS DISTINCT FROM 'array' OR jsonb_array_length(p_datos->'detalles') NOT BETWEEN 1 AND 50 OR length(p_datos->>'indicaciones')>20000 THEN
   RAISE EXCEPTION 'Receta requiere de uno a cincuenta medicamentos' USING ERRCODE='22023'; END IF;
  INSERT INTO public.receta(id_consulta,id_medico,id_veterinaria,indicaciones) VALUES(c.id_consulta,c.id_medico,c.id_veterinaria,p_datos->>'indicaciones')
   ON CONFLICT(id_consulta) DO UPDATE SET indicaciones=EXCLUDED.indicaciones RETURNING * INTO r;
  DELETE FROM public.receta_detalle WHERE id_receta=r.id_receta;
  FOR detail IN SELECT x FROM jsonb_array_elements(p_datos->'detalles') x LOOP
   PERFORM private.op_body(detail,ARRAY['nombre_medicamento','principio_activo','concentracion','presentacion','dosis','frecuencia','duracion','via_administracion','cantidad','indicaciones','grupo_prescripcion','tiempo_retiro','entregar']);
   FOREACH key IN ARRAY ARRAY['nombre_medicamento','dosis','frecuencia','duracion','via_administracion'] LOOP
    IF nullif(btrim(detail->>key),'') IS NULL OR length(detail->>key)>2000 THEN RAISE EXCEPTION 'Campo requerido de medicamento: %',key USING ERRCODE='22023'; END IF;
   END LOOP;
   FOR key,value IN SELECT * FROM jsonb_each_text(detail) LOOP IF length(value)>5000 THEN RAISE EXCEPTION 'Dato de receta demasiado largo' USING ERRCODE='22023'; END IF; END LOOP;
   INSERT INTO public.receta_detalle(id_receta,id_veterinaria,nombre_medicamento,principio_activo,concentracion,presentacion,dosis,frecuencia,duracion,via_administracion,cantidad,indicaciones,grupo_prescripcion,tiempo_retiro,entregar)
   VALUES(r.id_receta,c.id_veterinaria,btrim(detail->>'nombre_medicamento'),detail->>'principio_activo',detail->>'concentracion',detail->>'presentacion',detail->>'dosis',detail->>'frecuencia',detail->>'duracion',detail->>'via_administracion',
    (detail->>'cantidad')::numeric,detail->>'indicaciones',coalesce(detail->>'grupo_prescripcion','no_clasificado'),detail->>'tiempo_retiro',coalesce((detail->>'entregar')::boolean,false));
  END LOOP;
 ELSE
  tab:=CASE p_tipo WHEN 'diagnostico' THEN 'diagnostico' WHEN 'tratamiento' THEN 'tratamiento' WHEN 'vacuna' THEN 'vacunacion' WHEN 'desparasitacion' THEN 'desparasitacion' ELSE 'estudio_clinico' END;
  idkey:=CASE p_tipo WHEN 'diagnostico' THEN 'id_diagnostico' WHEN 'tratamiento' THEN 'id_tratamiento' WHEN 'vacuna' THEN 'id_vacuna' WHEN 'desparasitacion' THEN 'id_desparasitacion' ELSE 'id_estudio' END;
  allowed:=CASE p_tipo WHEN 'diagnostico' THEN ARRAY['tipo','descripcion'] WHEN 'tratamiento' THEN ARRAY['descripcion','indicaciones','duracion','observaciones']
   WHEN 'vacuna' THEN ARRAY['nombre','laboratorio','lote','fecha_aplicacion','proxima_aplicacion','observaciones']
   WHEN 'desparasitacion' THEN ARRAY['producto','dosis','peso','fecha','proxima_fecha','observaciones'] ELSE ARRAY['tipo','nombre','resultado','observaciones','fecha','archivo_url'] END;
  PERFORM private.op_body(p_datos,allowed||ARRAY['id']);
  FOREACH key IN ARRAY CASE p_tipo WHEN 'diagnostico' THEN ARRAY['descripcion','tipo'] WHEN 'tratamiento' THEN ARRAY['descripcion']
   WHEN 'vacuna' THEN ARRAY['nombre','fecha_aplicacion'] WHEN 'desparasitacion' THEN ARRAY['producto','dosis','fecha'] ELSE ARRAY['nombre','tipo','fecha'] END LOOP
   IF nullif(btrim(p_datos->>key),'') IS NULL THEN RAISE EXCEPTION 'Campo clínico requerido: %',key USING ERRCODE='22023'; END IF;
  END LOOP;
  IF p_datos?'id' THEN
   rid:=(p_datos->>'id')::uuid;
   EXECUTE format('SELECT %I FROM public.%I WHERE %I=$1 AND id_consulta=$2 AND id_veterinaria=$3',idkey,tab,idkey) INTO rid USING rid,c.id_consulta,c.id_veterinaria;
   IF rid IS NULL THEN RAISE EXCEPTION 'Registro clínico no encontrado' USING ERRCODE='P0002'; END IF;
  ELSE rid:=gen_random_uuid(); END IF;
  columns_sql:=format('%I,id_consulta,id_veterinaria',idkey);
  values_sql:='$2,$3,$4';update_sql:='';
  IF p_tipo='diagnostico' THEN columns_sql:=columns_sql||',id_mascota,id_dueno,id_medico';values_sql:=values_sql||',$5,$6,$7'; END IF;
  IF p_tipo IN ('vacuna','desparasitacion','estudio') THEN columns_sql:=columns_sql||',id_mascota';values_sql:=values_sql||',$5'; END IF;
  FOREACH key IN ARRAY allowed LOOP
   IF p_datos?key THEN
    value:=p_datos->>key;
    IF length(value)>20000 THEN RAISE EXCEPTION 'Dato clínico demasiado largo' USING ERRCODE='22023'; END IF;
    columns_sql:=columns_sql||format(',%I',key);
    values_sql:=values_sql||format(',($1->>%L)',key)||CASE WHEN key IN ('fecha','fecha_aplicacion','proxima_fecha','proxima_aplicacion') THEN '::date' WHEN key='peso' THEN '::numeric' ELSE '' END;
    update_sql:=update_sql||CASE WHEN update_sql='' THEN '' ELSE ',' END||format('%I=EXCLUDED.%I',key,key);
   END IF;
  END LOOP;
  IF update_sql='' THEN RAISE EXCEPTION 'Registro sin datos' USING ERRCODE='22023'; END IF;
  -- Table and column identifiers come exclusively from the fixed whitelist above.
  EXECUTE format('INSERT INTO public.%I(%s) VALUES(%s) ON CONFLICT(%I) DO UPDATE SET %s',tab,columns_sql,values_sql,idkey,update_sql)
   USING p_datos,rid,c.id_consulta,c.id_veterinaria,c.id_mascota,c.id_dueno,c.id_medico;
 END IF;
 UPDATE public.consulta SET actualizado_en=now() WHERE id_consulta=c.id_consulta;
 RETURN private.cl_view(c.id_consulta);
END $$;
CREATE FUNCTION private.cl_add_service(p_consulta uuid,p_servicio uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.consulta; s public.servicio; BEGIN
 c:=private.cl_open(p_consulta,'consultas.editar');
 SELECT * INTO s FROM public.servicio WHERE id_servicio=p_servicio AND id_veterinaria=c.id_veterinaria AND activo;
 IF s.id_servicio IS NULL THEN RAISE EXCEPTION 'Servicio no disponible' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.cita_servicio(id_cita,id_servicio,id_veterinaria,precio_aplicado,duracion_aplicada)
 VALUES(c.id_cita,s.id_servicio,c.id_veterinaria,s.costo,s.duracion_minutos) ON CONFLICT(id_cita,id_servicio) DO NOTHING;
 -- Additional clinical work never silently reschedules or overlaps another appointment.
 RETURN private.cl_view(c.id_consulta);
END $$;
CREATE FUNCTION private.cl_finish(p_id uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.consulta; data jsonb; administrative jsonb; rx_count integer; blocked boolean; license text; doc text; clinic jsonb; patient jsonb; BEGIN
 c:=private.cl_authorize(p_id,'consultas.finalizar',true);
 IF c.estado='finalizada' THEN RETURN private.cl_view(c.id_consulta); END IF;
 IF nullif(btrim(c.motivo_consulta),'') IS NULL THEN RAISE EXCEPTION 'Motivo clínico requerido' USING ERRCODE='22023'; END IF;
 SELECT count(*),coalesce(bool_or(d.grupo_prescripcion IN ('I','no_clasificado')),false) INTO rx_count,blocked
 FROM public.receta_detalle d JOIN public.receta r USING(id_receta) WHERE r.id_consulta=c.id_consulta;
 SELECT cedula_profesional INTO license FROM public.perfilusuario WHERE id=c.id_medico;
 SELECT jsonb_build_object('nombre',nombre,'direccion',direccion,'telefono',telefono) INTO clinic FROM public.veterinaria WHERE id_veterinaria=c.id_veterinaria;
 SELECT c.contexto->'paciente'||jsonb_build_object('especie',especie,'raza',raza) INTO patient FROM public.mascota WHERE id_mascota=c.id_mascota;
 IF rx_count>0 AND NOT blocked AND license IS NULL THEN RAISE EXCEPTION 'Cédula profesional requerida para emitir receta' USING ERRCODE='22023'; END IF;
 IF rx_count>0 AND NOT blocked AND (nullif(btrim(clinic->>'direccion'),'') IS NULL OR nullif(btrim(patient->>'especie'),'') IS NULL) THEN
  RAISE EXCEPTION 'Receta requiere domicilio profesional y especie del paciente' USING ERRCODE='22023'; END IF;
 UPDATE public.consulta SET estado='finalizada',fecha_fin=now(),actualizado_en=now(),
  contexto=jsonb_set(jsonb_set(jsonb_set(contexto,'{medico,cedula_profesional}',coalesce(to_jsonb(license),'null')),'{clinica}',clinic),'{paciente}',patient) WHERE id_consulta=c.id_consulta;
 UPDATE public.cita SET estado='completada' WHERE id_cita=c.id_cita;
 UPDATE public.cita_servicio SET estado='realizado' WHERE id_cita=c.id_cita AND estado='pendiente';
 data:=private.cl_raw(c.id_consulta);
 administrative:=jsonb_build_object('consulta',jsonb_build_object('id_consulta',c.id_consulta,'revision',c.revision,'fecha_fin',now()),
  'clinica',clinic,'paciente',jsonb_build_object('nombre',patient->>'nombre','especie',patient->>'especie'),
  'propietario',jsonb_build_object('nombre',c.contexto->'propietario'->>'nombre'),'medico',jsonb_build_object('nombre',c.contexto->'medico'->>'nombre'),
  'servicios',data->'servicios','productos',coalesce((SELECT jsonb_agg(jsonb_build_object('nombre',d.nombre_medicamento,'cantidad',d.cantidad,'id_detalle',d.id_detalle))
   FROM public.receta_detalle d JOIN public.receta r USING(id_receta) WHERE r.id_consulta=c.id_consulta AND d.entregar),'[]'),
  'proxima_cita',c.proxima_cita,'observaciones_administrativas',c.observaciones_administrativas);
 INSERT INTO public.orden_recepcion(id_consulta,id_veterinaria,revision,contenido) VALUES(c.id_consulta,c.id_veterinaria,c.revision,administrative) ON CONFLICT(id_consulta,revision) DO NOTHING;
 FOREACH doc IN ARRAY ARRAY['nota_consulta','plan_tratamiento','orden_recepcion','receta_simple'] LOOP
  IF doc='receta_simple' AND (rx_count=0 OR blocked) THEN CONTINUE; END IF;
  INSERT INTO public.documento_clinico(id_consulta,id_veterinaria,revision,tipo,contenido)
  VALUES(c.id_consulta,c.id_veterinaria,c.revision,doc,CASE WHEN doc='orden_recepcion' THEN administrative ELSE data END)
  ON CONFLICT(id_consulta,revision,tipo) DO NOTHING;
 END LOOP;
 RETURN private.cl_view(c.id_consulta);
END $$;
CREATE FUNCTION private.cl_reopen(p_id uuid,p_motivo text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.consulta; BEGIN
 c:=private.cl_authorize(p_id,'consultas.reabrir',true);
 IF c.estado<>'finalizada' OR nullif(btrim(p_motivo),'') IS NULL OR length(p_motivo)>2000 THEN RAISE EXCEPTION 'Reapertura requiere consulta finalizada y motivo' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.orden_recepcion WHERE id_consulta=c.id_consulta AND estado='procesada') THEN
  RAISE EXCEPTION 'La orden ya fue procesada; no se puede reabrir' USING ERRCODE='23514'; END IF;
 UPDATE public.orden_recepcion SET estado='anulada' WHERE id_consulta=c.id_consulta AND estado='pendiente';
 UPDATE public.consulta SET estado='en_curso',fecha_fin=NULL,revision=revision+1,actualizado_en=now(),
  auditoria=auditoria||jsonb_build_array(jsonb_build_object('accion','reabrir','usuario',auth.uid(),'fecha',now(),'motivo',p_motivo)) WHERE id_consulta=c.id_consulta;
 UPDATE public.cita SET estado='en_consulta' WHERE id_cita=c.id_cita;
 RETURN private.cl_view(c.id_consulta);
END $$;
CREATE FUNCTION private.cl_orders() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid:=private.op_tenant('orden_recepcion.ver'); BEGIN
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(o)||jsonb_build_object('id_documento',
  (SELECT d.id_documento FROM public.documento_clinico d WHERE d.id_consulta=o.id_consulta AND d.revision=o.revision AND d.tipo='orden_recepcion')) ORDER BY creado_en DESC)
  FROM public.orden_recepcion o WHERE id_veterinaria=tenant AND estado<>'anulada'),'[]');
END $$;
CREATE FUNCTION private.cl_process_order(p_id uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario; o public.orden_recepcion; BEGIN
 actor:=private.lock_actor('orden_recepcion.procesar');
 SELECT * INTO o FROM public.orden_recepcion WHERE id_orden=p_id AND id_veterinaria=actor.id_veterinaria FOR UPDATE;
 IF o.id_orden IS NULL THEN RAISE EXCEPTION 'Orden no encontrada' USING ERRCODE='P0002'; END IF;
 IF o.estado='anulada' THEN RAISE EXCEPTION 'Orden anulada' USING ERRCODE='23514'; END IF;
 IF o.estado='pendiente' THEN UPDATE public.orden_recepcion SET estado='procesada',procesado_por=actor.id,procesado_en=now() WHERE id_orden=o.id_orden RETURNING * INTO o; END IF;
 RETURN to_jsonb(o);
END $$;
CREATE FUNCTION private.cl_document(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.documento_clinico; permission text; BEGIN
 SELECT * INTO d FROM public.documento_clinico WHERE id_documento=p_id AND id_veterinaria=private.my_veterinaria();
 IF d.id_documento IS NULL THEN RAISE EXCEPTION 'Documento no encontrado' USING ERRCODE='P0002'; END IF;
 permission:=CASE d.tipo WHEN 'orden_recepcion' THEN 'orden_recepcion.ver' WHEN 'receta_simple' THEN 'recetas.ver' WHEN 'plan_tratamiento' THEN 'tratamientos.ver' ELSE 'consultas.ver' END;
 IF d.tipo='orden_recepcion' THEN PERFORM private.op_tenant(permission);
 ELSIF NOT private.cl_can(permission) THEN RAISE EXCEPTION 'Permiso clínico requerido' USING ERRCODE='42501'; END IF;
 RETURN to_jsonb(d);
END $$;
CREATE FUNCTION private.cl_record_history(p_mascota uuid,p_limite integer,p_offset integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE patient jsonb; entries jsonb; BEGIN
 IF NOT private.cl_can('expediente.ver') THEN RAISE EXCEPTION 'Acceso al expediente requerido' USING ERRCODE='42501'; END IF;
 IF p_limite NOT BETWEEN 1 AND 200 OR p_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'Paginación inválida' USING ERRCODE='22023'; END IF;
 SELECT to_jsonb(m) INTO patient FROM public.mascota m WHERE id_mascota=p_mascota AND private.owner_in_my_tenant(m.id_dueno);
 IF patient IS NULL THEN RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.fecha DESC,e.id DESC),'[]') INTO entries FROM (
  SELECT * FROM (
   SELECT c.id_consulta id,'consulta'::text tipo,c.fecha_inicio fecha,c.id_consulta,c.motivo_consulta descripcion,to_jsonb(c)-'contexto' datos FROM public.consulta c
    WHERE c.id_mascota=p_mascota AND c.id_veterinaria=private.my_veterinaria() AND private.has_permission('consultas.ver')
   UNION ALL SELECT d.id_diagnostico,'diagnostico',d.fecha AT TIME ZONE 'America/Tijuana',d.id_consulta,d.descripcion,to_jsonb(d) FROM public.diagnostico d
    WHERE d.id_mascota=p_mascota AND d.id_veterinaria=private.my_veterinaria() AND private.has_permission('diagnosticos.ver')
   UNION ALL SELECT t.id_tratamiento,'tratamiento',t.creado_en,t.id_consulta,t.descripcion,to_jsonb(t) FROM public.tratamiento t JOIN public.consulta c USING(id_consulta)
    WHERE c.id_mascota=p_mascota AND t.id_veterinaria=private.my_veterinaria() AND private.has_permission('tratamientos.ver')
   UNION ALL SELECT r.id_receta,'receta',r.creado_en,r.id_consulta,coalesce(r.indicaciones,'Receta'),to_jsonb(r)||jsonb_build_object('detalles',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.receta_detalle d WHERE d.id_receta=r.id_receta),'[]'))
    FROM public.receta r LEFT JOIN public.consulta c ON c.id_consulta=r.id_consulta LEFT JOIN public.diagnostico d ON d.id_diagnostico=r.id_diagnostico
    WHERE coalesce(c.id_mascota,d.id_mascota)=p_mascota AND r.id_veterinaria=private.my_veterinaria() AND private.has_permission('recetas.ver')
   UNION ALL SELECT v.id_vacuna,'vacuna',v.fecha_aplicacion::timestamp AT TIME ZONE 'America/Tijuana',v.id_consulta,v.nombre,to_jsonb(v) FROM public.vacunacion v
    WHERE v.id_mascota=p_mascota AND v.id_veterinaria=private.my_veterinaria() AND private.has_permission('vacunas.ver')
   UNION ALL SELECT d.id_desparasitacion,'desparasitacion',d.fecha::timestamp AT TIME ZONE 'America/Tijuana',d.id_consulta,d.producto,to_jsonb(d) FROM public.desparasitacion d
    WHERE d.id_mascota=p_mascota AND d.id_veterinaria=private.my_veterinaria() AND private.has_permission('desparasitacion.ver')
   UNION ALL SELECT s.id_estudio,'estudio',s.fecha::timestamp AT TIME ZONE 'America/Tijuana',s.id_consulta,s.nombre,to_jsonb(s) FROM public.estudio_clinico s
    WHERE s.id_mascota=p_mascota AND s.id_veterinaria=private.my_veterinaria() AND private.has_permission('estudios.ver')
   UNION ALL SELECT cs.id_servicio,'servicio',cs.creado_en,c.id_consulta,s.nombre,to_jsonb(cs)||jsonb_build_object('nombre',s.nombre) FROM public.cita_servicio cs
    JOIN public.cita a USING(id_cita) JOIN public.consulta c ON c.id_cita=a.id_cita JOIN public.servicio s ON s.id_servicio=cs.id_servicio
    WHERE a.id_mascota=p_mascota AND cs.id_veterinaria=private.my_veterinaria() AND private.has_permission('consultas.ver')
   UNION ALL SELECT h.id_historial,'historial_legacy',h.fecha_registro AT TIME ZONE 'America/Tijuana',NULL,h.observaciones,to_jsonb(h)
    FROM public.historialmedico h WHERE h.id_mascota=p_mascota AND private.has_permission('consultas.ver')
  ) all_entries ORDER BY fecha DESC,id DESC LIMIT p_limite OFFSET p_offset
 ) e;
 RETURN jsonb_build_object('paciente',patient,'entradas',entries,'offset',p_offset,'limite',p_limite,'hay_mas',jsonb_array_length(entries)=p_limite);
END $$;

-- Explicit table read policies; clients cannot mutate rows or upload forged PDF data directly.
DO $$ DECLARE t text; perm text; cols text; p record; BEGIN
 FOR t,perm IN SELECT * FROM (VALUES('consulta','consultas.ver'),('diagnostico','diagnosticos.ver'),('tratamiento','tratamientos.ver'),('receta','recetas.ver'),
  ('receta_detalle','recetas.ver'),('vacunacion','vacunas.ver'),('desparasitacion','desparasitacion.ver'),('estudio_clinico','estudios.ver'),('orden_recepcion','orden_recepcion.ver'),('documento_clinico','consultas.ver')) x(t,p) LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t); END LOOP;
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
  SELECT string_agg(format('%I',attname),',') INTO cols FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC,anon,authenticated',cols,t);
  IF t='orden_recepcion' THEN
   EXECUTE format('CREATE POLICY clinical_read ON public.%I FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (SELECT public.has_permission(%L)))',t,perm);
  ELSE
   EXECUTE format('CREATE POLICY clinical_read ON public.%I FOR SELECT TO authenticated USING(id_veterinaria=(SELECT public.get_my_veterinaria()) AND (SELECT private.cl_can(%L)))',t,perm);
  END IF;
  -- Document contents require per-type authorization in cl_document, never a broad SELECT grant.
  IF t<>'documento_clinico' THEN EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t); END IF;
  IF t NOT IN ('consulta','diagnostico','receta','receta_detalle') THEN
   EXECUTE format('CREATE INDEX %I ON public.%I(id_consulta,id_veterinaria)',t||'_consulta_tenant_idx',t);
   EXECUTE format('CREATE INDEX %I ON public.%I(id_veterinaria)',t||'_tenant_idx',t);
  END IF;
 END LOOP;
END $$;
-- receta_detalle references its header, not a redundant consultation.
CREATE INDEX receta_detalle_receta_tenant_idx ON public.receta_detalle(id_receta,id_veterinaria);
CREATE INDEX receta_detalle_tenant_idx ON public.receta_detalle(id_veterinaria);

CREATE FUNCTION public.vettrack_consultas(p_mias boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_list(p_mias); $$;
CREATE FUNCTION public.vettrack_iniciar_consulta(p_cita uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_start(p_cita); $$;
CREATE FUNCTION public.vettrack_consulta(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_view(p_id); $$;
CREATE FUNCTION public.vettrack_guardar_consulta(p_id uuid,p_datos jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_save(p_id,p_datos); $$;
CREATE FUNCTION public.vettrack_guardar_registro_clinico(p_consulta uuid,p_tipo text,p_datos jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_record(p_consulta,p_tipo,p_datos); $$;
CREATE FUNCTION public.vettrack_cedula_medico(p_medico uuid,p_cedula text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_license(p_medico,p_cedula); $$;
CREATE FUNCTION public.vettrack_datos_profesionales_clinica(p_datos jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_clinic(p_datos); $$;
CREATE FUNCTION public.vettrack_agregar_servicio_consulta(p_consulta uuid,p_servicio uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_add_service(p_consulta,p_servicio); $$;
CREATE FUNCTION public.vettrack_finalizar_consulta(p_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_finish(p_id); $$;
CREATE FUNCTION public.vettrack_reabrir_consulta(p_id uuid,p_motivo text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_reopen(p_id,p_motivo); $$;
CREATE FUNCTION public.vettrack_ordenes_recepcion() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_orders(); $$;
CREATE FUNCTION public.vettrack_procesar_orden_recepcion(p_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_process_order(p_id); $$;
CREATE FUNCTION public.vettrack_documento_clinico(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_document(p_id); $$;
CREATE FUNCTION public.vettrack_expediente(p_mascota uuid,p_limite integer DEFAULT 100,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.cl_record_history(p_mascota,p_limite,p_offset); $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='private' AND p.proname LIKE 'cl\_%' ESCAPE '\') OR (n.nspname='public' AND p.proname IN (
 'vettrack_consultas','vettrack_iniciar_consulta','vettrack_consulta','vettrack_guardar_consulta','vettrack_guardar_registro_clinico','vettrack_cedula_medico','vettrack_datos_profesionales_clinica',
 'vettrack_agregar_servicio_consulta','vettrack_finalizar_consulta','vettrack_reabrir_consulta','vettrack_ordenes_recepcion','vettrack_procesar_orden_recepcion','vettrack_documento_clinico','vettrack_expediente')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.nspname='public' OR f.proname IN ('cl_can','cl_list','cl_start','cl_view','cl_save','cl_record','cl_license','cl_clinic','cl_add_service','cl_finish','cl_reopen','cl_orders','cl_process_order','cl_document','cl_record_history') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  END IF;
 END LOOP;
END $$;
COMMIT;
