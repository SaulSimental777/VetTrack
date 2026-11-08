-- Incremental extension: preserve all Phase 5 rows and the original stock ledger.
BEGIN;
ALTER TABLE public.compra ADD COLUMN fecha_solicitud date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Tijuana')::date),
 ADD COLUMN fecha_documento date,ADD COLUMN folio_documento text,ADD COLUMN documento_url text,
 ADD COLUMN observaciones text,
 ADD CONSTRAINT compra_documento_url_check CHECK(documento_url IS NULL OR (length(documento_url)<=2000 AND documento_url ~ '^https://[^[:space:]]+$'));
-- Historical request dates come from the original creation timestamp, not today.
UPDATE public.compra SET fecha_solicitud=(creado_en AT TIME ZONE 'America/Tijuana')::date;
ALTER TABLE public.compra_detalle ADD CONSTRAINT compra_detalle_id_producto_tenant_key UNIQUE(id_detalle,id_producto,id_veterinaria);
ALTER TABLE public.movimiento_inventario ADD CONSTRAINT movimiento_id_producto_tenant_key UNIQUE(id_movimiento,id_producto,id_veterinaria);
CREATE TABLE public.recepcion_compra_detalle(
 id_recepcion_detalle uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,
 id_compra_detalle uuid NOT NULL,id_producto uuid NOT NULL,cantidad numeric(14,3) NOT NULL CHECK(cantidad>0),
 precio_unitario numeric(14,2) NOT NULL CHECK(precio_unitario>=0),numero_lote text CHECK(numero_lote IS NULL OR length(btrim(numero_lote)) BETWEEN 1 AND 100),
 fecha_caducidad date,creado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id_recepcion_detalle,id_producto,id_veterinaria),
 FOREIGN KEY(id_compra_detalle,id_producto,id_veterinaria) REFERENCES public.compra_detalle(id_detalle,id_producto,id_veterinaria),
 CHECK(fecha_caducidad IS NULL OR numero_lote IS NOT NULL));
CREATE INDEX recepcion_detalle_compra_idx ON public.recepcion_compra_detalle(id_compra_detalle,id_producto,id_veterinaria);
CREATE INDEX recepcion_detalle_tenant_idx ON public.recepcion_compra_detalle(id_veterinaria);
CREATE TABLE public.lote_inventario(
 id_lote uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,id_producto uuid NOT NULL,
 id_compra_detalle uuid,id_recepcion_detalle uuid,numero_lote text CHECK(numero_lote IS NULL OR length(btrim(numero_lote)) BETWEEN 1 AND 100),fecha_caducidad date,
 cantidad_inicial numeric(14,3) NOT NULL CHECK(cantidad_inicial>0),cantidad_actual numeric(14,3) NOT NULL CHECK(cantidad_actual>=0 AND cantidad_actual<=cantidad_inicial),
 fecha_recepcion timestamptz NOT NULL DEFAULT now(),activo boolean NOT NULL DEFAULT true,creado_en timestamptz NOT NULL DEFAULT now(),
 origen text NOT NULL CHECK(origen IN ('entrada','compra','saldo_previo','sin_lote')),
 UNIQUE(id_lote,id_producto,id_veterinaria),
 FOREIGN KEY(id_producto,id_veterinaria) REFERENCES public.producto(id_producto,id_veterinaria),
 FOREIGN KEY(id_compra_detalle,id_producto,id_veterinaria) REFERENCES public.compra_detalle(id_detalle,id_producto,id_veterinaria),
 FOREIGN KEY(id_recepcion_detalle,id_producto,id_veterinaria) REFERENCES public.recepcion_compra_detalle(id_recepcion_detalle,id_producto,id_veterinaria),
 CHECK(fecha_caducidad IS NULL OR numero_lote IS NOT NULL));
CREATE INDEX lote_producto_fefo_idx ON public.lote_inventario(id_producto,id_veterinaria,fecha_caducidad,fecha_recepcion,id_lote);
CREATE INDEX lote_tenant_caducidad_idx ON public.lote_inventario(id_veterinaria,fecha_caducidad);
CREATE INDEX lote_compra_detalle_idx ON public.lote_inventario(id_compra_detalle,id_producto,id_veterinaria);
CREATE INDEX lote_recepcion_detalle_idx ON public.lote_inventario(id_recepcion_detalle,id_producto,id_veterinaria);
CREATE TABLE public.movimiento_lote(
 id_movimiento uuid NOT NULL,id_lote uuid NOT NULL,id_producto uuid NOT NULL,id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,
 cantidad numeric(14,3) NOT NULL CHECK(cantidad<>0),PRIMARY KEY(id_movimiento,id_lote),
 FOREIGN KEY(id_movimiento,id_producto,id_veterinaria) REFERENCES public.movimiento_inventario(id_movimiento,id_producto,id_veterinaria),
 FOREIGN KEY(id_lote,id_producto,id_veterinaria) REFERENCES public.lote_inventario(id_lote,id_producto,id_veterinaria));
CREATE INDEX movimiento_lote_movimiento_idx ON public.movimiento_lote(id_movimiento,id_producto,id_veterinaria);
CREATE INDEX movimiento_lote_lote_idx ON public.movimiento_lote(id_lote,id_producto,id_veterinaria);
CREATE INDEX movimiento_lote_tenant_idx ON public.movimiento_lote(id_veterinaria);
CREATE INDEX compra_recibida_fecha_idx ON public.compra(id_veterinaria,recibido_en DESC);

-- Keep the original primitive OID so cached callers also gain FEFO.
CREATE FUNCTION private.inv_move_base(p_actor public.perfilusuario,p_producto uuid,p_tipo text,p_cantidad numeric,p_key uuid,p_motivo text,p_referencia text DEFAULT NULL,p_consulta uuid DEFAULT NULL,p_detalle uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE product public.producto;m public.movimiento_inventario;BEGIN
 IF p_key IS NULL OR p_cantidad IS NULL OR p_cantidad=0 OR abs(p_cantidad)>999999999 OR p_cantidad<>round(p_cantidad,3) OR nullif(btrim(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Movimiento inválido' USING ERRCODE='22023'; END IF;
 SELECT * INTO m FROM public.movimiento_inventario WHERE id_veterinaria=p_actor.id_veterinaria AND idempotencia=p_key;
 IF FOUND THEN
  IF m.id_producto<>p_producto OR m.tipo<>p_tipo OR m.cantidad<>p_cantidad OR m.id_consulta IS DISTINCT FROM p_consulta OR m.id_receta_detalle IS DISTINCT FROM p_detalle THEN RAISE EXCEPTION 'Clave reutilizada para otra operación' USING ERRCODE='23514'; END IF;
  RETURN to_jsonb(m);
 END IF;
 SELECT * INTO product FROM public.producto WHERE id_producto=p_producto AND id_veterinaria=p_actor.id_veterinaria AND activo FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado' USING ERRCODE='P0002'; END IF;
 IF product.stock_actual+p_cantidad<0 THEN RAISE EXCEPTION 'Existencias insuficientes' USING ERRCODE='23514'; END IF;
 INSERT INTO public.movimiento_inventario(id_veterinaria,id_producto,tipo,cantidad,stock_anterior,stock_nuevo,id_usuario,referencia,motivo,idempotencia,id_consulta,id_receta_detalle)
 VALUES(p_actor.id_veterinaria,p_producto,p_tipo,p_cantidad,product.stock_actual,product.stock_actual+p_cantidad,p_actor.id,p_referencia,p_motivo,p_key,p_consulta,p_detalle) RETURNING * INTO m;
 UPDATE public.producto SET stock_actual=m.stock_nuevo WHERE id_producto=p_producto;
 RETURN to_jsonb(m);
END $$;


ALTER FUNCTION private.inv_api(text,jsonb) RENAME TO inv_api_phase5;

CREATE FUNCTION private.inv_move_lotes(p_actor public.perfilusuario,p_producto uuid,p_tipo text,p_cantidad numeric,p_key uuid,p_motivo text,p_referencia text,p_consulta uuid,p_detalle uuid,p_numero text,p_caducidad date,p_recepcion uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE data jsonb;m public.movimiento_inventario;l public.lote_inventario;receipt public.recepcion_compra_detalle;
 existing boolean;tracked boolean;remaining numeric;take numeric;today date:=(now() AT TIME ZONE 'America/Tijuana')::date;BEGIN
 SELECT EXISTS(SELECT 1 FROM public.movimiento_inventario WHERE id_veterinaria=p_actor.id_veterinaria AND idempotencia=p_key) INTO existing;
 IF (p_numero IS NOT NULL AND length(btrim(p_numero)) NOT BETWEEN 1 AND 100) OR (p_caducidad IS NOT NULL AND p_numero IS NULL)
 OR ((p_numero IS NOT NULL OR p_caducidad IS NOT NULL OR p_recepcion IS NOT NULL) AND p_cantidad<=0) THEN RAISE EXCEPTION 'Datos de lote inválidos' USING ERRCODE='22023';END IF;
 data:=private.inv_move_base(p_actor,p_producto,p_tipo,p_cantidad,p_key,p_motivo,p_referencia,p_consulta,p_detalle);
 SELECT * INTO STRICT m FROM public.movimiento_inventario WHERE id_movimiento=(data->>'id_movimiento')::uuid;
 IF existing THEN
  IF p_numero IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.movimiento_lote ml JOIN public.lote_inventario li USING(id_lote,id_producto,id_veterinaria)
   WHERE ml.id_movimiento=m.id_movimiento AND li.numero_lote=p_numero AND li.fecha_caducidad IS NOT DISTINCT FROM p_caducidad) THEN RAISE EXCEPTION 'Clave reutilizada para otro lote' USING ERRCODE='23514';END IF;
  RETURN data;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.lote_inventario WHERE id_producto=p_producto AND id_veterinaria=p_actor.id_veterinaria) INTO tracked;
 IF p_recepcion IS NOT NULL THEN
  SELECT * INTO receipt FROM public.recepcion_compra_detalle WHERE id_recepcion_detalle=p_recepcion AND id_producto=p_producto AND id_veterinaria=p_actor.id_veterinaria;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recepción no encontrada' USING ERRCODE='P0002';END IF;
 END IF;
 IF m.cantidad>0 AND (tracked OR p_numero IS NOT NULL OR p_recepcion IS NOT NULL) THEN
  -- First tracked receipt includes the exact preceding untracked balance. Never
  -- invent a manufacturer's lot number or expiry date, or rewrite old movements.
  IF NOT tracked AND m.stock_anterior>0 THEN
   INSERT INTO public.lote_inventario(id_veterinaria,id_producto,cantidad_inicial,cantidad_actual,origen)
    VALUES(p_actor.id_veterinaria,p_producto,m.stock_anterior,m.stock_anterior,'saldo_previo');
  END IF;
  INSERT INTO public.lote_inventario(id_veterinaria,id_producto,id_compra_detalle,id_recepcion_detalle,numero_lote,fecha_caducidad,cantidad_inicial,cantidad_actual,origen)
   VALUES(p_actor.id_veterinaria,p_producto,receipt.id_compra_detalle,p_recepcion,p_numero,p_caducidad,m.cantidad,m.cantidad,
    CASE WHEN p_recepcion IS NOT NULL THEN 'compra' WHEN p_numero IS NOT NULL THEN 'entrada' ELSE 'sin_lote' END) RETURNING * INTO l;
  INSERT INTO public.movimiento_lote VALUES(m.id_movimiento,l.id_lote,p_producto,p_actor.id_veterinaria,m.cantidad);
  tracked:=true;
 ELSIF m.cantidad<0 AND tracked THEN
  remaining:=-m.cantidad;
  FOR l IN SELECT * FROM public.lote_inventario WHERE id_producto=p_producto AND id_veterinaria=p_actor.id_veterinaria AND activo AND cantidad_actual>0
   AND (fecha_caducidad IS NULL OR fecha_caducidad>=today) ORDER BY fecha_caducidad NULLS LAST,fecha_recepcion,id_lote FOR UPDATE LOOP
   take:=least(remaining,l.cantidad_actual);
   UPDATE public.lote_inventario SET cantidad_actual=cantidad_actual-take WHERE id_lote=l.id_lote;
   INSERT INTO public.movimiento_lote VALUES(m.id_movimiento,l.id_lote,p_producto,p_actor.id_veterinaria,-take);
   remaining:=remaining-take;EXIT WHEN remaining=0;
  END LOOP;
  IF remaining>0 THEN RAISE EXCEPTION 'Existencias vigentes insuficientes; hay lotes caducados o inactivos' USING ERRCODE='23514';END IF;
 END IF;
 IF tracked AND (SELECT coalesce(sum(cantidad_actual),0) FROM public.lote_inventario WHERE id_producto=p_producto AND id_veterinaria=p_actor.id_veterinaria)<>m.stock_nuevo THEN
  RAISE EXCEPTION 'El saldo de lotes no coincide con el inventario' USING ERRCODE='23514';END IF;
 RETURN data;
END $$;
-- Existing sales, prescription deliveries and clinical applications keep their
-- existing authorization/idempotency and now allocate lots through this wrapper.
CREATE OR REPLACE FUNCTION private.inv_move(p_actor public.perfilusuario,p_producto uuid,p_tipo text,p_cantidad numeric,p_key uuid,p_motivo text,p_referencia text DEFAULT NULL,p_consulta uuid DEFAULT NULL,p_detalle uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.inv_move_lotes(p_actor,p_producto,p_tipo,p_cantidad,p_key,p_motivo,p_referencia,p_consulta,p_detalle,NULL,NULL,NULL);
$$;

CREATE FUNCTION private.inv_api(p_operacion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario;tenant uuid;result jsonb;item jsonb;part jsonb;purchase public.compra;ordered public.compra_detalle;
 receipt public.recepcion_compra_detalle;input jsonb;today date:=(now() AT TIME ZONE 'America/Tijuana')::date;days integer;state text;rid uuid;BEGIN
 IF p_operacion IN ('lotes','recepciones') THEN
  actor:=private.lock_actor(CASE WHEN p_operacion='lotes' THEN 'inventario.ver' ELSE 'compras.ver' END);tenant:=actor.id_veterinaria;
  IF p_operacion='lotes' THEN
   PERFORM private.op_body(p_datos,ARRAY['id_producto','estado','dias']);days:=coalesce((p_datos->>'dias')::integer,30);state:=coalesce(p_datos->>'estado','todos');
   IF days NOT IN (30,60,90) OR state NOT IN ('todos','activos','caducados','proximos') THEN RAISE EXCEPTION 'Filtro de caducidad inválido' USING ERRCODE='22023';END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY fecha_caducidad NULLS LAST,fecha_recepcion,id_lote),'[]') INTO result FROM (
    SELECT l.id_lote,l.id_producto,l.numero_lote,l.fecha_caducidad,l.cantidad_inicial,l.cantidad_actual,l.fecha_recepcion,l.activo,l.origen,p.nombre AS producto,
     CASE WHEN l.cantidad_actual=0 THEN 'AGOTADO' WHEN NOT l.activo THEN 'INACTIVO' WHEN l.fecha_caducidad<today THEN 'CADUCADO' WHEN l.fecha_caducidad<=today+days THEN 'PRÓXIMO A CADUCAR' ELSE 'VIGENTE' END AS estado,
     CASE WHEN private.has_permission('compras.ver') THEN jsonb_build_object('id_compra_detalle',l.id_compra_detalle,'id_compra',c.id_compra,'proveedor',pr.nombre,'folio_documento',c.folio_documento) ELSE NULL END AS procedencia
    FROM public.lote_inventario l JOIN public.producto p USING(id_producto,id_veterinaria)
    LEFT JOIN public.compra_detalle cd ON cd.id_detalle=l.id_compra_detalle AND cd.id_veterinaria=tenant
    LEFT JOIN public.compra c ON c.id_compra=cd.id_compra AND c.id_veterinaria=tenant
    LEFT JOIN public.proveedor pr ON pr.id_proveedor=c.id_proveedor AND pr.id_veterinaria=tenant
    WHERE l.id_veterinaria=tenant AND (NOT p_datos?'id_producto' OR l.id_producto=(p_datos->>'id_producto')::uuid)
     AND (state='todos' OR (l.activo AND l.cantidad_actual>0 AND CASE state WHEN 'activos' THEN true WHEN 'caducados' THEN l.fecha_caducidad<today ELSE l.fecha_caducidad BETWEEN today AND today+days END))
   ) x;RETURN result;
  ELSE
   PERFORM private.op_body(p_datos,ARRAY['dias']);days:=coalesce((p_datos->>'dias')::integer,7);
   IF days NOT IN (7,30,90) THEN RAISE EXCEPTION 'Filtro de recepción inválido' USING ERRCODE='22023';END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY recibido_en DESC,id_compra),'[]') INTO result FROM (
    SELECT c.id_compra,c.recibido_en,c.referencia,c.fecha_solicitud,c.fecha_documento,c.folio_documento,c.documento_url,c.observaciones,pr.nombre AS proveedor,
     coalesce((SELECT jsonb_agg(jsonb_build_object('id_recepcion_detalle',r.id_recepcion_detalle,'id_producto',r.id_producto,'nombre',p.nombre,'cantidad',r.cantidad,'precio_unitario',r.precio_unitario,'numero_lote',r.numero_lote,'fecha_caducidad',r.fecha_caducidad) ORDER BY r.creado_en,r.id_recepcion_detalle)
      FROM public.recepcion_compra_detalle r JOIN public.compra_detalle d ON d.id_detalle=r.id_compra_detalle AND d.id_veterinaria=tenant JOIN public.producto p ON p.id_producto=r.id_producto AND p.id_veterinaria=tenant WHERE d.id_compra=c.id_compra AND r.id_veterinaria=tenant),
     (SELECT jsonb_agg(jsonb_build_object('id_producto',d.id_producto,'nombre',p.nombre,'cantidad',d.cantidad,'precio_unitario',d.precio_unitario,'numero_lote',NULL,'fecha_caducidad',NULL)) FROM public.compra_detalle d JOIN public.producto p USING(id_producto,id_veterinaria) WHERE d.id_compra=c.id_compra AND d.id_veterinaria=tenant),'[]') AS detalles
    FROM public.compra c JOIN public.proveedor pr USING(id_proveedor,id_veterinaria) WHERE c.id_veterinaria=tenant AND c.estado='recibida' AND c.recibido_en>=now()-make_interval(days=>days)
   ) x;RETURN result;
  END IF;
 ELSIF p_operacion='compra_crear' THEN
  actor:=private.lock_actor('compras.crear');
  PERFORM private.op_body(p_datos,ARRAY['id_proveedor','referencia','motivo','detalles','fecha_solicitud','fecha_documento','folio_documento','documento_url','observaciones']);
  IF length(p_datos->>'folio_documento')>2000 OR length(p_datos->>'observaciones')>2000 THEN RAISE EXCEPTION 'Documento inválido' USING ERRCODE='22023';END IF;
  result:=private.inv_api_phase5(p_operacion,p_datos-ARRAY['fecha_solicitud','fecha_documento','folio_documento','documento_url','observaciones']);
  UPDATE public.compra SET fecha_solicitud=coalesce((p_datos->>'fecha_solicitud')::date,today),fecha_documento=(p_datos->>'fecha_documento')::date,
   folio_documento=nullif(btrim(p_datos->>'folio_documento'),''),documento_url=nullif(btrim(p_datos->>'documento_url'),''),observaciones=p_datos->>'observaciones'
   WHERE id_compra=(result->>'id')::uuid AND id_veterinaria=actor.id_veterinaria;RETURN result;
 ELSIF p_operacion='compra_recibir' THEN
  actor:=private.lock_actor('compras.recibir');tenant:=actor.id_veterinaria;
  PERFORM private.op_body(p_datos,ARRAY['id','recepciones','fecha_documento','folio_documento','documento_url','observaciones']);
  SELECT * INTO purchase FROM public.compra WHERE id_compra=(p_datos->>'id')::uuid AND id_veterinaria=tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada' USING ERRCODE='P0002';END IF;
  IF purchase.estado='recibida' THEN RETURN to_jsonb(purchase);END IF;
  input:=p_datos->'recepciones';
  IF input IS NULL THEN SELECT jsonb_agg(jsonb_build_object('id_compra_detalle',d.id_detalle,'cantidad',d.cantidad,'precio_unitario',d.precio_unitario)) INTO input FROM public.compra_detalle d WHERE id_compra=purchase.id_compra AND id_veterinaria=tenant;END IF;
  IF jsonb_typeof(input) IS DISTINCT FROM 'array' OR jsonb_array_length(input) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Recepción inválida' USING ERRCODE='22023';END IF;
  FOR part IN SELECT x FROM jsonb_array_elements(input) x LOOP
   PERFORM private.op_body(part,ARRAY['id_compra_detalle','cantidad','precio_unitario','numero_lote','fecha_caducidad']);
   IF (part->>'cantidad')::numeric IS NULL OR (part->>'cantidad')::numeric<=0 OR (part->>'cantidad')::numeric>999999999 OR (part->>'cantidad')::numeric<>round((part->>'cantidad')::numeric,3)
    OR (part->>'precio_unitario')::numeric IS NULL OR (part->>'precio_unitario')::numeric<0 OR (part->>'precio_unitario')::numeric>999999999 OR (part->>'precio_unitario')::numeric<>round((part->>'precio_unitario')::numeric,2) THEN RAISE EXCEPTION 'Cantidad o precio inválido' USING ERRCODE='22023';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.compra_detalle d WHERE d.id_detalle=(part->>'id_compra_detalle')::uuid AND d.id_compra=purchase.id_compra AND d.id_veterinaria=tenant) THEN RAISE EXCEPTION 'Detalle no encontrado' USING ERRCODE='P0002';END IF;
  END LOOP;
  FOR ordered IN SELECT * FROM public.compra_detalle WHERE id_compra=purchase.id_compra AND id_veterinaria=tenant ORDER BY id_producto LOOP
   IF (SELECT coalesce(sum((x->>'cantidad')::numeric),0) FROM jsonb_array_elements(input) x WHERE (x->>'id_compra_detalle')::uuid=ordered.id_detalle)<>ordered.cantidad THEN RAISE EXCEPTION 'La recepción debe cubrir la cantidad solicitada' USING ERRCODE='23514';END IF;
   FOR part IN SELECT x FROM jsonb_array_elements(input) x WHERE (x->>'id_compra_detalle')::uuid=ordered.id_detalle LOOP
    INSERT INTO public.recepcion_compra_detalle(id_veterinaria,id_compra_detalle,id_producto,cantidad,precio_unitario,numero_lote,fecha_caducidad)
     VALUES(tenant,ordered.id_detalle,ordered.id_producto,(part->>'cantidad')::numeric,(part->>'precio_unitario')::numeric,nullif(btrim(part->>'numero_lote'),''),(part->>'fecha_caducidad')::date) RETURNING * INTO receipt;
    PERFORM private.inv_move_lotes(actor,ordered.id_producto,'compra',receipt.cantidad,receipt.id_recepcion_detalle,'Recepción de compra',purchase.id_compra::text,NULL,NULL,receipt.numero_lote,receipt.fecha_caducidad,receipt.id_recepcion_detalle);
    UPDATE public.producto SET precio_compra=receipt.precio_unitario WHERE id_producto=ordered.id_producto AND id_veterinaria=tenant;
   END LOOP;
  END LOOP;
  IF length(p_datos->>'folio_documento')>2000 OR length(p_datos->>'observaciones')>2000 THEN RAISE EXCEPTION 'Documento inválido' USING ERRCODE='22023';END IF;
  UPDATE public.compra SET estado='recibida',recibido_en=now(),
   fecha_documento=CASE WHEN p_datos?'fecha_documento' THEN (p_datos->>'fecha_documento')::date ELSE fecha_documento END,
   folio_documento=CASE WHEN p_datos?'folio_documento' THEN nullif(btrim(p_datos->>'folio_documento'),'') ELSE folio_documento END,
   documento_url=CASE WHEN p_datos?'documento_url' THEN nullif(btrim(p_datos->>'documento_url'),'') ELSE documento_url END,
   observaciones=CASE WHEN p_datos?'observaciones' THEN p_datos->>'observaciones' ELSE observaciones END
   WHERE id_compra=purchase.id_compra RETURNING * INTO purchase;RETURN to_jsonb(purchase);
 ELSIF p_operacion='mover' AND (p_datos?'numero_lote' OR p_datos?'fecha_caducidad') THEN
  actor:=private.lock_actor('inventario.ajustar');
  PERFORM private.op_body(p_datos,ARRAY['id_producto','tipo','cantidad','idempotencia','motivo','referencia','numero_lote','fecha_caducidad']);
  IF p_datos->>'tipo' IS DISTINCT FROM 'entrada' THEN RAISE EXCEPTION 'Un lote nuevo requiere entrada positiva' USING ERRCODE='22023';END IF;
  RETURN private.inv_move_lotes(actor,(p_datos->>'id_producto')::uuid,'entrada',(p_datos->>'cantidad')::numeric,(p_datos->>'idempotencia')::uuid,p_datos->>'motivo',p_datos->>'referencia',NULL,NULL,nullif(btrim(p_datos->>'numero_lote'),''),(p_datos->>'fecha_caducidad')::date,NULL);
 ELSE
  result:=private.inv_api_phase5(p_operacion,p_datos);
  IF p_operacion IN ('productos','medicamentos','venta_catalogo') THEN
   SELECT coalesce(jsonb_agg(x||jsonb_build_object('lotes_caducados',(SELECT count(*) FROM public.lote_inventario l WHERE l.id_producto=(x->>'id_producto')::uuid AND l.id_veterinaria=private.my_veterinaria() AND l.activo AND l.cantidad_actual>0 AND l.fecha_caducidad<today),
    'lotes_proximos',(SELECT count(*) FROM public.lote_inventario l WHERE l.id_producto=(x->>'id_producto')::uuid AND l.id_veterinaria=private.my_veterinaria() AND l.activo AND l.cantidad_actual>0 AND l.fecha_caducidad BETWEEN today AND today+30)) ORDER BY x->>'nombre',x->>'id_producto'),'[]') INTO result FROM jsonb_array_elements(result) x;
  END IF;RETURN result;
 END IF;
END $$;
-- Rebind the public wrapper explicitly after renaming its old helper.
CREATE OR REPLACE FUNCTION public.vettrack_inventario(p_operacion text,p_datos jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.inv_api(p_operacion,p_datos); $$;
DO $$ DECLARE t text;cols text;BEGIN
 FOREACH t IN ARRAY ARRAY['lote_inventario','recepcion_compra_detalle','movimiento_lote'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
  SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC,anon,authenticated',cols,t);
  EXECUTE format('CREATE POLICY inventory_lot_tenant_read ON public.%I FOR SELECT TO authenticated USING(id_veterinaria=(SELECT private.my_veterinaria()) AND (SELECT private.has_permission(%L)))',t,CASE WHEN t='recepcion_compra_detalle' THEN 'compras.ver' WHEN t='movimiento_lote' THEN 'inventario.movimientos' ELSE 'inventario.ver' END);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.inv_move_base(public.perfilusuario,uuid,text,numeric,uuid,text,text,uuid,uuid),private.inv_move(public.perfilusuario,uuid,text,numeric,uuid,text,text,uuid,uuid),
 private.inv_move_lotes(public.perfilusuario,uuid,text,numeric,uuid,text,text,uuid,uuid,text,date,uuid),private.inv_api_phase5(text,jsonb),private.inv_api(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.inv_api(text,jsonb) TO authenticated;
COMMIT;
