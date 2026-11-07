-- Phase 5. Preserve producto/precio legacy; stock changes only through guarded RPCs.
BEGIN;
INSERT INTO public.permiso(clave,modulo,accion,descripcion)
SELECT m||'.'||a,m,a,d FROM (VALUES
 ('inventario','crear','Crear productos'),('inventario','editar','Editar productos'),('inventario','ajustar','Registrar entradas salidas y ajustes'),
 ('inventario','movimientos','Consultar movimientos'),('inventario','uso_clinico','Aplicar productos en consulta'),
 ('proveedores','ver','Ver proveedores'),('proveedores','crear','Crear proveedores'),('proveedores','editar','Editar proveedores'),
 ('compras','ver','Ver compras'),('compras','crear','Crear compras'),('compras','recibir','Recibir compras'),
 ('medicamentos','ver','Consultar medicamentos e insumos'),('venta_libre','ver','Consultar venta libre'),
 ('venta_libre','preparar','Preparar entrega de venta libre'),('inventario','entregar','Confirmar entrega física')
) p(m,a,d) ON CONFLICT DO NOTHING;
INSERT INTO public.rol_permiso SELECT 'admin',clave FROM public.permiso ON CONFLICT DO NOTHING;
INSERT INTO public.rol_permiso VALUES ('medico','medicamentos.ver'),('medico','inventario.uso_clinico'),
 ('recepcionista','medicamentos.ver'),('recepcionista','venta_libre.ver'),('recepcionista','venta_libre.preparar'),('recepcionista','inventario.entregar') ON CONFLICT DO NOTHING;

ALTER TABLE public.producto ADD COLUMN tipo_producto text NOT NULL DEFAULT 'venta_libre' CHECK(tipo_producto IN ('medicamento','insumo','venta_libre')),
 ADD COLUMN sku text,ADD COLUMN unidad text NOT NULL DEFAULT 'unidad',ADD COLUMN precio_compra numeric(14,2) NOT NULL DEFAULT 0 CHECK(precio_compra>=0),
 ADD COLUMN precio_venta numeric(14,2) NOT NULL DEFAULT 0 CHECK(precio_venta>=0),ADD COLUMN stock_actual numeric(14,3) NOT NULL DEFAULT 0 CHECK(stock_actual>=0),
 ADD COLUMN stock_minimo numeric(14,3) NOT NULL DEFAULT 0 CHECK(stock_minimo>=0),ADD COLUMN activo boolean NOT NULL DEFAULT true,
 ADD COLUMN principio_activo text,ADD COLUMN concentracion text,ADD COLUMN presentacion text,
 ADD COLUMN grupo_prescripcion text NOT NULL DEFAULT 'no_clasificado' CHECK(grupo_prescripcion IN ('I','II','III','no_clasificado')),
 ADD COLUMN requiere_receta boolean NOT NULL DEFAULT false,ADD COLUMN tiempo_retiro_default text,
 ADD CONSTRAINT producto_id_tenant_key UNIQUE(id_producto,id_veterinaria);
UPDATE public.producto SET precio_venta=greatest(coalesce(precio,0),0);
ALTER TABLE public.producto ADD CONSTRAINT producto_clasificacion_check CHECK(tipo_producto='medicamento' OR (grupo_prescripcion='no_clasificado' AND NOT requiere_receta));
CREATE UNIQUE INDEX producto_tenant_sku_idx ON public.producto(id_veterinaria,lower(sku)) WHERE sku IS NOT NULL;
CREATE INDEX producto_tenant_tipo_idx ON public.producto(id_veterinaria,tipo_producto,nombre);
ALTER TABLE public.receta_detalle ADD COLUMN id_producto uuid,
 ADD CONSTRAINT receta_detalle_id_tenant_key UNIQUE(id_detalle,id_veterinaria),
 ADD CONSTRAINT receta_detalle_producto_tenant_fk FOREIGN KEY(id_producto,id_veterinaria) REFERENCES public.producto(id_producto,id_veterinaria) ON DELETE RESTRICT;
CREATE INDEX receta_detalle_producto_idx ON public.receta_detalle(id_producto,id_veterinaria);
CREATE TABLE public.proveedor(
 id_proveedor uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,
 nombre text NOT NULL CHECK(length(btrim(nombre)) BETWEEN 1 AND 150),razon_social text,rfc text,telefono text,correo text,direccion text,contacto text,
 activo boolean NOT NULL DEFAULT true,creado_en timestamptz NOT NULL DEFAULT now(),UNIQUE(id_proveedor,id_veterinaria));
CREATE INDEX proveedor_tenant_idx ON public.proveedor(id_veterinaria,nombre);
CREATE TABLE public.compra(
 id_compra uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,id_proveedor uuid NOT NULL,
 referencia text,motivo text,estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','recibida')),
 creado_por uuid NOT NULL,creado_en timestamptz NOT NULL DEFAULT now(),recibido_en timestamptz,
 UNIQUE(id_compra,id_veterinaria),FOREIGN KEY(id_proveedor,id_veterinaria) REFERENCES public.proveedor(id_proveedor,id_veterinaria),
 FOREIGN KEY(creado_por,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria));
CREATE INDEX compra_tenant_idx ON public.compra(id_veterinaria,creado_en DESC);
CREATE INDEX compra_proveedor_idx ON public.compra(id_proveedor,id_veterinaria);
CREATE INDEX compra_usuario_idx ON public.compra(creado_por,id_veterinaria);
CREATE TABLE public.compra_detalle(
 id_detalle uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_compra uuid NOT NULL,id_veterinaria uuid NOT NULL,id_producto uuid NOT NULL,
 cantidad numeric(14,3) NOT NULL CHECK(cantidad>0),precio_unitario numeric(14,2) NOT NULL CHECK(precio_unitario>=0),
 UNIQUE(id_compra,id_producto),FOREIGN KEY(id_compra,id_veterinaria) REFERENCES public.compra(id_compra,id_veterinaria),
 FOREIGN KEY(id_producto,id_veterinaria) REFERENCES public.producto(id_producto,id_veterinaria));
CREATE INDEX compra_detalle_producto_idx ON public.compra_detalle(id_producto,id_veterinaria);
CREATE INDEX compra_detalle_compra_idx ON public.compra_detalle(id_compra,id_veterinaria);
CREATE TABLE public.venta_preparada(
 id_venta uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,
 estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','entregada')),referencia text,
 creado_por uuid NOT NULL,creado_en timestamptz NOT NULL DEFAULT now(),entregado_en timestamptz,
 UNIQUE(id_venta,id_veterinaria),FOREIGN KEY(creado_por,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria));
CREATE INDEX venta_tenant_idx ON public.venta_preparada(id_veterinaria,creado_en DESC);
CREATE INDEX venta_usuario_idx ON public.venta_preparada(creado_por,id_veterinaria);
CREATE TABLE public.venta_preparada_detalle(
 id_detalle uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_venta uuid NOT NULL,id_veterinaria uuid NOT NULL,id_producto uuid NOT NULL,
 nombre text NOT NULL,cantidad numeric(14,3) NOT NULL CHECK(cantidad>0),precio_unitario numeric(14,2) NOT NULL CHECK(precio_unitario>=0),
 UNIQUE(id_venta,id_producto),FOREIGN KEY(id_venta,id_veterinaria) REFERENCES public.venta_preparada(id_venta,id_veterinaria),
 FOREIGN KEY(id_producto,id_veterinaria) REFERENCES public.producto(id_producto,id_veterinaria));
CREATE INDEX venta_detalle_producto_idx ON public.venta_preparada_detalle(id_producto,id_veterinaria);
CREATE INDEX venta_detalle_venta_idx ON public.venta_preparada_detalle(id_venta,id_veterinaria);
CREATE TABLE public.movimiento_inventario(
 id_movimiento uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,id_producto uuid NOT NULL,
 tipo text NOT NULL CHECK(tipo IN ('entrada','salida','ajuste','compra','venta','uso_clinico')),
 cantidad numeric(14,3) NOT NULL CHECK(cantidad<>0),stock_anterior numeric(14,3) NOT NULL CHECK(stock_anterior>=0),
 stock_nuevo numeric(14,3) NOT NULL CHECK(stock_nuevo>=0 AND stock_nuevo=stock_anterior+cantidad),
 id_usuario uuid NOT NULL,referencia text,motivo text NOT NULL CHECK(length(btrim(motivo)) BETWEEN 1 AND 2000),fecha timestamptz NOT NULL DEFAULT now(),
 idempotencia uuid NOT NULL,id_consulta uuid,id_receta_detalle uuid,
 UNIQUE(id_veterinaria,idempotencia),
 FOREIGN KEY(id_producto,id_veterinaria) REFERENCES public.producto(id_producto,id_veterinaria),
 FOREIGN KEY(id_usuario,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria),
 FOREIGN KEY(id_consulta,id_veterinaria) REFERENCES public.consulta(id_consulta,id_veterinaria),
 FOREIGN KEY(id_receta_detalle,id_veterinaria) REFERENCES public.receta_detalle(id_detalle,id_veterinaria));
CREATE INDEX movimiento_producto_fecha_idx ON public.movimiento_inventario(id_producto,id_veterinaria,fecha DESC);
CREATE INDEX movimiento_usuario_idx ON public.movimiento_inventario(id_usuario,id_veterinaria);
CREATE INDEX movimiento_consulta_idx ON public.movimiento_inventario(id_consulta,id_veterinaria);
CREATE UNIQUE INDEX movimiento_entrega_receta_idx ON public.movimiento_inventario(id_receta_detalle,id_veterinaria);

-- Internal primitive: every caller locks actor/clinic first. The row lock also
-- protects against lost updates. A repeated key with different content is rejected.
CREATE FUNCTION private.inv_move(p_actor public.perfilusuario,p_producto uuid,p_tipo text,p_cantidad numeric,p_key uuid,p_motivo text,p_referencia text DEFAULT NULL,p_consulta uuid DEFAULT NULL,p_detalle uuid DEFAULT NULL)
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

CREATE FUNCTION private.inv_api(p_operacion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario;tenant uuid;perm text;rid uuid;product public.producto;provider public.proveedor;
 purchase public.compra;sale public.venta_preparada;item jsonb;row record;result jsonb;consultation public.consulta;detail public.receta_detalle;rx public.receta;ord public.orden_recepcion;amount numeric;BEGIN
 perm:=CASE p_operacion WHEN 'productos' THEN 'inventario.ver' WHEN 'medicamentos' THEN 'medicamentos.ver' WHEN 'venta_catalogo' THEN 'venta_libre.ver'
 WHEN 'producto_guardar' THEN CASE WHEN p_datos?'id' THEN 'inventario.editar' ELSE 'inventario.crear' END
 WHEN 'movimientos' THEN 'inventario.movimientos' WHEN 'mover' THEN 'inventario.ajustar' WHEN 'uso_clinico' THEN 'inventario.uso_clinico'
 WHEN 'proveedores' THEN 'proveedores.ver' WHEN 'proveedor_guardar' THEN CASE WHEN p_datos?'id' THEN 'proveedores.editar' ELSE 'proveedores.crear' END
 WHEN 'compras' THEN 'compras.ver' WHEN 'compra_crear' THEN 'compras.crear' WHEN 'compra_recibir' THEN 'compras.recibir'
 WHEN 'ventas' THEN 'venta_libre.ver' WHEN 'venta_preparar' THEN 'venta_libre.preparar' WHEN 'venta_entregar' THEN 'inventario.entregar'
 WHEN 'entregas_receta' THEN 'orden_recepcion.ver' WHEN 'receta_entregar' THEN 'inventario.entregar' ELSE NULL END;
 IF perm IS NULL THEN RAISE EXCEPTION 'Operación inválida' USING ERRCODE='22023'; END IF;
 actor:=private.lock_actor(perm);tenant:=actor.id_veterinaria;
 IF p_operacion IN ('productos','medicamentos','venta_catalogo') THEN
  PERFORM private.op_body(p_datos,ARRAY[]::text[]);
  SELECT coalesce(jsonb_agg((to_jsonb(p)-'precio_compra'-'precio')||CASE WHEN private.has_permission('compras.ver') THEN jsonb_build_object('precio_compra',p.precio_compra) ELSE '{}'::jsonb END ORDER BY p.nombre,p.id_producto),'[]') INTO result
  FROM public.producto p WHERE p.id_veterinaria=tenant AND (p_operacion='productos' OR (p.activo AND CASE WHEN p_operacion='medicamentos' THEN p.tipo_producto IN ('medicamento','insumo') ELSE p.tipo_producto='venta_libre' OR (p.tipo_producto='medicamento' AND p.grupo_prescripcion='III' AND NOT p.requiere_receta) END));
  RETURN result;
 ELSIF p_operacion='producto_guardar' THEN
  PERFORM private.op_body(p_datos,ARRAY['id','nombre','descripcion','tipo_producto','sku','unidad','precio_compra','precio_venta','stock_minimo','activo','principio_activo','concentracion','presentacion','grupo_prescripcion','requiere_receta','tiempo_retiro_default']);
  IF nullif(btrim(p_datos->>'nombre'),'') IS NULL OR length(p_datos->>'nombre')>100 OR p_datos->>'tipo_producto' NOT IN ('medicamento','insumo','venta_libre') OR nullif(btrim(p_datos->>'unidad'),'') IS NULL THEN RAISE EXCEPTION 'Producto inválido' USING ERRCODE='22023'; END IF;
  IF p_datos?'precio_compra' AND NOT private.has_permission('compras.ver') THEN RAISE EXCEPTION 'Costo de compra restringido' USING ERRCODE='42501'; END IF;
  IF p_datos?'id' THEN SELECT * INTO product FROM public.producto WHERE id_producto=(p_datos->>'id')::uuid AND id_veterinaria=tenant FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado' USING ERRCODE='P0002'; END IF;rid:=product.id_producto;
  ELSE rid:=gen_random_uuid(); END IF;
  INSERT INTO public.producto(id_producto,id_veterinaria,nombre,descripcion,tipo_producto,sku,unidad,precio_compra,precio_venta,stock_minimo,activo,principio_activo,concentracion,presentacion,grupo_prescripcion,requiere_receta,tiempo_retiro_default)
  VALUES(rid,tenant,btrim(p_datos->>'nombre'),p_datos->>'descripcion',p_datos->>'tipo_producto',nullif(btrim(p_datos->>'sku'),''),p_datos->>'unidad',coalesce((p_datos->>'precio_compra')::numeric,product.precio_compra,0),coalesce((p_datos->>'precio_venta')::numeric,0),coalesce((p_datos->>'stock_minimo')::numeric,0),coalesce((p_datos->>'activo')::boolean,true),p_datos->>'principio_activo',p_datos->>'concentracion',p_datos->>'presentacion',coalesce(p_datos->>'grupo_prescripcion','no_clasificado'),coalesce((p_datos->>'requiere_receta')::boolean,false),p_datos->>'tiempo_retiro_default')
  ON CONFLICT(id_producto) DO UPDATE SET nombre=EXCLUDED.nombre,descripcion=EXCLUDED.descripcion,tipo_producto=EXCLUDED.tipo_producto,sku=EXCLUDED.sku,unidad=EXCLUDED.unidad,precio_compra=EXCLUDED.precio_compra,precio_venta=EXCLUDED.precio_venta,stock_minimo=EXCLUDED.stock_minimo,activo=EXCLUDED.activo,principio_activo=EXCLUDED.principio_activo,concentracion=EXCLUDED.concentracion,presentacion=EXCLUDED.presentacion,grupo_prescripcion=EXCLUDED.grupo_prescripcion,requiere_receta=EXCLUDED.requiere_receta,tiempo_retiro_default=EXCLUDED.tiempo_retiro_default;
  RETURN jsonb_build_object('id_producto',rid);
 ELSIF p_operacion='movimientos' THEN
  PERFORM private.op_body(p_datos,ARRAY['id_producto']);
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.fecha DESC),'[]') INTO result FROM (SELECT m.*,p.nombre FROM public.movimiento_inventario m JOIN public.producto p USING(id_producto,id_veterinaria) WHERE m.id_veterinaria=tenant AND (NOT p_datos?'id_producto' OR m.id_producto=(p_datos->>'id_producto')::uuid) ORDER BY m.fecha DESC,m.id_movimiento LIMIT 500) x;RETURN result;
 ELSIF p_operacion IN ('mover','uso_clinico') THEN
  PERFORM private.op_body(p_datos,ARRAY['id_producto','tipo','cantidad','idempotencia','motivo','referencia','id_consulta']);
  IF p_operacion='uso_clinico' THEN
   consultation:=private.cl_open((p_datos->>'id_consulta')::uuid,'inventario.uso_clinico');
   IF (p_datos->>'cantidad')::numeric<=0 THEN RAISE EXCEPTION 'Cantidad positiva requerida' USING ERRCODE='22023'; END IF;
   amount:=-(p_datos->>'cantidad')::numeric;
  ELSE
   IF p_datos?'id_consulta' OR p_datos->>'tipo' NOT IN ('entrada','salida','ajuste') OR p_datos->>'tipo' IS NULL THEN RAISE EXCEPTION 'Tipo de movimiento inválido' USING ERRCODE='22023'; END IF;
   amount:=(p_datos->>'cantidad')::numeric;
   IF p_datos->>'tipo'<>'ajuste' AND amount<=0 THEN RAISE EXCEPTION 'Cantidad positiva requerida' USING ERRCODE='22023'; END IF;
   IF p_datos->>'tipo'='salida' THEN amount:=-amount; END IF;
  END IF;
  RETURN private.inv_move(actor,(p_datos->>'id_producto')::uuid,CASE WHEN p_operacion='uso_clinico' THEN 'uso_clinico' ELSE p_datos->>'tipo' END,amount,(p_datos->>'idempotencia')::uuid,p_datos->>'motivo',p_datos->>'referencia',consultation.id_consulta);
 ELSIF p_operacion='proveedores' THEN
  PERFORM private.op_body(p_datos,ARRAY[]::text[]);SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY nombre),'[]') INTO result FROM public.proveedor p WHERE id_veterinaria=tenant;RETURN result;
 ELSIF p_operacion='proveedor_guardar' THEN
  PERFORM private.op_body(p_datos,ARRAY['id','nombre','razon_social','rfc','telefono','correo','direccion','contacto','activo']);
  IF nullif(btrim(p_datos->>'nombre'),'') IS NULL OR length(p_datos->>'nombre')>150 OR (nullif(p_datos->>'correo','') IS NOT NULL AND p_datos->>'correo'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'Proveedor inválido' USING ERRCODE='22023'; END IF;
  IF p_datos?'id' THEN SELECT * INTO provider FROM public.proveedor WHERE id_proveedor=(p_datos->>'id')::uuid AND id_veterinaria=tenant FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado' USING ERRCODE='P0002'; END IF;rid:=provider.id_proveedor;ELSE rid:=gen_random_uuid();END IF;
  INSERT INTO public.proveedor(id_proveedor,id_veterinaria,nombre,razon_social,rfc,telefono,correo,direccion,contacto,activo) VALUES(rid,tenant,btrim(p_datos->>'nombre'),p_datos->>'razon_social',p_datos->>'rfc',p_datos->>'telefono',p_datos->>'correo',p_datos->>'direccion',p_datos->>'contacto',coalesce((p_datos->>'activo')::boolean,true))
  ON CONFLICT(id_proveedor) DO UPDATE SET nombre=EXCLUDED.nombre,razon_social=EXCLUDED.razon_social,rfc=EXCLUDED.rfc,telefono=EXCLUDED.telefono,correo=EXCLUDED.correo,direccion=EXCLUDED.direccion,contacto=EXCLUDED.contacto,activo=EXCLUDED.activo;RETURN jsonb_build_object('id_proveedor',rid);
 ELSIF p_operacion IN ('compras','ventas') THEN
  PERFORM private.op_body(p_datos,ARRAY[]::text[]);
  IF p_operacion='compras' THEN SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY creado_en DESC),'[]') INTO result FROM (SELECT c.*,p.nombre AS proveedor,(SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('nombre',pr.nombre)) FROM public.compra_detalle d JOIN public.producto pr USING(id_producto,id_veterinaria) WHERE d.id_compra=c.id_compra) AS detalles FROM public.compra c JOIN public.proveedor p USING(id_proveedor,id_veterinaria) WHERE c.id_veterinaria=tenant ORDER BY c.creado_en DESC LIMIT 300) x;
  ELSE SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY creado_en DESC),'[]') INTO result FROM (SELECT v.*,(SELECT jsonb_agg(to_jsonb(d)) FROM public.venta_preparada_detalle d WHERE d.id_venta=v.id_venta) AS detalles FROM public.venta_preparada v WHERE v.id_veterinaria=tenant ORDER BY v.creado_en DESC LIMIT 300) x;END IF;RETURN result;
 ELSIF p_operacion IN ('compra_crear','venta_preparar') THEN
  PERFORM private.op_body(p_datos,ARRAY['id_proveedor','referencia','motivo','detalles']);
  IF jsonb_typeof(p_datos->'detalles') IS DISTINCT FROM 'array' OR jsonb_array_length(p_datos->'detalles') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Se requieren detalles' USING ERRCODE='22023';END IF;
  rid:=gen_random_uuid();
  IF p_operacion='compra_crear' THEN
   IF NOT EXISTS(SELECT 1 FROM public.proveedor WHERE id_proveedor=(p_datos->>'id_proveedor')::uuid AND id_veterinaria=tenant AND activo) THEN RAISE EXCEPTION 'Proveedor no encontrado' USING ERRCODE='P0002';END IF;
   INSERT INTO public.compra(id_compra,id_veterinaria,id_proveedor,referencia,motivo,creado_por) VALUES(rid,tenant,(p_datos->>'id_proveedor')::uuid,p_datos->>'referencia',p_datos->>'motivo',actor.id);
  ELSE INSERT INTO public.venta_preparada(id_venta,id_veterinaria,referencia,creado_por) VALUES(rid,tenant,p_datos->>'referencia',actor.id);END IF;
  FOR item IN SELECT x FROM jsonb_array_elements(p_datos->'detalles') x LOOP
   PERFORM private.op_body(item,CASE WHEN p_operacion='compra_crear' THEN ARRAY['id_producto','cantidad','precio_unitario'] ELSE ARRAY['id_producto','cantidad'] END);
   SELECT * INTO product FROM public.producto WHERE id_producto=(item->>'id_producto')::uuid AND id_veterinaria=tenant AND activo;
   IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado' USING ERRCODE='P0002';END IF;
   IF p_operacion='compra_crear' THEN INSERT INTO public.compra_detalle(id_compra,id_veterinaria,id_producto,cantidad,precio_unitario) VALUES(rid,tenant,product.id_producto,(item->>'cantidad')::numeric,(item->>'precio_unitario')::numeric);
   ELSE
    IF NOT (product.tipo_producto='venta_libre' OR (product.tipo_producto='medicamento' AND product.grupo_prescripcion='III' AND NOT product.requiere_receta)) THEN RAISE EXCEPTION 'Producto requiere entrega clínica autorizada' USING ERRCODE='23514';END IF;
    INSERT INTO public.venta_preparada_detalle(id_venta,id_veterinaria,id_producto,nombre,cantidad,precio_unitario) VALUES(rid,tenant,product.id_producto,product.nombre,(item->>'cantidad')::numeric,product.precio_venta);
   END IF;
  END LOOP;RETURN jsonb_build_object('id',rid,'estado','pendiente');
 ELSIF p_operacion IN ('compra_recibir','venta_entregar') THEN
  PERFORM private.op_body(p_datos,ARRAY['id']);rid:=(p_datos->>'id')::uuid;
  IF p_operacion='compra_recibir' THEN
   SELECT * INTO purchase FROM public.compra WHERE id_compra=rid AND id_veterinaria=tenant FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada' USING ERRCODE='P0002';END IF;
   IF purchase.estado='recibida' THEN RETURN to_jsonb(purchase);END IF;
   FOR row IN SELECT * FROM public.compra_detalle WHERE id_compra=rid ORDER BY id_producto LOOP
    PERFORM private.inv_move(actor,row.id_producto,'compra',row.cantidad,row.id_detalle,'Recepción de compra',rid::text);
    UPDATE public.producto SET precio_compra=row.precio_unitario WHERE id_producto=row.id_producto;
   END LOOP;
   UPDATE public.compra SET estado='recibida',recibido_en=now() WHERE id_compra=rid RETURNING * INTO purchase;RETURN to_jsonb(purchase);
  ELSE
   SELECT * INTO sale FROM public.venta_preparada WHERE id_venta=rid AND id_veterinaria=tenant FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Entrega no encontrada' USING ERRCODE='P0002';END IF;
   IF sale.estado='entregada' THEN RETURN to_jsonb(sale);END IF;
   FOR row IN SELECT * FROM public.venta_preparada_detalle WHERE id_venta=rid ORDER BY id_producto LOOP
    SELECT * INTO product FROM public.producto WHERE id_producto=row.id_producto AND id_veterinaria=tenant;
    IF NOT (product.tipo_producto='venta_libre' OR (product.tipo_producto='medicamento' AND product.grupo_prescripcion='III' AND NOT product.requiere_receta)) THEN RAISE EXCEPTION 'Producto dejó de ser venta libre' USING ERRCODE='23514';END IF;
    PERFORM private.inv_move(actor,row.id_producto,'venta',-row.cantidad,row.id_detalle,'Entrega física de venta libre',rid::text);
   END LOOP;
   UPDATE public.venta_preparada SET estado='entregada',entregado_en=now() WHERE id_venta=rid RETURNING * INTO sale;RETURN to_jsonb(sale);
  END IF;
 ELSIF p_operacion='entregas_receta' THEN
  PERFORM private.op_body(p_datos,ARRAY['id_orden']);
  SELECT * INTO ord FROM public.orden_recepcion WHERE id_orden=(p_datos->>'id_orden')::uuid AND id_veterinaria=tenant;
  IF NOT FOUND OR ord.estado='anulada' THEN RAISE EXCEPTION 'Orden no disponible' USING ERRCODE='P0002';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id_detalle',d.id_detalle,'nombre',d.nombre_medicamento,'cantidad',d.cantidad,'id_producto',d.id_producto,'stock_actual',p.stock_actual,'entregada',m.id_movimiento IS NOT NULL,'grupo_prescripcion',d.grupo_prescripcion) ORDER BY d.id_detalle),'[]') INTO result
  FROM public.receta_detalle d JOIN public.receta r USING(id_receta,id_veterinaria) JOIN public.consulta cc USING(id_consulta,id_veterinaria)
  LEFT JOIN public.producto p ON p.id_producto=d.id_producto AND p.id_veterinaria=tenant
  LEFT JOIN public.movimiento_inventario m ON m.id_receta_detalle=d.id_detalle AND m.id_veterinaria=tenant
  WHERE r.id_consulta=ord.id_consulta AND d.id_veterinaria=tenant AND cc.estado='finalizada' AND cc.revision=ord.revision AND d.entregar;RETURN result;
 ELSIF p_operacion='receta_entregar' THEN
  PERFORM private.op_body(p_datos,ARRAY['id_orden','id_detalle']);
  SELECT * INTO ord FROM public.orden_recepcion WHERE id_orden=(p_datos->>'id_orden')::uuid AND id_veterinaria=tenant FOR UPDATE;
  IF NOT FOUND OR ord.estado='anulada' OR NOT private.has_permission('orden_recepcion.procesar') THEN RAISE EXCEPTION 'Orden no disponible' USING ERRCODE='42501';END IF;
  SELECT d.* INTO detail FROM public.receta_detalle d JOIN public.receta r USING(id_receta,id_veterinaria) JOIN public.consulta c USING(id_consulta,id_veterinaria)
  WHERE d.id_detalle=(p_datos->>'id_detalle')::uuid AND d.id_veterinaria=tenant AND r.id_consulta=ord.id_consulta AND c.estado='finalizada' AND c.revision=ord.revision AND d.entregar;
  IF NOT FOUND OR detail.id_producto IS NULL THEN RAISE EXCEPTION 'Medicamento no vinculado a esta entrega' USING ERRCODE='P0002';END IF;
  SELECT * INTO product FROM public.producto WHERE id_producto=detail.id_producto AND id_veterinaria=tenant;
  IF detail.grupo_prescripcion NOT IN ('II','III') OR product.grupo_prescripcion NOT IN ('II','III') THEN RAISE EXCEPTION 'Requiere control autorizado; no se permite esta entrega' USING ERRCODE='23514';END IF;
  IF (detail.grupo_prescripcion='II' OR product.grupo_prescripcion='II' OR product.requiere_receta) AND NOT EXISTS(SELECT 1 FROM public.documento_clinico WHERE id_consulta=ord.id_consulta AND id_veterinaria=tenant AND revision=ord.revision AND tipo='receta_simple') THEN RAISE EXCEPTION 'La entrega requiere receta simple emitida' USING ERRCODE='23514';END IF;
  RETURN private.inv_move(actor,detail.id_producto,'salida',-detail.cantidad,detail.id_detalle,'Entrega física de receta',ord.id_orden::text,ord.id_consulta,detail.id_detalle);
 END IF;
 RAISE EXCEPTION 'Operación inválida' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.vettrack_inventario(p_operacion text,p_datos jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.inv_api(p_operacion,p_datos); $$;

-- No table API can reveal procurement costs or bypass the immutable ledger.
DO $$ DECLARE t text;cols text;pol record;BEGIN
 FOREACH t IN ARRAY ARRAY['producto','proveedor','compra','compra_detalle','venta_preparada','venta_preparada_detalle','movimiento_inventario'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
  SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC,anon,authenticated',cols,t);
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP EXECUTE format('DROP POLICY %I ON public.%I',pol.policyname,t);END LOOP;
  EXECUTE format('CREATE POLICY inventory_tenant_read ON public.%I FOR SELECT TO authenticated USING(id_veterinaria=(SELECT private.my_veterinaria()) AND (SELECT private.has_permission(%L)))',t,CASE WHEN t='producto' THEN 'inventario.ver' WHEN t='proveedor' THEN 'proveedores.ver' WHEN t LIKE 'compra%' THEN 'compras.ver' WHEN t='movimiento_inventario' THEN 'inventario.movimientos' ELSE 'venta_libre.ver' END);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.inv_move(public.perfilusuario,uuid,text,numeric,uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.inv_api(text,jsonb),public.vettrack_inventario(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.inv_api(text,jsonb),public.vettrack_inventario(text,jsonb) TO authenticated;
-- Preserve the Phase 4 clinical validation; only add optional inventory linkage.
CREATE OR REPLACE FUNCTION private.cl_record(p_consulta uuid,p_tipo text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE product public.producto; c public.consulta; rid uuid; r public.receta; detail jsonb; module text; idkey text; tab text; key text; value text; columns_sql text; values_sql text; update_sql text; allowed text[]; actor_perm text; BEGIN
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
   PERFORM private.op_body(detail,ARRAY['nombre_medicamento','principio_activo','concentracion','presentacion','dosis','frecuencia','duracion','via_administracion','cantidad','indicaciones','grupo_prescripcion','tiempo_retiro','entregar','id_producto']);
   FOREACH key IN ARRAY ARRAY['nombre_medicamento','dosis','frecuencia','duracion','via_administracion'] LOOP
    IF nullif(btrim(detail->>key),'') IS NULL OR length(detail->>key)>2000 THEN RAISE EXCEPTION 'Campo requerido de medicamento: %',key USING ERRCODE='22023'; END IF;
   END LOOP;
   FOR key,value IN SELECT * FROM jsonb_each_text(detail) LOOP IF length(value)>5000 THEN RAISE EXCEPTION 'Dato de receta demasiado largo' USING ERRCODE='22023'; END IF; END LOOP;
   product:=NULL;
   IF nullif(detail->>'id_producto','') IS NOT NULL THEN
    SELECT * INTO product FROM public.producto WHERE id_producto=(detail->>'id_producto')::uuid AND id_veterinaria=c.id_veterinaria AND activo AND tipo_producto='medicamento';
    IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento no encontrado' USING ERRCODE='P0002'; END IF;
    detail:=detail||jsonb_build_object('nombre_medicamento',product.nombre,'principio_activo',product.principio_activo,'concentracion',product.concentracion,'presentacion',product.presentacion,'grupo_prescripcion',product.grupo_prescripcion,'tiempo_retiro',coalesce(detail->>'tiempo_retiro',product.tiempo_retiro_default));
   END IF;
   INSERT INTO public.receta_detalle(id_receta,id_veterinaria,nombre_medicamento,principio_activo,concentracion,presentacion,dosis,frecuencia,duracion,via_administracion,cantidad,indicaciones,grupo_prescripcion,tiempo_retiro,entregar,id_producto)
   VALUES(r.id_receta,c.id_veterinaria,btrim(detail->>'nombre_medicamento'),detail->>'principio_activo',detail->>'concentracion',detail->>'presentacion',detail->>'dosis',detail->>'frecuencia',detail->>'duracion',detail->>'via_administracion',
    (detail->>'cantidad')::numeric,detail->>'indicaciones',coalesce(detail->>'grupo_prescripcion','no_clasificado'),detail->>'tiempo_retiro',coalesce((detail->>'entregar')::boolean,false),product.id_producto);
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

REVOKE ALL ON FUNCTION private.cl_record(uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.cl_record(uuid,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION private.cl_reopen(p_id uuid,p_motivo text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.consulta; BEGIN
 c:=private.cl_authorize(p_id,'consultas.reabrir',true);
 IF c.estado<>'finalizada' OR nullif(btrim(p_motivo),'') IS NULL OR length(p_motivo)>2000 THEN RAISE EXCEPTION 'Reapertura requiere consulta finalizada y motivo' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.orden_recepcion WHERE id_consulta=c.id_consulta AND estado='procesada') THEN
  RAISE EXCEPTION 'La orden ya fue procesada; no se puede reabrir' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.movimiento_inventario WHERE id_consulta=c.id_consulta AND id_receta_detalle IS NOT NULL) THEN
  RAISE EXCEPTION 'La receta tiene entregas físicas; no se puede reabrir' USING ERRCODE='23514'; END IF;
 UPDATE public.orden_recepcion SET estado='anulada' WHERE id_consulta=c.id_consulta AND estado='pendiente';
 UPDATE public.consulta SET estado='en_curso',fecha_fin=NULL,revision=revision+1,actualizado_en=now(),
  auditoria=auditoria||jsonb_build_array(jsonb_build_object('accion','reabrir','usuario',auth.uid(),'fecha',now(),'motivo',p_motivo)) WHERE id_consulta=c.id_consulta;
 UPDATE public.cita SET estado='en_consulta' WHERE id_cita=c.id_cita;
 RETURN private.cl_view(c.id_consulta);
END $$;

REVOKE ALL ON FUNCTION private.cl_reopen(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.cl_reopen(uuid,text) TO authenticated;
COMMIT;
