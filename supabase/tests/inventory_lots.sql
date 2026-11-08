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

SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb;p uuid;q uuid;k uuid;today date:=(now() AT TIME ZONE 'America/Tijuana')::date;receipt jsonb;order_id uuid;detail_id uuid;BEGIN
 data:=public.vettrack_inventario('producto_guardar','{"nombre":"Producto FEFO","tipo_producto":"venta_libre","unidad":"unidad","precio_venta":20,"stock_minimo":1}');p:=(data->>'id_producto')::uuid;PERFORM set_config('vettrack.clinic.lot_product',p::text,true);
 data:=jsonb_build_object('id_producto',p,'tipo','entrada','cantidad',3,'idempotencia',gen_random_uuid(),'motivo','Stock sin lote anterior');
 PERFORM public.vettrack_inventario('mover',data);
 PERFORM pg_temp.assert_true(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p))='[]'::jsonb,'plain products preserve untracked behavior');
 data:=data||jsonb_build_object('numero_lote','CERCANO','fecha_caducidad',today+10,'cantidad',4,'idempotencia',gen_random_uuid());
 PERFORM public.vettrack_inventario('mover',data);PERFORM public.vettrack_inventario('mover',data);
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p)))=2,'first lot preserves prior unknown balance; repeated entry idempotent');
 PERFORM public.vettrack_inventario('mover',data||jsonb_build_object('numero_lote','CADUCADO','fecha_caducidad',today-1,'cantidad',2,'idempotencia',gen_random_uuid()));
 PERFORM public.vettrack_inventario('mover',data||jsonb_build_object('numero_lote','LEJANO','fecha_caducidad',today+80,'cantidad',5,'idempotencia',gen_random_uuid()));
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p,'estado','caducados')))=1,'expired lots detected');
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p,'estado','proximos','dias',30)))=1,'30 day warning');
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p,'estado','proximos','dias',60)))=1,'60 day warning');
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p,'estado','proximos','dias',90)))=2,'90 day warning');
 PERFORM pg_temp.assert_true((SELECT (x->>'lotes_caducados')::int=1 AND (x->>'lotes_proximos')::int=1 FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x->>'id_producto'=p::text),'product alerts computed from lots');
 k:=gen_random_uuid();
 data:=public.vettrack_inventario('mover',jsonb_build_object('id_producto',p,'tipo','salida','cantidad',5,'idempotencia',k,'motivo','FEFO physical exit'));
 PERFORM set_config('vettrack.clinic.fefo_movement',data->>'id_movimiento',true);
 PERFORM public.vettrack_inventario('mover',jsonb_build_object('id_producto',p,'tipo','salida','cantidad',5,'idempotencia',k,'motivo','FEFO physical exit'));
 PERFORM pg_temp.assert_true((SELECT (x->>'cantidad_actual')::numeric=0 AND x->>'estado'='AGOTADO' FROM jsonb_array_elements(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p))) x WHERE x->>'numero_lote'='CERCANO'),'nearest expiry exhausted first');
 PERFORM pg_temp.assert_true((SELECT (x->>'cantidad_actual')::numeric=4 FROM jsonb_array_elements(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p))) x WHERE x->>'numero_lote'='LEJANO'),'next expiry used before unknown expiry');
 PERFORM pg_temp.assert_true((SELECT (x->>'cantidad_actual')::numeric=2 FROM jsonb_array_elements(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',p))) x WHERE x->>'numero_lote'='CADUCADO'),'expired lot never automatically used');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''mover'',%L)',jsonb_build_object('id_producto',p,'tipo','salida','cantidad',8,'idempotencia',gen_random_uuid(),'motivo','Expired stock cannot cover delivery')::text),ARRAY['23514']);
 PERFORM pg_temp.assert_true((SELECT (x->>'stock_actual')::numeric=9 FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x->>'id_producto'=p::text),'rejected exit rolls back both ledger and lots');
 data:=public.vettrack_inventario('producto_guardar','{"nombre":"Medicina recibida","tipo_producto":"medicamento","unidad":"frasco","precio_venta":50,"stock_minimo":1,"grupo_prescripcion":"II","requiere_receta":true}');q:=(data->>'id_producto')::uuid;PERFORM set_config('vettrack.clinic.receipt_product',q::text,true);
 data:=public.vettrack_inventario('proveedor_guardar','{"nombre":"Proveedor lotes","correo":"lotes@example.com"}');
 data:=public.vettrack_inventario('compra_crear',jsonb_build_object('id_proveedor',data->>'id_proveedor','fecha_solicitud',today,'referencia','Solicitud lotes','detalles',jsonb_build_array(jsonb_build_object('id_producto',q,'cantidad',7,'precio_unitario',20))));order_id:=(data->>'id')::uuid;PERFORM set_config('vettrack.clinic.lot_purchase',order_id::text,true);
 SELECT (x->>'id_detalle')::uuid INTO detail_id FROM jsonb_array_elements((SELECT x->'detalles' FROM jsonb_array_elements(public.vettrack_inventario('compras')) x WHERE x->>'id_compra'=order_id::text)) x;
 receipt:=jsonb_build_object('id',order_id,'fecha_documento',today,'folio_documento','REM-2026-001','documento_url','https://example.com/remision.pdf','observaciones','Dos lotes recibidos',
  'recepciones',jsonb_build_array(jsonb_build_object('id_compra_detalle',detail_id,'cantidad',3,'precio_unitario',21,'numero_lote','AMX001','fecha_caducidad',today+15),jsonb_build_object('id_compra_detalle',detail_id,'cantidad',4,'precio_unitario',22,'numero_lote','AMX002','fecha_caducidad',today+70)));
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''compra_recibir'',%L)',(receipt||jsonb_build_object('recepciones',jsonb_build_array(jsonb_build_object('id_compra_detalle',detail_id,'cantidad',6,'precio_unitario',20))))::text),ARRAY['23514']);
 PERFORM public.vettrack_inventario('compra_recibir',receipt);PERFORM public.vettrack_inventario('compra_recibir',receipt);
 PERFORM pg_temp.assert_true((SELECT sum((x->>'cantidad_actual')::numeric)=7 AND count(*)=2 FROM jsonb_array_elements(public.vettrack_inventario('lotes',jsonb_build_object('id_producto',q))) x),'receipt creates multiple lots once');
 PERFORM pg_temp.assert_true((SELECT (x->>'stock_actual')::numeric=7 FROM jsonb_array_elements(public.vettrack_inventario('productos')) x WHERE x->>'id_producto'=q::text),'receipt increases product stock once');
 data:=public.vettrack_inventario('recepciones','{"dias":7}');
 PERFORM pg_temp.assert_true(jsonb_array_length(data)=1 AND data->0->>'folio_documento'='REM-2026-001' AND data->0->>'documento_url'='https://example.com/remision.pdf' AND jsonb_array_length(data->0->'detalles')=2,'recent receipt includes supplier document and two actual lot lines');
 PERFORM set_config('vettrack.clinic.lot_receipt_detail',detail_id::text,true);
END $$;
RESET ROLE;
DO $$ BEGIN
 PERFORM pg_temp.assert_true((SELECT sum(cantidad_actual) FROM public.lote_inventario WHERE id_producto=pg_temp.id('lot_product'))=(SELECT stock_actual FROM public.producto WHERE id_producto=pg_temp.id('lot_product')),'total stock equals lot balance');
 PERFORM pg_temp.assert_true((SELECT sum(ml.cantidad) FROM public.movimiento_lote ml WHERE id_movimiento=pg_temp.id('fefo_movement'))=-5,'exit allocations match immutable ledger');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.movimiento_lote ml JOIN public.lote_inventario l USING(id_lote,id_producto,id_veterinaria) WHERE ml.id_movimiento=pg_temp.id('fefo_movement') AND l.fecha_caducidad<(now() AT TIME ZONE 'America/Tijuana')::date),'expired lot not allocated');
 -- The old receipt is an isolated fixture, never an existing production row.
 UPDATE public.compra SET recibido_en=now()-interval '8 days' WHERE id_compra=pg_temp.id('lot_purchase');
END $$;
SELECT pg_temp.jwt('admin');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(public.vettrack_inventario('recepciones','{"dias":7}')='[]'::jsonb,'7 days excludes old delivery');
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_inventario('recepciones','{"dias":30}'))=1,'30 days includes old delivery');
END $$;
RESET ROLE;
SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(jsonb_array_length(public.vettrack_inventario('lotes'))=6,'reception can consult own lot stock');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.vettrack_inventario('lotes')) x WHERE x->'procedencia'<>'null'::jsonb),'reception cannot read suppliers or purchase documents through lots');
 PERFORM pg_temp.expect_error('SELECT public.vettrack_inventario(''recepciones'')',ARRAY['42501']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''mover'',%L)',jsonb_build_object('id_producto',pg_temp.id('lot_product'),'tipo','entrada','cantidad',1,'idempotencia',gen_random_uuid(),'motivo','Denied','numero_lote','DENIED')::text),ARRAY['42501']);
END $$;
RESET ROLE;
SELECT pg_temp.jwt('admin_b');SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.assert_true(public.vettrack_inventario('lotes')='[]'::jsonb,'other tenant lots invisible');
 PERFORM pg_temp.assert_true(public.vettrack_inventario('recepciones','{"dias":30}')='[]'::jsonb,'other tenant deliveries and documents invisible');
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''compra_recibir'',%L)',jsonb_build_object('id',pg_temp.id('lot_purchase'))::text),ARRAY['P0002']);
 PERFORM pg_temp.expect_error(format('SELECT public.vettrack_inventario(''mover'',%L)',jsonb_build_object('id_producto',pg_temp.id('lot_product'),'tipo','entrada','cantidad',1,'idempotencia',gen_random_uuid(),'motivo','Foreign','numero_lote','FOREIGN')::text),ARRAY['P0002']);
END $$;
RESET ROLE;
DO $$ DECLARE t text;v text;BEGIN
 FOREACH t IN ARRAY ARRAY['lote_inventario','recepcion_compra_detalle','movimiento_lote'] LOOP
  PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass),'lot RLS '||t);
  FOREACH v IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'] LOOP
   PERFORM pg_temp.assert_true(NOT has_table_privilege('anon','public.'||t,v) AND NOT has_table_privilege('authenticated','public.'||t,v),'lot RPC-only grants '||t);
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','private.inv_api_phase5(text,jsonb)','EXECUTE'),'old dispatcher cannot bypass lot extension');
 PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','private.inv_api(text,jsonb)','EXECUTE'),'anon dispatcher forbidden');
 RAISE NOTICE 'PASS lots: prior balance, multiple lots, expiry windows, FEFO, expired rejection, stock/ledger coherence, receipt splits, document, idempotence, last 7 days, roles and tenant';
END $$;
ROLLBACK;
