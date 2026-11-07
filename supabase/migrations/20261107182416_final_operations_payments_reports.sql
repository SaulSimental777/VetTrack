BEGIN;
-- Record received money only; no gateway, partial payments or catalog repricing.
ALTER TABLE public.pago ADD COLUMN id_veterinaria uuid REFERENCES public.veterinaria,
 ADD COLUMN id_orden uuid,ADD COLUMN registrado_por uuid,ADD COLUMN detalle jsonb,
 ADD COLUMN creado_en timestamptz NOT NULL DEFAULT now(),
 ADD CONSTRAINT pago_orden_key UNIQUE(id_orden),
 ADD CONSTRAINT pago_orden_tenant_fk FOREIGN KEY(id_orden,id_veterinaria) REFERENCES public.orden_recepcion(id_orden,id_veterinaria),
 ADD CONSTRAINT pago_usuario_tenant_fk FOREIGN KEY(registrado_por,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.pago p JOIN public.cita c USING(id_cita) JOIN public.dueno d ON d.id_dueno=p.id_dueno WHERE c.id_veterinaria<>d.id_veterinaria) THEN RAISE EXCEPTION 'Pago legacy con referencias Cross-Tenant';END IF;
END $$;
UPDATE public.pago p SET id_veterinaria=coalesce((SELECT id_veterinaria FROM public.cita c WHERE c.id_cita=p.id_cita),(SELECT id_veterinaria FROM public.dueno d WHERE d.id_dueno=p.id_dueno));
-- Legacy orphan rows remain intact and inaccessible. Every new row needs tenant.
ALTER TABLE public.pago ADD CONSTRAINT pago_tenant_requerido CHECK(id_veterinaria IS NOT NULL) NOT VALID,
 ADD CONSTRAINT pago_monto_valido CHECK(monto>=0) NOT VALID,
 ADD CONSTRAINT pago_cita_tenant_fk FOREIGN KEY(id_cita,id_veterinaria) REFERENCES public.cita(id_cita,id_veterinaria),
 ADD CONSTRAINT pago_dueno_tenant_fk FOREIGN KEY(id_dueno,id_veterinaria) REFERENCES public.dueno(id_dueno,id_veterinaria);
CREATE INDEX pago_tenant_fecha_idx ON public.pago(id_veterinaria,fecha_pago DESC);
CREATE INDEX pago_usuario_idx ON public.pago(registrado_por,id_veterinaria);
CREATE INDEX pago_cita_idx ON public.pago(id_cita,id_veterinaria);
CREATE INDEX pago_dueno_idx ON public.pago(id_dueno,id_veterinaria);
CREATE INDEX pago_metodo_idx ON public.pago(id_metodopago);
INSERT INTO public.metododepago(tipo,descripcion) SELECT t,'Registro del pago recibido; sin conexión bancaria' FROM unnest(ARRAY['Efectivo','Transferencia','Tarjeta']) t WHERE NOT EXISTS(SELECT 1 FROM public.metododepago m WHERE lower(m.tipo)=lower(t));
ALTER TABLE public.movimiento_inventario ADD COLUMN precio_unitario_aplicado numeric(14,2) CHECK(precio_unitario_aplicado>=0);
CREATE OR REPLACE FUNCTION private.inv_move(p_actor public.perfilusuario,p_producto uuid,p_tipo text,p_cantidad numeric,p_key uuid,p_motivo text,p_referencia text DEFAULT NULL,p_consulta uuid DEFAULT NULL,p_detalle uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;existed boolean;BEGIN
 SELECT EXISTS(SELECT 1 FROM public.movimiento_inventario WHERE id_veterinaria=p_actor.id_veterinaria AND idempotencia=p_key) INTO existed;
 result:=private.inv_move_lotes(p_actor,p_producto,p_tipo,p_cantidad,p_key,p_motivo,p_referencia,p_consulta,p_detalle,NULL,NULL,NULL);
 IF NOT existed AND p_detalle IS NOT NULL AND p_tipo='salida' THEN
  UPDATE public.movimiento_inventario m SET precio_unitario_aplicado=p.precio_venta FROM public.producto p
   WHERE m.id_movimiento=(result->>'id_movimiento')::uuid AND p.id_producto=p_producto AND p.id_veterinaria=p_actor.id_veterinaria;
 END IF;RETURN result;
END $$;

CREATE FUNCTION private.fin_order(p_id uuid,p_tenant uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orden_recepcion;c public.consulta;services jsonb;products jsonb;total numeric;pending integer;BEGIN
 SELECT * INTO o FROM public.orden_recepcion WHERE id_orden=p_id AND id_veterinaria=p_tenant AND estado<>'anulada';
 IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada' USING ERRCODE='P0002';END IF;
 SELECT * INTO c FROM public.consulta WHERE id_consulta=o.id_consulta AND id_veterinaria=p_tenant AND estado='finalizada' AND revision=o.revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'La consulta no está finalizada' USING ERRCODE='23514';END IF;
 services:=coalesce(o.contenido->'servicios','[]');
 SELECT coalesce(jsonb_agg(jsonb_build_object('id_detalle',d.id_detalle,'nombre',d.nombre_medicamento,'cantidad',d.cantidad,'entregado',m.id_movimiento IS NOT NULL,'precio_unitario',m.precio_unitario_aplicado,'subtotal',round(-m.cantidad*m.precio_unitario_aplicado,2)) ORDER BY d.id_detalle),'[]'),
  count(*) FILTER(WHERE m.id_movimiento IS NULL) INTO products,pending FROM public.receta_detalle d JOIN public.receta r USING(id_receta,id_veterinaria)
  LEFT JOIN public.movimiento_inventario m ON m.id_receta_detalle=d.id_detalle AND m.id_veterinaria=p_tenant AND m.referencia=o.id_orden::text
  WHERE r.id_consulta=c.id_consulta AND d.id_veterinaria=p_tenant AND d.entregar AND d.id_producto IS NOT NULL;
 IF EXISTS(SELECT 1 FROM public.movimiento_inventario WHERE id_consulta=c.id_consulta AND id_veterinaria=p_tenant AND id_receta_detalle IS NOT NULL AND referencia=o.id_orden::text AND precio_unitario_aplicado IS NULL) THEN
  RAISE EXCEPTION 'Entrega histórica sin precio guardado; requiere revisión' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum((s->>'precio_aplicado')::numeric),0) INTO total FROM jsonb_array_elements(services) s WHERE coalesce(s->>'estado','realizado') NOT IN ('cancelado','cancelada');
 SELECT total+coalesce(sum((p->>'subtotal')::numeric),0) INTO total FROM jsonb_array_elements(products) p;
 total:=round(total,2);
 RETURN jsonb_build_object('id_orden',o.id_orden,'id_cita',c.id_cita,'id_consulta',c.id_consulta,'estado',o.estado,'propietario',o.contenido->'propietario','paciente',o.contenido->'paciente','medico',o.contenido->'medico','fecha',o.creado_en,'servicios',services,'productos',products,'total',total,'entregas_pendientes',pending,
  'pago',(SELECT jsonb_build_object('id_pago',p.id_pago,'monto',p.monto,'fecha_pago',p.fecha_pago AT TIME ZONE 'America/Tijuana','metodo',m.tipo) FROM public.pago p LEFT JOIN public.metododepago m USING(id_metodopago) WHERE p.id_orden=o.id_orden AND p.id_veterinaria=p_tenant));
END $$;

CREATE FUNCTION private.fin_report(p_datos jsonb,p_actor public.perfilusuario) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text:=p_datos->>'tipo';required text;start_date date:=coalesce((p_datos->>'desde')::date,(now() AT TIME ZONE 'America/Tijuana')::date-30);
 end_date date:=coalesce((p_datos->>'hasta')::date,(now() AT TIME ZONE 'America/Tijuana')::date);start_at timestamptz;end_at timestamptz;data jsonb;patient uuid;BEGIN
 PERFORM private.op_body(p_datos,ARRAY['tipo','desde','hasta','id_mascota']);
 IF start_date>end_date OR end_date-start_date>366 THEN RAISE EXCEPTION 'Periodo inválido; máximo 366 días' USING ERRCODE='22023';END IF;
 start_at:=start_date::timestamp AT TIME ZONE 'America/Tijuana';end_at:=(end_date+1)::timestamp AT TIME ZONE 'America/Tijuana';
 required:=CASE kind WHEN 'agenda' THEN 'citas.ver' WHEN 'pacientes' THEN 'pacientes.ver' WHEN 'historial' THEN 'expediente.ver' WHEN 'vacunas' THEN 'vacunas.ver'
 WHEN 'desparasitaciones' THEN 'desparasitacion.ver' WHEN 'tratamientos' THEN 'tratamientos.ver' WHEN 'servicios' THEN 'servicios.ver' WHEN 'uso_inventario' THEN 'inventario.movimientos' WHEN 'stock_bajo' THEN 'inventario.ver' WHEN 'caducidades' THEN 'inventario.ver' END;
 IF required IS NULL THEN RAISE EXCEPTION 'Reporte inválido' USING ERRCODE='22023';END IF;
 IF NOT private.has_permission(required) OR (kind IN ('historial','vacunas','desparasitaciones','tratamientos') AND p_actor.rol NOT IN ('admin','medico')) THEN RAISE EXCEPTION 'Permiso del módulo requerido' USING ERRCODE='42501';END IF;
 IF kind='historial' THEN
  patient:=(p_datos->>'id_mascota')::uuid;
  IF patient IS NULL THEN RAISE EXCEPTION 'Selecciona paciente' USING ERRCODE='22023';END IF;
  -- Preserve the existing patient/clinical authorization before reading any event.
  PERFORM private.cl_record_history(patient,1,0);
  -- Filter the full permitted timeline BEFORE limiting the report, including legacy events.
  SELECT coalesce(jsonb_agg(jsonb_build_object('fecha',e.fecha,'tipo',e.tipo,'descripcion',e.descripcion,'consulta',e.id_consulta) ORDER BY e.fecha DESC,e.id DESC),'[]') INTO data FROM (
   SELECT * FROM (
   SELECT c.id_consulta id,'consulta'::text tipo,c.fecha_inicio fecha,c.id_consulta,c.motivo_consulta descripcion,to_jsonb(c)-'contexto' datos FROM public.consulta c
    WHERE c.id_mascota=patient AND c.id_veterinaria=private.my_veterinaria() AND private.has_permission('consultas.ver')
   UNION ALL SELECT d.id_diagnostico,'diagnostico',d.fecha AT TIME ZONE 'America/Tijuana',d.id_consulta,d.descripcion,to_jsonb(d) FROM public.diagnostico d
    WHERE d.id_mascota=patient AND d.id_veterinaria=private.my_veterinaria() AND private.has_permission('diagnosticos.ver')
   UNION ALL SELECT t.id_tratamiento,'tratamiento',t.creado_en,t.id_consulta,t.descripcion,to_jsonb(t) FROM public.tratamiento t JOIN public.consulta c USING(id_consulta)
    WHERE c.id_mascota=patient AND t.id_veterinaria=private.my_veterinaria() AND private.has_permission('tratamientos.ver')
   UNION ALL SELECT r.id_receta,'receta',r.creado_en,r.id_consulta,coalesce(r.indicaciones,'Receta'),to_jsonb(r)||jsonb_build_object('detalles',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.receta_detalle d WHERE d.id_receta=r.id_receta),'[]'))
    FROM public.receta r LEFT JOIN public.consulta c ON c.id_consulta=r.id_consulta LEFT JOIN public.diagnostico d ON d.id_diagnostico=r.id_diagnostico
    WHERE coalesce(c.id_mascota,d.id_mascota)=patient AND r.id_veterinaria=private.my_veterinaria() AND private.has_permission('recetas.ver')
   UNION ALL SELECT v.id_vacuna,'vacuna',v.fecha_aplicacion::timestamp AT TIME ZONE 'America/Tijuana',v.id_consulta,v.nombre,to_jsonb(v) FROM public.vacunacion v
    WHERE v.id_mascota=patient AND v.id_veterinaria=private.my_veterinaria() AND private.has_permission('vacunas.ver')
   UNION ALL SELECT d.id_desparasitacion,'desparasitacion',d.fecha::timestamp AT TIME ZONE 'America/Tijuana',d.id_consulta,d.producto,to_jsonb(d) FROM public.desparasitacion d
    WHERE d.id_mascota=patient AND d.id_veterinaria=private.my_veterinaria() AND private.has_permission('desparasitacion.ver')
   UNION ALL SELECT s.id_estudio,'estudio',s.fecha::timestamp AT TIME ZONE 'America/Tijuana',s.id_consulta,s.nombre,to_jsonb(s) FROM public.estudio_clinico s
    WHERE s.id_mascota=patient AND s.id_veterinaria=private.my_veterinaria() AND private.has_permission('estudios.ver')
   UNION ALL SELECT cs.id_servicio,'servicio',cs.creado_en,c.id_consulta,s.nombre,to_jsonb(cs)||jsonb_build_object('nombre',s.nombre) FROM public.cita_servicio cs
    JOIN public.cita a USING(id_cita) JOIN public.consulta c ON c.id_cita=a.id_cita JOIN public.servicio s ON s.id_servicio=cs.id_servicio
    WHERE a.id_mascota=patient AND cs.id_veterinaria=private.my_veterinaria() AND private.has_permission('consultas.ver')
   UNION ALL SELECT h.id_historial,'historial_legacy',h.fecha_registro AT TIME ZONE 'America/Tijuana',NULL,h.observaciones,to_jsonb(h)
    FROM public.historialmedico h WHERE h.id_mascota=patient AND private.has_permission('consultas.ver')

   ) all_entries WHERE fecha>=start_at AND fecha<end_at ORDER BY fecha DESC,id DESC LIMIT 1000
  ) e;
 ELSIF kind='agenda' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fecha),'[]') INTO data FROM (SELECT c.fecha_inicio AS fecha,m.nombre AS paciente,d.nombre AS propietario,p.nombre AS medico,c.estado FROM public.cita c JOIN public.mascota m USING(id_mascota) JOIN public.dueno d ON d.id_dueno=c.id_dueno JOIN public.perfilusuario p ON p.id=c.id_medico WHERE c.id_veterinaria=p_actor.id_veterinaria AND c.fecha_inicio>=start_at AND c.fecha_inicio<end_at AND (p_actor.rol<>'medico' OR c.id_medico=p_actor.id) ORDER BY c.fecha_inicio LIMIT 1000) x;
 ELSIF kind='pacientes' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY nombre),'[]') INTO data FROM (SELECT m.nombre,m.especie,m.raza,m.sexo,m.fecha_nacimiento,m.peso_actual FROM public.mascota m JOIN public.dueno d USING(id_dueno) WHERE d.id_veterinaria=p_actor.id_veterinaria ORDER BY m.nombre LIMIT 1000) x;
 ELSIF kind='vacunas' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fecha DESC),'[]') INTO data FROM (SELECT v.fecha_aplicacion AS fecha,m.nombre AS paciente,v.nombre,v.lote,v.proxima_aplicacion FROM public.vacunacion v JOIN public.mascota m USING(id_mascota) WHERE v.id_veterinaria=p_actor.id_veterinaria AND v.fecha_aplicacion BETWEEN start_date AND end_date ORDER BY v.fecha_aplicacion DESC LIMIT 1000) x;
 ELSIF kind='desparasitaciones' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fecha DESC),'[]') INTO data FROM (SELECT v.fecha,m.nombre AS paciente,v.producto,v.dosis,v.proxima_fecha FROM public.desparasitacion v JOIN public.mascota m USING(id_mascota) WHERE v.id_veterinaria=p_actor.id_veterinaria AND v.fecha BETWEEN start_date AND end_date ORDER BY v.fecha DESC LIMIT 1000) x;
 ELSIF kind='tratamientos' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fecha DESC),'[]') INTO data FROM (SELECT t.creado_en AS fecha,m.nombre AS paciente,t.descripcion,t.indicaciones,t.duracion,t.observaciones FROM public.tratamiento t JOIN public.consulta c USING(id_consulta,id_veterinaria) JOIN public.mascota m USING(id_mascota) WHERE t.id_veterinaria=p_actor.id_veterinaria AND t.creado_en>=start_at AND t.creado_en<end_at ORDER BY t.creado_en DESC LIMIT 1000) x;
 ELSIF kind='servicios' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fecha DESC),'[]') INTO data FROM (SELECT c.fecha_inicio AS fecha,m.nombre AS paciente,s.nombre AS servicio,cs.precio_aplicado,cs.duracion_aplicada FROM public.cita_servicio cs JOIN public.cita c USING(id_cita,id_veterinaria) JOIN public.servicio s ON s.id_servicio=cs.id_servicio AND s.id_veterinaria=cs.id_veterinaria JOIN public.mascota m USING(id_mascota) WHERE cs.id_veterinaria=p_actor.id_veterinaria AND cs.estado='realizado' AND c.fecha_inicio>=start_at AND c.fecha_inicio<end_at ORDER BY c.fecha_inicio DESC LIMIT 1000) x;
 ELSIF kind='uso_inventario' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fecha DESC),'[]') INTO data FROM (SELECT mi.fecha,p.nombre AS producto,-mi.cantidad AS cantidad,mi.motivo,mi.id_consulta FROM public.movimiento_inventario mi JOIN public.producto p USING(id_producto,id_veterinaria) WHERE mi.id_veterinaria=p_actor.id_veterinaria AND mi.tipo='uso_clinico' AND mi.fecha>=start_at AND mi.fecha<end_at ORDER BY mi.fecha DESC LIMIT 1000) x;
 ELSIF kind='stock_bajo' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY nombre),'[]') INTO data FROM (SELECT nombre,tipo_producto,stock_actual,stock_minimo,unidad FROM public.producto WHERE id_veterinaria=p_actor.id_veterinaria AND activo AND stock_actual<=stock_minimo ORDER BY nombre LIMIT 1000) x;
 ELSE
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY caducidad),'[]') INTO data FROM (SELECT p.nombre AS producto,l.numero_lote,l.fecha_caducidad AS caducidad,l.cantidad_actual FROM public.lote_inventario l JOIN public.producto p USING(id_producto,id_veterinaria) WHERE l.id_veterinaria=p_actor.id_veterinaria AND l.activo AND l.cantidad_actual>0 AND l.fecha_caducidad BETWEEN start_date AND end_date ORDER BY l.fecha_caducidad LIMIT 1000) x;
 END IF;
 RETURN jsonb_build_object('tipo',kind,'desde',start_date,'hasta',end_date,'filas',data,'limite',1000);
END $$;

CREATE FUNCTION private.fin_api(p_operacion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario;tenant uuid;perm text;result jsonb;metrics jsonb:='[]';ord public.orden_recepcion;consultation public.consulta;payment public.pago;v public.veterinaria;
 today date:=(now() AT TIME ZONE 'America/Tijuana')::date;start_at timestamptz;END_AT timestamptz;BEGIN
 perm:=CASE p_operacion WHEN 'horarios_medicos' THEN 'horarios.ver' WHEN 'dashboard' THEN 'dashboard.ver' WHEN 'reporte' THEN 'reportes.ver' WHEN 'configuracion' THEN 'configuracion.ver' WHEN 'configuracion_guardar' THEN 'configuracion.editar' WHEN 'pagos' THEN 'pagos.ver' WHEN 'orden_pago' THEN 'pagos.ver' WHEN 'metodos_pago' THEN 'pagos.ver' WHEN 'pago_registrar' THEN 'pagos.crear' END;
 IF perm IS NULL THEN RAISE EXCEPTION 'Operación inválida' USING ERRCODE='22023';END IF;
 actor:=private.lock_actor(perm);tenant:=actor.id_veterinaria;
 IF p_operacion='horarios_medicos' THEN
  PERFORM private.op_body(p_datos,ARRAY[]::text[]);RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'activo',p.activo) ORDER BY p.nombre) FROM public.perfilusuario p WHERE p.id_veterinaria=tenant AND p.rol='medico' AND NOT private.is_superadmin(p.id)),'[]');
 ELSIF p_operacion='reporte' THEN RETURN private.fin_report(p_datos,actor);
 ELSIF p_operacion='configuracion' THEN
  PERFORM private.op_body(p_datos,ARRAY[]::text[]);SELECT * INTO v FROM public.veterinaria WHERE id_veterinaria=tenant;
  RETURN jsonb_build_object('nombre',v.nombre,'direccion',v.direccion,'telefono',v.telefono,'correo',v.correo,'horario',v.horario,'descripcion',v.descripcion,'foto_veterinaria',v.foto_veterinaria,'valoracion',v.valoracion);
 ELSIF p_operacion='configuracion_guardar' THEN
  PERFORM private.op_body(p_datos,ARRAY['nombre','direccion','telefono','correo','horario','descripcion','foto_veterinaria']);
  IF nullif(btrim(p_datos->>'nombre'),'') IS NULL OR length(p_datos->>'nombre')>150 OR length(p_datos->>'telefono')>20 OR length(p_datos->>'correo')>100 OR length(p_datos->>'horario')>100 OR length(p_datos->>'descripcion')>5000 OR length(p_datos->>'direccion')>2000
   OR (nullif(p_datos->>'correo','') IS NOT NULL AND p_datos->>'correo'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') OR (nullif(p_datos->>'foto_veterinaria','') IS NOT NULL AND (p_datos->>'foto_veterinaria'!~'^https://[^[:space:]]+$' OR length(p_datos->>'foto_veterinaria')>2000)) THEN RAISE EXCEPTION 'Configuración inválida' USING ERRCODE='22023';END IF;
  UPDATE public.veterinaria SET nombre=btrim(p_datos->>'nombre'),direccion=nullif(btrim(p_datos->>'direccion'),''),telefono=nullif(btrim(p_datos->>'telefono'),''),correo=nullif(btrim(p_datos->>'correo'),''),horario=nullif(btrim(p_datos->>'horario'),''),descripcion=nullif(btrim(p_datos->>'descripcion'),''),foto_veterinaria=nullif(btrim(p_datos->>'foto_veterinaria'),'') WHERE id_veterinaria=tenant;
  RETURN jsonb_build_object('guardado',true);
 ELSIF p_operacion='metodos_pago' THEN
  PERFORM private.op_body(p_datos,ARRAY[]::text[]);RETURN coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY tipo) FROM public.metododepago m),'[]');
 ELSIF p_operacion='orden_pago' THEN
  PERFORM private.op_body(p_datos,ARRAY['id_orden']);RETURN private.fin_order((p_datos->>'id_orden')::uuid,tenant);
 ELSIF p_operacion='pagos' THEN
  PERFORM private.op_body(p_datos,ARRAY[]::text[]);
  RETURN jsonb_build_object('pagos',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY fecha_pago DESC) FROM (SELECT p.id_pago,p.id_orden,p.monto,p.fecha_pago AT TIME ZONE 'America/Tijuana' AS fecha_pago,m.tipo AS metodo,p.detalle->'paciente' AS paciente,p.detalle->'propietario' AS propietario FROM public.pago p LEFT JOIN public.metododepago m USING(id_metodopago) WHERE p.id_veterinaria=tenant ORDER BY fecha_pago DESC LIMIT 500) x),'[]'),
   'pendientes',coalesce((SELECT jsonb_agg(jsonb_build_object('id_orden',o.id_orden,'fecha',o.creado_en,'paciente',o.contenido->'paciente','propietario',o.contenido->'propietario') ORDER BY o.creado_en) FROM public.orden_recepcion o WHERE o.id_veterinaria=tenant AND o.estado<>'anulada' AND NOT EXISTS(SELECT 1 FROM public.pago p WHERE p.id_orden=o.id_orden AND p.id_veterinaria=tenant)),'[]'));
 ELSIF p_operacion='pago_registrar' THEN
  PERFORM private.op_body(p_datos,ARRAY['id_orden','id_metodopago','fecha_pago']);
  IF NOT private.has_permission('orden_recepcion.procesar') THEN RAISE EXCEPTION 'Permiso de procesamiento requerido' USING ERRCODE='42501';END IF;
  SELECT * INTO ord FROM public.orden_recepcion WHERE id_orden=(p_datos->>'id_orden')::uuid AND id_veterinaria=tenant FOR UPDATE;
  IF NOT FOUND OR ord.estado='anulada' THEN RAISE EXCEPTION 'Orden no encontrada' USING ERRCODE='P0002';END IF;
  SELECT * INTO payment FROM public.pago WHERE id_orden=ord.id_orden AND id_veterinaria=tenant;
  IF FOUND THEN RETURN jsonb_build_object('id_pago',payment.id_pago,'monto',payment.monto,'ya_registrado',true);END IF;
  IF NOT EXISTS(SELECT 1 FROM public.metododepago WHERE id_metodopago=(p_datos->>'id_metodopago')::uuid) THEN RAISE EXCEPTION 'Método no encontrado' USING ERRCODE='P0002';END IF;
  IF coalesce((p_datos->>'fecha_pago')::timestamptz,now())>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Fecha de pago futura' USING ERRCODE='22023';END IF;
  result:=private.fin_order(ord.id_orden,tenant);
  IF (result->>'entregas_pendientes')::int>0 THEN RAISE EXCEPTION 'Confirma las entregas antes de registrar el pago' USING ERRCODE='23514';END IF;
  SELECT * INTO consultation FROM public.consulta WHERE id_consulta=ord.id_consulta AND id_veterinaria=tenant;
  INSERT INTO public.pago(monto,fecha_pago,id_cita,id_metodopago,id_dueno,id_veterinaria,id_orden,registrado_por,detalle)
   VALUES((result->>'total')::numeric,coalesce((p_datos->>'fecha_pago')::timestamptz,now()) AT TIME ZONE 'America/Tijuana',consultation.id_cita,(p_datos->>'id_metodopago')::uuid,consultation.id_dueno,tenant,ord.id_orden,actor.id,result-'pago') RETURNING * INTO payment;
  UPDATE public.orden_recepcion SET estado='procesada',procesado_por=actor.id,procesado_en=coalesce(procesado_en,now()) WHERE id_orden=ord.id_orden;
  RETURN jsonb_build_object('id_pago',payment.id_pago,'monto',payment.monto,'ya_registrado',false);
 ELSIF p_operacion='dashboard' THEN
  PERFORM private.op_body(p_datos,ARRAY[]::text[]);start_at:=today::timestamp AT TIME ZONE 'America/Tijuana';end_at:=(today+1)::timestamp AT TIME ZONE 'America/Tijuana';
  IF private.has_permission('citas.ver') THEN
   metrics:=metrics||jsonb_build_array(jsonb_build_object('titulo','Citas del día','valor',(SELECT count(*) FROM public.cita WHERE id_veterinaria=tenant AND fecha_inicio>=start_at AND fecha_inicio<end_at AND (actor.rol<>'medico' OR id_medico=actor.id)),'ruta','/citas'),
    jsonb_build_object('titulo','Citas pendientes','valor',(SELECT count(*) FROM public.cita WHERE id_veterinaria=tenant AND fecha_inicio>=start_at AND estado IN ('programada','confirmada','en_espera') AND (actor.rol<>'medico' OR id_medico=actor.id)),'ruta','/citas'));
  END IF;
  IF private.has_permission('consultas.ver') AND actor.rol IN ('admin','medico') THEN metrics:=metrics||jsonb_build_array(jsonb_build_object('titulo','Consultas en curso','valor',(SELECT count(*) FROM public.consulta WHERE id_veterinaria=tenant AND estado='en_curso' AND (actor.rol<>'medico' OR id_medico=actor.id)),'ruta','/clinica'));END IF;
  IF private.has_permission('pacientes.ver') THEN metrics:=metrics||jsonb_build_array(jsonb_build_object('titulo','Pacientes registrados','valor',(SELECT count(*) FROM public.mascota m JOIN public.dueno d USING(id_dueno) WHERE d.id_veterinaria=tenant),'ruta','/pacientes'));END IF;
  IF private.has_permission('orden_recepcion.ver') THEN metrics:=metrics||jsonb_build_array(jsonb_build_object('titulo','Órdenes pendientes','valor',(SELECT count(*) FROM public.orden_recepcion WHERE id_veterinaria=tenant AND estado='pendiente'),'ruta','/ordenes-recepcion'));END IF;
  IF private.has_permission('pagos.ver') THEN metrics:=metrics||jsonb_build_array(jsonb_build_object('titulo','Pagos pendientes','valor',(SELECT count(*) FROM public.orden_recepcion o WHERE id_veterinaria=tenant AND estado<>'anulada' AND NOT EXISTS(SELECT 1 FROM public.pago p WHERE p.id_orden=o.id_orden AND p.id_veterinaria=tenant)),'ruta','/pagos'));END IF;
  IF private.has_permission('inventario.ver') THEN metrics:=metrics||jsonb_build_array(jsonb_build_object('titulo','Stock bajo','valor',(SELECT count(*) FROM public.producto WHERE id_veterinaria=tenant AND activo AND stock_actual<=stock_minimo),'ruta','/inventario'),jsonb_build_object('titulo','Lotes próximos a caducar','valor',(SELECT count(*) FROM public.lote_inventario WHERE id_veterinaria=tenant AND activo AND cantidad_actual>0 AND fecha_caducidad BETWEEN today AND today+30),'ruta','/inventario'));END IF;
  IF private.has_permission('compras.ver') THEN metrics:=metrics||jsonb_build_array(jsonb_build_object('titulo','Recepciones de los últimos 7 días','valor',(SELECT count(*) FROM public.compra WHERE id_veterinaria=tenant AND estado='recibida' AND recibido_en>=now()-interval '7 days'),'ruta','/compras'));END IF;
  RETURN jsonb_build_object('fecha',today,'metricas',metrics,'citas',CASE WHEN private.has_permission('citas.ver') THEN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY fecha_inicio) FROM (SELECT c.id_cita,c.fecha_inicio,c.estado,m.nombre AS paciente,p.nombre AS medico FROM public.cita c JOIN public.mascota m USING(id_mascota) LEFT JOIN public.perfilusuario p ON p.id=c.id_medico WHERE c.id_veterinaria=tenant AND c.fecha_inicio>=start_at AND c.estado NOT IN ('cancelada','completada','no_asistio') AND (actor.rol<>'medico' OR c.id_medico=actor.id) ORDER BY c.fecha_inicio LIMIT 10) x),'[]') ELSE '[]'::jsonb END);
 END IF;
 RAISE EXCEPTION 'Operación inválida' USING ERRCODE='22023';
END $$;
CREATE FUNCTION public.vettrack_operacion_final(p_operacion text,p_datos jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.fin_api(p_operacion,p_datos); $$;
ALTER TABLE public.pago ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record;cols text;BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='pago' LOOP EXECUTE format('DROP POLICY %I ON public.pago',p.policyname);END LOOP;
 SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid='public.pago'::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE format('REVOKE ALL (%s) ON public.pago FROM PUBLIC,anon,authenticated',cols);
END $$;
CREATE POLICY payment_tenant_read ON public.pago FOR SELECT TO authenticated USING(id_veterinaria=(SELECT private.my_veterinaria()) AND (SELECT private.has_permission('pagos.ver')));
REVOKE ALL ON TABLE public.pago FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.fin_order(uuid,uuid),private.fin_report(jsonb,public.perfilusuario),private.fin_api(text,jsonb),public.vettrack_operacion_final(text,jsonb),private.inv_move(public.perfilusuario,uuid,text,numeric,uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.fin_api(text,jsonb),public.vettrack_operacion_final(text,jsonb) TO authenticated;
CREATE FUNCTION private.fin_license(p_id uuid,p_cedula text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario;BEGIN
 actor:=private.lock_actor('usuarios.editar');
 IF actor.rol<>'admin' THEN RAISE EXCEPTION 'Administrador requerido' USING ERRCODE='42501';END IF;
 IF p_cedula IS NOT NULL AND p_cedula!~'^[0-9]{5,20}$' THEN RAISE EXCEPTION 'Cédula inválida' USING ERRCODE='22023';END IF;
 UPDATE public.perfilusuario SET cedula_profesional=p_cedula WHERE id=p_id AND id_veterinaria=actor.id_veterinaria AND rol='medico' AND NOT private.is_superadmin(id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Médico no encontrado' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('id',p_id,'cedula_profesional',p_cedula);
END $$;
CREATE FUNCTION public.vettrack_usuario_cedula(p_id uuid,p_cedula text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.fin_license(p_id,p_cedula); $$;
REVOKE ALL ON FUNCTION private.fin_license(uuid,text),public.vettrack_usuario_cedula(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.fin_license(uuid,text),public.vettrack_usuario_cedula(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION private.op_medicos(p_q text,p_especialidad uuid,p_activo boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid:=private.op_tenant('medicos.ver'); BEGIN
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'cedula_profesional',p.cedula_profesional,'activo',p.activo,
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

COMMIT;
