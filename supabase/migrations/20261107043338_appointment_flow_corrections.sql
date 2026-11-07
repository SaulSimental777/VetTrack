-- Incremental correction: automatic initial state, valid reception transitions, availability explanation.
BEGIN;
CREATE OR REPLACE FUNCTION private.op_guardar_cita(p_id uuid,p_datos jsonb) RETURNS jsonb
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
 IF p_id IS NULL AND item.estado<>'programada' THEN
  RAISE EXCEPTION 'Las nuevas citas se crean como programadas' USING ERRCODE='22023'; END IF;
 IF p_id IS NOT NULL AND item.estado IS DISTINCT FROM old.estado AND NOT (
  (old.estado='programada' AND item.estado IN ('confirmada','no_asistio')) OR
  (old.estado='confirmada' AND item.estado IN ('en_espera','no_asistio')) OR
  (old.estado='en_espera' AND item.estado='no_asistio')) THEN
  RAISE EXCEPTION 'Transición de cita no permitida' USING ERRCODE='23514'; END IF;
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

CREATE OR REPLACE FUNCTION private.op_disponibilidad(p_medico uuid,p_fecha date,p_duracion integer,p_servicios uuid[],p_excluir_cita uuid) RETURNS jsonb
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
 RETURN jsonb_build_object('fecha',p_fecha,'duracion_minutos',duration,'zona_horaria','America/Tijuana','bloque_maximo_minutos',coalesce((
  SELECT max(extract(epoch FROM(h.hora_fin-h.hora_inicio))/60)::integer FROM public.horario_medico h
  WHERE h.id_medico=p_medico AND h.id_veterinaria=tenant AND h.activo AND h.dia_semana=extract(dow FROM p_fecha)),0),'slots',coalesce((
  SELECT jsonb_agg(jsonb_build_object('fecha_inicio',slot,'fecha_fin',slot+make_interval(mins=>duration)) ORDER BY slot)
  FROM public.horario_medico h CROSS JOIN LATERAL generate_series((p_fecha+h.hora_inicio) AT TIME ZONE 'America/Tijuana',
   ((p_fecha+h.hora_fin) AT TIME ZONE 'America/Tijuana')-make_interval(mins=>duration),interval '15 minutes') slot
  WHERE h.id_veterinaria=tenant AND h.id_medico=p_medico AND h.activo AND h.dia_semana=extract(dow FROM p_fecha)
  AND NOT EXISTS(SELECT 1 FROM public.bloqueo_medico b WHERE b.id_medico=p_medico AND b.id_veterinaria=tenant AND b.fecha_inicio<slot+make_interval(mins=>duration) AND b.fecha_fin>slot)
  AND NOT EXISTS(SELECT 1 FROM public.cita c WHERE c.id_medico=p_medico AND c.id_veterinaria=tenant AND c.id_cita IS DISTINCT FROM p_excluir_cita
   AND c.estado IN ('programada','confirmada','en_espera','en_consulta') AND c.fecha_inicio<slot+make_interval(mins=>duration) AND c.fecha_fin>slot)
 ),'[]'));
END $$;

COMMIT;
