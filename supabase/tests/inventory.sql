-- Standalone Phase 3 suite: run as postgres in ONE dedicated SQL session after Phase 3.
-- Inserts only isolated random-UUID fixtures in new tenants; never updates existing rows.
-- No Auth API calls. Every fixture and successful write is discarded by ROLLBACK.
-- Production historical migration results must be verified separately before/after.
BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '5s';
CREATE FUNCTION pg_temp.assert_true(p_result boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_result IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',p_message; END IF; END; $$;
CREATE FUNCTION pg_temp.expect_error(p_sql text,p_states text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE=ANY(p_states) THEN RETURN; END IF;
        RAISE EXCEPTION 'Expected %, got %: %',p_states,SQLSTATE,SQLERRM;
    END;
    RAISE EXCEPTION 'Expected error %, statement succeeded: %',p_states,p_sql;
END; $$;

-- Helpers and random fixtures above mirror the clinical regression setup.
CREATE FUNCTION pg_temp.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT current_setting('vettrack.clinic.'||p_name)::uuid;
$$;
CREATE FUNCTION pg_temp.jwt(p_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(p_name),'role','authenticated')::text,true);
END; $$;
CREATE FUNCTION pg_temp.booking(p_start text DEFAULT '2030-01-07T09:00:00-08:00',p_medico text DEFAULT 'med_plain')
RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('id_mascota',pg_temp.id('patient'),'id_dueno',pg_temp.id('owner'),
        'id_medico',pg_temp.id(p_medico),'fecha_inicio',p_start,'motivo','Se lastimó una pata.',
        'servicios',jsonb_build_array(pg_temp.id('xray'),pg_temp.id('dressing')),'forzar_horario',false);
$$;
-- Transaction-only fixture seed; the shared Phase 3 suite is appended below.
DO $$ DECLARE key text; user_key text; BEGIN
    FOREACH key IN ARRAY ARRAY['tenant','tenant_b','admin','admin_b','rec','med','med_plain','med_inactive','med_b','inactive',
        'equine','surgery','specialty_b','owner','owner_b','other_owner','patient','patient_b','legacy_service','service_b','legacy_cita'] LOOP
        PERFORM set_config('vettrack.clinic.'||key,gen_random_uuid()::text,true);
    END LOOP;
    INSERT INTO public.veterinaria(id_veterinaria,nombre) VALUES
        (pg_temp.id('tenant'),'Phase 3 transaction fixture A'),(pg_temp.id('tenant_b'),'Phase 3 transaction fixture B');
    FOREACH user_key IN ARRAY ARRAY['admin','admin_b','rec','med','med_plain','med_inactive','med_b','inactive'] LOOP
        -- INSERT only: collisions fail instead of updating an existing Auth user.
        INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at)
        VALUES(pg_temp.id(user_key),'authenticated','authenticated',pg_temp.id(user_key)::text||'@example.invalid',
            '{}'::jsonb,'{}'::jsonb,now());
    END LOOP;
    INSERT INTO public.perfilusuario(id,nombre,rol,activo,id_veterinaria) VALUES
        (pg_temp.id('admin'),'Administrator A','admin',true,pg_temp.id('tenant')),
        (pg_temp.id('admin_b'),'Administrator B','admin',true,pg_temp.id('tenant_b')),
        (pg_temp.id('rec'),'Reception A','recepcionista',true,pg_temp.id('tenant')),
        (pg_temp.id('med'),'Doctor Equine A','medico',true,pg_temp.id('tenant')),
        (pg_temp.id('med_plain'),'Doctor Without Specialty A','medico',true,pg_temp.id('tenant')),
        (pg_temp.id('med_inactive'),'Inactive Doctor A','medico',false,pg_temp.id('tenant')),
        (pg_temp.id('med_b'),'Doctor B','medico',true,pg_temp.id('tenant_b')),
        (pg_temp.id('inactive'),'Inactive Reception A','recepcionista',false,pg_temp.id('tenant'));
    INSERT INTO public.especialidad(id_especialidad,nombre,id_veterinaria) VALUES
        (pg_temp.id('equine'),'Equinos',pg_temp.id('tenant')),
        (pg_temp.id('surgery'),'Cirugía',pg_temp.id('tenant')),
        (pg_temp.id('specialty_b'),'Dermatología B',pg_temp.id('tenant_b'));
    INSERT INTO public.medico_especialidad(id_usuario,id_especialidad,id_veterinaria) VALUES
        (pg_temp.id('med'),pg_temp.id('equine'),pg_temp.id('tenant')),
        (pg_temp.id('med'),pg_temp.id('surgery'),pg_temp.id('tenant'));
    INSERT INTO public.dueno(id_dueno,nombre,id_veterinaria) VALUES
        (pg_temp.id('owner'),'Owner A',pg_temp.id('tenant')),
        (pg_temp.id('owner_b'),'Owner B',pg_temp.id('tenant_b')),
        (pg_temp.id('other_owner'),'Other Owner A',pg_temp.id('tenant'));
    INSERT INTO public.mascota(id_mascota,nombre,id_dueno) VALUES
        (pg_temp.id('patient'),'Tornado',pg_temp.id('owner')),
        (pg_temp.id('patient_b'),'Patient B',pg_temp.id('owner_b'));
    INSERT INTO public.servicio(id_servicio,nombre,descripcion,costo,id_veterinaria) VALUES
        (pg_temp.id('legacy_service'),'Legacy-shaped consultation','Snapshot fixture',450,pg_temp.id('tenant')),
        (pg_temp.id('service_b'),'Foreign service',NULL,900,pg_temp.id('tenant_b'));
    -- This is a post-migration test fixture, not a claim about production history.
    -- Production migration preservation is checked separately using before/after data.
    INSERT INTO public.cita(id_cita,fecha,fecha_inicio,fecha_fin,estado,estado_legacy,id_mascota,id_dueno,id_servicio,id_veterinaria) VALUES
        (pg_temp.id('legacy_cita'),'2025-01-06 10:00:00','2025-01-06T10:00:00-08:00','2025-01-06T10:30:00-08:00',
            'confirmada','Confirmada',pg_temp.id('patient'),pg_temp.id('owner'),pg_temp.id('legacy_service'),pg_temp.id('tenant'));
    INSERT INTO public.cita_servicio(id_cita,id_servicio,id_veterinaria,precio_aplicado,duracion_aplicada) VALUES
        (pg_temp.id('legacy_cita'),pg_temp.id('legacy_service'),pg_temp.id('tenant'),450,30);
    RAISE NOTICE 'Isolated random-UUID fixtures created inside rollback-only transaction';
END; $$;

SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb;p uuid;key uuid;purchase uuid;sale uuid;BEGIN
 data:=public.vettrack_inventario('producto_guardar','{"nombre":"Medicina II","tipo_producto":"medicamento","unidad":"frasco","precio_compra":20,"precio_venta":40,"stock_minimo":5,"grupo_prescripcion":"II","requiere_receta":true}');
 p:=(data->>'id_producto')::uuid;PERFORM set_config('vettrack.clinic.product',p::text,true);
 PERFORM public.vettrack_inventario('producto_guardar','{"nombre":"Insumo","tipo_producto":"insumo","unidad":"pieza","precio_venta":10,"stock_minimo":2}');
 data:=public.vettrack_inventario('producto_guardar','{"nombre":"Alimento","tipo_producto":"venta_libre","unidad":"bolsa","precio_venta":100,"stock_minimo":3}');
 PERFORM set_config('vettrack.clinic.food',data->>'id_producto',true);
 data:=public.vettrack_inventario('producto_guardar','{"nombre":"Grupo I","tipo_producto":"medicamento","unidad":"frasco","precio_venta":100,"stock_minimo":0,"grupo_prescripcion":"I","requiere_receta":true}');
 PERFORM set_config('vettrack.clinic.group_i',data->>'id_producto',true);
 key:=gen_random_uuid();
 data:=jsonb_build_object('id_producto',p,'cantidad',10,'tipo','entrada','idempotencia',key,'motivo','Stock inicial');
 PERFORM public.vettrack_inventario('mover',data);PERFORM public.vettrack_inventario('mover',data);
 PERFORM pg_temp.assert_true((SELECT x->>'stock_actual'='10.000' FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x->>'id_producto'=p::text),'entry idempotent');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''mover'',%L)',(data||'{"cantidad":11}')::text),ARRAY['23514']);
 PERFORM public.vettrack_inventario('mover',data||jsonb_build_object('tipo','salida','cantidad',2,'idempotencia',gen_random_uuid()));
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''mover'',%L)',(data||jsonb_build_object('tipo','salida','cantidad',100,'idempotencia',gen_random_uuid()))::text),ARRAY['23514']);
 PERFORM public.vettrack_inventario('mover',data||jsonb_build_object('tipo','ajuste','cantidad',-1,'idempotencia',gen_random_uuid()));
 PERFORM public.vettrack_inventario('mover',data||jsonb_build_object('id_producto',pg_temp.id('food'),'cantidad',10,'idempotencia',gen_random_uuid()));
 data:=public.vettrack_inventario('proveedor_guardar','{"nombre":"Proveedor prueba","correo":"compras@example.com","rfc":null}');
 PERFORM set_config('vettrack.clinic.supplier',data->>'id_proveedor',true);
 data:=public.vettrack_inventario('compra_crear',jsonb_build_object('id_proveedor',data->>'id_proveedor','referencia','OC1','detalles',jsonb_build_array(jsonb_build_object('id_producto',p,'cantidad',5,'precio_unitario',25))));purchase:=(data->>'id')::uuid;
 PERFORM public.vettrack_inventario('compra_recibir',jsonb_build_object('id',purchase));PERFORM public.vettrack_inventario('compra_recibir',jsonb_build_object('id',purchase));
 PERFORM pg_temp.assert_true((SELECT (x->>'stock_actual')::numeric=12 AND (x->>'precio_compra')::numeric=25 FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x->>'id_producto'=p::text),'purchase receipt exactly once and purchase cost');
 PERFORM set_config('vettrack.clinic.purchase',purchase::text,true);
 data:=public.vettrack_inventario('venta_preparar',jsonb_build_object('detalles',jsonb_build_array(jsonb_build_object('id_producto',pg_temp.id('food'),'cantidad',2))));sale:=(data->>'id')::uuid;
 PERFORM pg_temp.assert_true((SELECT (x->>'stock_actual')::numeric=10 FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x->>'id_producto'=pg_temp.id('food')::text),'preparation does not deduct');
 PERFORM public.vettrack_inventario('venta_entregar',jsonb_build_object('id',sale));PERFORM public.vettrack_inventario('venta_entregar',jsonb_build_object('id',sale));
 PERFORM pg_temp.assert_true((SELECT (x->>'stock_actual')::numeric=8 FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x->>'id_producto'=pg_temp.id('food')::text),'physical sale once');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''venta_preparar'',%L)',jsonb_build_object('detalles',jsonb_build_array(jsonb_build_object('id_producto',p,'cantidad',1)))::text),ARRAY['23514']);
 PERFORM public.vettrack_guardar_horarios(pg_temp.id('med_plain'),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"17:00"}]');
 data:=public.vettrack_guardar_cita(NULL,jsonb_build_object('id_mascota',pg_temp.id('patient'),'id_dueno',pg_temp.id('owner'),'id_medico',pg_temp.id('med_plain'),'fecha_inicio','2030-01-07T09:00:00-08:00','servicios',jsonb_build_array(pg_temp.id('legacy_service'))));
 PERFORM set_config('vettrack.clinic.clinical_appointment',data->>'id_cita',true);
 PERFORM public.vettrack_datos_profesionales_clinica('{"direccion":"Domicilio profesional"}');UPDATE public.mascota SET especie='Perro' WHERE id_mascota=pg_temp.id('patient');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('med_plain');SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb;cid uuid;rx jsonb;item jsonb;use_data jsonb;BEGIN
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.vettrack_inventario('medicamentos')) x WHERE x?'precio_compra' OR x?'precio'),'doctor cannot read purchase cost');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_inventario(''proveedores'')',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_inventario(''compras'')',ARRAY['42501']);
 data:=public.vettrack_iniciar_consulta(pg_temp.id('clinical_appointment'));cid:=(data->'consulta'->>'id_consulta')::uuid;PERFORM set_config('vettrack.clinic.consultation',cid::text,true);
 item:='{"nombre_medicamento":"Receta sin inventario","dosis":"Dosis MVZ","frecuencia":"Según MVZ","duracion":"Indicada","via_administracion":"Indicada","cantidad":1,"grupo_prescripcion":"III","entregar":false}';
 rx:=jsonb_build_object('detalles',jsonb_build_array(item));data:=public.vettrack_guardar_registro_clinico(cid,'receta',rx);
 PERFORM pg_temp.assert_true(data->'receta'->'detalles'->0->>'id_producto' IS NULL,'inventory optional');
 data:=public.vettrack_guardar_registro_clinico(cid,'receta',jsonb_build_object('detalles',jsonb_build_array(item||jsonb_build_object('id_producto',pg_temp.id('group_i'),'grupo_prescripcion','III'))));
 PERFORM pg_temp.assert_true(data->'receta'->'detalles'->0->>'grupo_prescripcion'='I','Group I cannot be downgraded by prescription input');
 rx:=jsonb_build_object('detalles',jsonb_build_array(item||jsonb_build_object('id_producto',pg_temp.id('product'),'grupo_prescripcion','III','entregar',true)));
 data:=public.vettrack_guardar_registro_clinico(cid,'receta',rx);
 PERFORM pg_temp.assert_true(data->'receta'->'detalles'->0->>'grupo_prescripcion'='II','catalog classification overrides forged prescription group');
 PERFORM pg_temp.assert_true((SELECT (x->>'stock_actual')::numeric=12 FROM jsonb_array_elements(public.vettrack_inventario('medicamentos')) x WHERE x->>'id_producto'=pg_temp.id('product')::text),'home prescription does not deduct');
 use_data:=jsonb_build_object('id_producto',pg_temp.id('product'),'id_consulta',cid,'cantidad',2,'idempotencia',gen_random_uuid(),'motivo','Aplicación en clínica');
 PERFORM public.vettrack_inventario('uso_clinico',use_data);PERFORM public.vettrack_inventario('uso_clinico',use_data);
 PERFORM pg_temp.assert_true((SELECT (x->>'stock_actual')::numeric=10 FROM jsonb_array_elements(public.vettrack_inventario('medicamentos')) x WHERE x->>'id_producto'=pg_temp.id('product')::text),'clinical application deducts once');
 PERFORM public.vettrack_cedula_medico(pg_temp.id('med_plain'),'12345678');data:=public.vettrack_finalizar_consulta(cid);
 PERFORM set_config('vettrack.clinic.order',data->'ordenes'->0->>'id_orden',true);
 PERFORM set_config('vettrack.clinic.detail',data->'receta'->'detalles'->0->>'id_detalle',true);
END $$;
RESET ROLE;
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb;BEGIN
 PERFORM pg_temp.expect_error('SELECT public.vettrack_inventario(''proveedores'')',ARRAY['42501']);
 PERFORM pg_temp.expect_error('SELECT public.vettrack_inventario(''compras'')',ARRAY['42501']);
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x?'precio_compra' OR x?'precio'),'reception cannot read purchase cost');
 data:=jsonb_build_object('id_orden',pg_temp.id('order'),'id_detalle',pg_temp.id('detail'));
 PERFORM public.vettrack_inventario('receta_entregar',data);PERFORM public.vettrack_inventario('receta_entregar',data);
 PERFORM pg_temp.assert_true(public.vettrack_inventario('entregas_receta',jsonb_build_object('id_orden',pg_temp.id('order')))->0->>'entregada'='true','delivery status is persistent and administrative only');
 PERFORM pg_temp.assert_true((SELECT (x->>'stock_actual')::numeric=9 FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x->>'id_producto'=pg_temp.id('product')::text),'prescription physical delivery once');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin_b');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(public.vettrack_inventario('productos')='[]'::jsonb,'foreign product invisible');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''compra_recibir'',%L)',jsonb_build_object('id',pg_temp.id('purchase'))::text),ARRAY['P0002']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''mover'',%L)',jsonb_build_object('id_producto',pg_temp.id('product'),'tipo','entrada','cantidad',1,'idempotencia',gen_random_uuid(),'motivo','Foreign')::text),ARRAY['P0002']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''receta_entregar'',%L)',jsonb_build_object('id_orden',pg_temp.id('order'),'id_detalle',pg_temp.id('detail'))::text),ARRAY['42501']);
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_reabrir_consulta(%L,''Después de entrega'')',pg_temp.id('consultation')),ARRAY['23514']);
END $$;
RESET ROLE;
DO $$ DECLARE t text;v text;BEGIN
 FOREACH t IN ARRAY ARRAY['producto','proveedor','compra','compra_detalle','venta_preparada','venta_preparada_detalle','movimiento_inventario'] LOOP
  PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass),'RLS '||t);
  FOREACH v IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'] LOOP
   PERFORM pg_temp.assert_true(NOT has_table_privilege('anon','public.'||t,v) AND NOT has_table_privilege('authenticated','public.'||t,v),'RPC only '||t||' '||v);
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','public.vettrack_inventario(text,jsonb)','EXECUTE'),'anon RPC denied');
 PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','private.inv_move(public.perfilusuario,uuid,text,numeric,uuid,text,text,uuid,uuid)','EXECUTE'),'primitive not exposed');
 RAISE NOTICE 'PASS inventory: catalog, stock, negative, purchases, idempotence, sale, clinical usage, prescription delivery, privacy, tenant and permissions';
END $$;
ROLLBACK;
