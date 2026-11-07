-- Controlled real-clinic reproduction. All catalog and appointment writes roll back.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
DO $$ DECLARE fixture record; BEGIN
 SELECT p.id doctor,p.id_veterinaria tenant,a.id actor,s.id_servicio service,m.id_mascota patient,m.id_dueno owner INTO fixture
 FROM public.perfilusuario p JOIN public.perfilusuario a ON a.id_veterinaria=p.id_veterinaria AND a.rol='admin' AND a.activo
 JOIN public.servicio s ON s.id_veterinaria=p.id_veterinaria AND s.activo
 JOIN public.dueno d ON d.id_veterinaria=p.id_veterinaria JOIN public.mascota m USING(id_dueno)
 WHERE p.rol='medico' AND p.activo AND NOT private.is_superadmin(p.id) AND NOT private.is_superadmin(a.id)
 AND EXISTS(SELECT 1 FROM public.horario_medico h WHERE h.id_medico=p.id AND h.activo)
 ORDER BY s.duracion_minutos DESC LIMIT 1;
 IF fixture.actor IS NULL THEN RAISE EXCEPTION 'No existing clinic has all required booking test data'; END IF;
 PERFORM set_config('vettrack.flow.actor',fixture.actor::text,true);
 PERFORM set_config('vettrack.flow.doctor',fixture.doctor::text,true);
 PERFORM set_config('vettrack.flow.service',fixture.service::text,true);
 PERFORM set_config('vettrack.flow.patient',fixture.patient::text,true);
 PERFORM set_config('vettrack.flow.owner',fixture.owner::text,true);
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('vettrack.flow.actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE doctor uuid:=current_setting('vettrack.flow.doctor')::uuid; service uuid:=current_setting('vettrack.flow.service')::uuid;
 options jsonb; saved jsonb; body jsonb; original_price numeric; d date; i integer; BEGIN
 SELECT costo INTO original_price FROM public.servicio WHERE id_servicio=service;
 options:=public.vettrack_disponibilidad(doctor,'2030-01-07',30,ARRAY[service]);
 IF (options->>'duracion_minutos')::integer>(options->>'bloque_maximo_minutos')::integer
   AND jsonb_array_length(options->'slots')<>0 THEN RAISE EXCEPTION 'Oversized service was offered in a shorter block'; END IF;
 -- Temporary test adjustment, NEVER committed to the real catalog.
 PERFORM public.vettrack_guardar_servicio(service,'{"duracion_minutos":30}');
 FOR i IN 0..30 LOOP
  d:='2030-01-07'::date+i;
  options:=public.vettrack_disponibilidad(doctor,d,30,ARRAY[service]);
  EXIT WHEN jsonb_array_length(options->'slots')>0;
 END LOOP;
 IF jsonb_array_length(options->'slots')=0 THEN RAISE EXCEPTION 'No valid existing weekly slot found for controlled booking test'; END IF;
 body:=jsonb_build_object('id_dueno',current_setting('vettrack.flow.owner'),'id_mascota',current_setting('vettrack.flow.patient'),
  'id_medico',doctor,'fecha_inicio',options->'slots'->0->>'fecha_inicio','servicios',jsonb_build_array(service),'motivo','Controlled booking test; transaction rolls back');
 BEGIN
  PERFORM public.vettrack_guardar_cita(NULL,body||jsonb_build_object('id_dueno',gen_random_uuid()));
  RAISE EXCEPTION 'Wrong owner accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 saved:=public.vettrack_guardar_cita(NULL,body);
 IF saved->>'estado'<>'programada' OR jsonb_array_length(saved->'servicios')<>1
  OR (saved->>'id_medico')::uuid<>doctor OR (saved->'servicios'->0->>'precio_aplicado')::numeric<>original_price
  OR (saved->'servicios'->0->>'duracion_aplicada')::integer<>30 THEN RAISE EXCEPTION 'Real booking did not preserve required values'; END IF;
 PERFORM public.vettrack_guardar_servicio(service,jsonb_build_object('costo',original_price+1));
 IF NOT EXISTS(SELECT 1 FROM public.cita_servicio WHERE id_cita=(saved->>'id_cita')::uuid AND precio_aplicado=original_price) THEN
  RAISE EXCEPTION 'Catalog change rewrote a booked price'; END IF;
 BEGIN
  PERFORM public.vettrack_guardar_cita(NULL,body);
  RAISE EXCEPTION 'Overlapping appointment accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 RAISE NOTICE 'PASS real clinic actor, current owner/patient, active doctor, weekly availability, automatic state, frozen price/duration and overlap rejection';
END $$;
RESET ROLE;
ROLLBACK;
