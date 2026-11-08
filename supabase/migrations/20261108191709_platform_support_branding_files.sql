BEGIN;
CREATE INDEX mascota_dueno_nombre_prefix_idx ON public.mascota(id_dueno,lower(nombre) text_pattern_ops);

-- Existing clinics have no trustworthy creation timestamp: keep it unknown.
ALTER TABLE public.veterinaria ADD COLUMN estado text NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','suspendido')),
 ADD COLUMN creado_en timestamptz, ADD COLUMN actualizado_en timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.veterinaria ALTER COLUMN creado_en SET DEFAULT now();
CREATE INDEX veterinaria_estado_idx ON public.veterinaria(estado);
CREATE TABLE public.auditoria_plataforma (
 id_auditoria uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid REFERENCES public.veterinaria,
 id_usuario uuid NOT NULL REFERENCES auth.users(id),accion text NOT NULL,detalle jsonb NOT NULL DEFAULT '{}',creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_plataforma_tenant_fecha_idx ON public.auditoria_plataforma(id_veterinaria,creado_en DESC);
CREATE INDEX auditoria_plataforma_usuario_idx ON public.auditoria_plataforma(id_usuario);

CREATE OR REPLACE FUNCTION private.my_veterinaria() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.id_veterinaria FROM public.perfilusuario p JOIN public.veterinaria v USING(id_veterinaria)
 WHERE p.id=auth.uid() AND p.activo AND p.rol IN ('admin','recepcionista','medico') AND v.estado='activo' AND NOT private.is_superadmin(p.id);
$$;
CREATE OR REPLACE FUNCTION private.my_permissions() RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT permission.clave FROM public.perfilusuario profile CROSS JOIN public.permiso permission
 LEFT JOIN public.rol_permiso role_permission ON role_permission.rol=profile.rol AND role_permission.clave=permission.clave
 LEFT JOIN public.usuario_permiso override_permission ON override_permission.id_usuario=profile.id AND override_permission.clave=permission.clave
 WHERE profile.id=auth.uid() AND profile.activo AND profile.id_veterinaria=private.my_veterinaria()
 AND (profile.rol='admin' OR (profile.rol IN ('recepcionista','medico') AND permission.clave<>'usuarios.permisos'
 AND coalesce(override_permission.permitido,role_permission.clave IS NOT NULL))) ORDER BY permission.clave;
$$;
CREATE FUNCTION private.support_actor() RETURNS public.perfilusuario LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.perfilusuario;BEGIN
 SELECT * INTO p FROM public.perfilusuario WHERE id=auth.uid() AND activo AND rol IN ('admin','recepcionista','medico');
 IF p.id IS NULL OR p.id_veterinaria IS NULL OR private.is_superadmin(p.id) THEN RAISE EXCEPTION 'Cuenta de clínica requerida' USING ERRCODE='42501';END IF;RETURN p;
END $$;
CREATE TABLE public.ticket_soporte (
 id_ticket uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,
 id_usuario uuid NOT NULL,rol text NOT NULL CHECK(rol IN ('admin','recepcionista','medico')),
 asunto text NOT NULL CHECK(length(btrim(asunto)) BETWEEN 1 AND 200),categoria text NOT NULL CHECK(categoria IN ('acceso','operacion','archivos','otro')),
 descripcion text NOT NULL CHECK(length(btrim(descripcion)) BETWEEN 1 AND 10000),prioridad text NOT NULL DEFAULT 'normal' CHECK(prioridad IN ('baja','normal','alta')),
 estado text NOT NULL DEFAULT 'abierto' CHECK(estado IN ('abierto','en_revision','en_proceso','resuelto','cerrado')),
 modulo text CHECK(length(modulo)<=150),creado_en timestamptz NOT NULL DEFAULT now(),actualizado_en timestamptz NOT NULL DEFAULT now(),cerrado_en timestamptz,
 UNIQUE(id_ticket,id_veterinaria),FOREIGN KEY(id_usuario,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria)
);
CREATE INDEX ticket_soporte_tenant_fecha_idx ON public.ticket_soporte(id_veterinaria,creado_en DESC);
CREATE INDEX ticket_soporte_usuario_tenant_idx ON public.ticket_soporte(id_usuario,id_veterinaria);
CREATE INDEX ticket_soporte_estado_prioridad_idx ON public.ticket_soporte(estado,prioridad,creado_en DESC);
CREATE TABLE public.ticket_respuesta (
 id_respuesta uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_ticket uuid NOT NULL,id_veterinaria uuid NOT NULL,
 id_usuario uuid REFERENCES auth.users(id),es_superadmin boolean NOT NULL DEFAULT false,mensaje text NOT NULL CHECK(length(btrim(mensaje)) BETWEEN 1 AND 10000),
 creado_en timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(id_ticket,id_veterinaria) REFERENCES public.ticket_soporte(id_ticket,id_veterinaria)
);
CREATE INDEX ticket_respuesta_ticket_tenant_fecha_idx ON public.ticket_respuesta(id_ticket,id_veterinaria,creado_en);
CREATE INDEX ticket_respuesta_usuario_idx ON public.ticket_respuesta(id_usuario);
CREATE FUNCTION private.can_ticket(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.ticket_soporte t WHERE t.id_ticket=p_id AND
 (private.is_superadmin(auth.uid()) OR EXISTS(SELECT 1 FROM public.perfilusuario p WHERE p.id=auth.uid() AND p.activo AND p.rol IN ('admin','recepcionista','medico')
 AND NOT private.is_superadmin(p.id) AND p.id_veterinaria=t.id_veterinaria AND (p.rol='admin' OR t.id_usuario=p.id))));
$$;

CREATE TABLE public.archivo_clinica (
 id_archivo uuid PRIMARY KEY DEFAULT gen_random_uuid(),id_veterinaria uuid NOT NULL REFERENCES public.veterinaria,
 categoria text NOT NULL CHECK(categoria IN ('logo','compras','estudios','soporte')),contexto_id uuid,
 bucket text NOT NULL CHECK(bucket IN ('clinic-assets','clinic-files')),ruta text NOT NULL UNIQUE,
 nombre text NOT NULL CHECK(length(nombre) BETWEEN 1 AND 200),mime text NOT NULL CHECK(mime IN ('application/pdf','image/png','image/jpeg')),
 tamano integer NOT NULL CHECK(tamano>0 AND tamano<=10485760),estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','listo','eliminando')),
 creado_por uuid NOT NULL REFERENCES auth.users(id),creado_en timestamptz NOT NULL DEFAULT now(),vinculo_id uuid,huella_sha256 text CHECK(huella_sha256 IS NULL OR huella_sha256~'^[a-f0-9]{64}$'),
 UNIQUE(id_archivo,id_veterinaria),CHECK(categoria<>'logo' OR (bucket='clinic-assets' AND mime IN ('image/png','image/jpeg') AND tamano<=5242880)),
 CHECK(categoria='logo' OR bucket='clinic-files'),CHECK(ruta LIKE id_veterinaria::text||'/'||categoria||'/'||id_archivo::text||'.%')
);
CREATE INDEX archivo_clinica_tenant_idx ON public.archivo_clinica(id_veterinaria);
CREATE INDEX archivo_clinica_creador_idx ON public.archivo_clinica(creado_por);
CREATE INDEX archivo_clinica_contexto_idx ON public.archivo_clinica(contexto_id);
ALTER TABLE public.veterinaria ADD COLUMN logo_archivo uuid REFERENCES public.archivo_clinica(id_archivo);
CREATE INDEX veterinaria_logo_idx ON public.veterinaria(logo_archivo);
ALTER TABLE public.compra ADD COLUMN documento_archivo uuid,ADD COLUMN motivo_cierre text CHECK(length(btrim(motivo_cierre)) BETWEEN 1 AND 2000),
 ADD COLUMN cerrado_en timestamptz,ADD COLUMN cerrado_por uuid,
 ADD CONSTRAINT compra_documento_archivo_fk FOREIGN KEY(documento_archivo,id_veterinaria) REFERENCES public.archivo_clinica(id_archivo,id_veterinaria),
 ADD CONSTRAINT compra_cerrado_por_fk FOREIGN KEY(cerrado_por,id_veterinaria) REFERENCES public.perfilusuario(id,id_veterinaria);
ALTER TABLE public.compra DROP CONSTRAINT compra_estado_check;
ALTER TABLE public.compra ADD CONSTRAINT compra_estado_check CHECK(estado IN ('pendiente','recibida','cancelada','no_recibida')),
 ADD CONSTRAINT compra_cierre_check CHECK(estado NOT IN ('cancelada','no_recibida') OR (motivo_cierre IS NOT NULL AND cerrado_en IS NOT NULL AND cerrado_por IS NOT NULL));
CREATE INDEX compra_documento_archivo_idx ON public.compra(documento_archivo,id_veterinaria);
CREATE INDEX compra_cerrado_por_idx ON public.compra(cerrado_por,id_veterinaria);
ALTER TABLE public.estudio_clinico ADD COLUMN archivo_adjunto uuid,
 ADD CONSTRAINT estudio_archivo_fk FOREIGN KEY(archivo_adjunto,id_veterinaria) REFERENCES public.archivo_clinica(id_archivo,id_veterinaria);
CREATE INDEX estudio_archivo_idx ON public.estudio_clinico(archivo_adjunto,id_veterinaria);
ALTER TABLE public.ticket_soporte ADD COLUMN adjunto uuid,ADD CONSTRAINT ticket_archivo_fk FOREIGN KEY(adjunto,id_veterinaria) REFERENCES public.archivo_clinica(id_archivo,id_veterinaria);
ALTER TABLE public.ticket_respuesta ADD COLUMN adjunto uuid,ADD CONSTRAINT respuesta_archivo_fk FOREIGN KEY(adjunto,id_veterinaria) REFERENCES public.archivo_clinica(id_archivo,id_veterinaria);
CREATE INDEX ticket_archivo_idx ON public.ticket_soporte(adjunto,id_veterinaria);
CREATE INDEX respuesta_archivo_idx ON public.ticket_respuesta(adjunto,id_veterinaria);

CREATE FUNCTION private.can_file(p_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.archivo_clinica;p public.perfilusuario;BEGIN
 SELECT * INTO f FROM public.archivo_clinica WHERE id_archivo=p_id AND estado='listo';IF NOT FOUND THEN RETURN false;END IF;
 IF private.is_superadmin(auth.uid()) THEN RETURN f.categoria='logo' OR (f.categoria='soporte' AND private.can_ticket(f.contexto_id));END IF;
 SELECT * INTO p FROM public.perfilusuario WHERE id=auth.uid() AND activo AND id_veterinaria=f.id_veterinaria AND rol IN ('admin','recepcionista','medico');
 IF NOT FOUND THEN RETURN false;END IF;
 IF f.categoria='soporte' THEN RETURN (f.contexto_id IS NULL AND f.creado_por=p.id) OR private.can_ticket(f.contexto_id);END IF;
 IF private.my_veterinaria() IS DISTINCT FROM f.id_veterinaria THEN RETURN false;END IF;
 IF f.categoria='logo' THEN RETURN true;END IF;
 IF f.categoria='compras' THEN RETURN private.has_permission('compras.ver') AND EXISTS(SELECT 1 FROM public.compra WHERE id_compra=f.contexto_id AND id_veterinaria=f.id_veterinaria);END IF;
 RETURN p.rol IN ('admin','medico') AND private.has_permission('estudios.ver') AND EXISTS(SELECT 1 FROM public.consulta WHERE id_consulta=f.contexto_id AND id_veterinaria=f.id_veterinaria);
END $$;
CREATE FUNCTION private.link_file() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fid uuid;tenant uuid;cat text;parent uuid;f public.archivo_clinica;BEGIN
 tenant:=NEW.id_veterinaria;
 IF TG_TABLE_NAME='veterinaria' THEN fid:=NEW.logo_archivo;cat:='logo';parent:=NEW.id_veterinaria;
 ELSIF TG_TABLE_NAME='compra' THEN fid:=NEW.documento_archivo;cat:='compras';parent:=NEW.id_compra;
 ELSIF TG_TABLE_NAME='estudio_clinico' THEN fid:=NEW.archivo_adjunto;cat:='estudios';parent:=NEW.id_consulta;
 ELSE fid:=NEW.adjunto;cat:='soporte';parent:=NEW.id_ticket;END IF;
 IF fid IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO f FROM public.archivo_clinica WHERE id_archivo=fid AND id_veterinaria=tenant AND categoria=cat AND estado='listo' FOR UPDATE;
 IF NOT FOUND OR (f.contexto_id IS NOT NULL AND f.contexto_id<>parent) OR (f.vinculo_id IS NOT NULL AND f.vinculo_id<>parent) THEN RAISE EXCEPTION 'Archivo no válido para este registro' USING ERRCODE='23514';END IF;
 UPDATE public.archivo_clinica SET contexto_id=parent,vinculo_id=parent WHERE id_archivo=fid;
 RETURN NEW;
END $$;
CREATE TRIGGER veterinaria_file BEFORE INSERT OR UPDATE OF logo_archivo ON public.veterinaria FOR EACH ROW EXECUTE FUNCTION private.link_file();
CREATE TRIGGER compra_file BEFORE INSERT OR UPDATE OF documento_archivo ON public.compra FOR EACH ROW EXECUTE FUNCTION private.link_file();
CREATE TRIGGER estudio_file BEFORE INSERT OR UPDATE OF archivo_adjunto ON public.estudio_clinico FOR EACH ROW EXECUTE FUNCTION private.link_file();
CREATE TRIGGER ticket_file BEFORE INSERT OR UPDATE OF adjunto ON public.ticket_soporte FOR EACH ROW EXECUTE FUNCTION private.link_file();
CREATE TRIGGER respuesta_file BEFORE INSERT OR UPDATE OF adjunto ON public.ticket_respuesta FOR EACH ROW EXECUTE FUNCTION private.link_file();

CREATE FUNCTION private.consultation_next_date() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.proxima_cita IS NOT NULL AND NEW.proxima_cita<(NEW.fecha_inicio AT TIME ZONE 'America/Tijuana')::date
 AND (TG_OP='INSERT' OR NEW.proxima_cita IS DISTINCT FROM OLD.proxima_cita OR NEW.fecha_inicio IS DISTINCT FROM OLD.fecha_inicio) THEN
 RAISE EXCEPTION 'La próxima cita no puede ser anterior a la consulta' USING ERRCODE='22023';END IF;RETURN NEW;
END $$;
CREATE TRIGGER consultation_next_date BEFORE INSERT OR UPDATE OF proxima_cita,fecha_inicio ON public.consulta FOR EACH ROW EXECUTE FUNCTION private.consultation_next_date();
CREATE FUNCTION private.future_document_branding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE logo uuid;license text;context jsonb;weight numeric;BEGIN
 SELECT v.logo_archivo,p.cedula_profesional INTO logo,license FROM public.consulta c JOIN public.veterinaria v USING(id_veterinaria) JOIN public.perfilusuario p ON p.id=c.id_medico WHERE c.id_consulta=NEW.id_consulta AND c.id_veterinaria=NEW.id_veterinaria;
 -- Serialize snapshot creation against physical deletion of an unlinked logo.
 IF logo IS NOT NULL THEN
  PERFORM 1 FROM public.archivo_clinica WHERE id_archivo=logo AND estado='listo' FOR UPDATE;
  IF NOT FOUND THEN logo:=NULL;END IF;
 END IF;
 NEW.contenido:=NEW.contenido||jsonb_build_object('pdf_version',2,'logo_archivo',logo);
 IF NEW.tipo='orden_recepcion' THEN
  SELECT c.contexto,c.peso INTO context,weight FROM public.consulta c WHERE c.id_consulta=NEW.id_consulta AND c.id_veterinaria=NEW.id_veterinaria;
  NEW.contenido:=jsonb_set(NEW.contenido,'{medico,cedula_profesional}',coalesce(to_jsonb(license),'null'));
  NEW.contenido:=jsonb_set(NEW.contenido,'{paciente}',coalesce(context->'paciente','{}')||coalesce(NEW.contenido->'paciente','{}')||jsonb_build_object('peso',weight));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER future_document_branding BEFORE INSERT ON public.documento_clinico FOR EACH ROW EXECUTE FUNCTION private.future_document_branding();

CREATE FUNCTION private.platform_api(p_operacion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_column
DECLARE sa boolean:=private.is_superadmin(auth.uid());p public.perfilusuario;v public.veterinaria;t public.ticket_soporte;f public.archivo_clinica;
 target public.perfilusuario;tenant uuid;rid uuid;result jsonb;rows_data jsonb;new_id uuid;lim integer:=25;off integer:=0;q text;has_patients boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión requerida' USING ERRCODE='42501';END IF;
 IF p_operacion IN ('global_dashboard','tenants','tenant','tenant_guardar','tenant_estado','admin_objetivo','admin_estado') THEN
  IF NOT sa THEN RAISE EXCEPTION 'Superadmin requerido' USING ERRCODE='42501';END IF;
  IF p_operacion='global_dashboard' THEN
   PERFORM private.op_body(p_datos,ARRAY[]::text[]);
   RETURN jsonb_build_object('activos',(SELECT count(*) FROM public.veterinaria WHERE estado='activo'),'suspendidos',(SELECT count(*) FROM public.veterinaria WHERE estado='suspendido'),
    'usuarios',(SELECT count(*) FROM public.perfilusuario WHERE id_veterinaria IS NOT NULL AND NOT private.is_superadmin(id)),
    'administradores',(SELECT count(*) FROM public.perfilusuario WHERE rol='admin' AND id_veterinaria IS NOT NULL AND NOT private.is_superadmin(id)),
    'recientes',(SELECT count(*) FROM public.veterinaria WHERE creado_en>=now()-interval '30 days'),
    'tickets_abiertos',(SELECT count(*) FROM public.ticket_soporte WHERE estado='abierto'),
    'tickets_en_atencion',(SELECT count(*) FROM public.ticket_soporte WHERE estado IN ('en_revision','en_proceso')));
  ELSIF p_operacion='tenants' THEN
   PERFORM private.op_body(p_datos,ARRAY['q','estado','offset']);off:=coalesce((p_datos->>'offset')::integer,0);
   IF off NOT BETWEEN 0 AND 100000 OR length(p_datos->>'q')>150 THEN RAISE EXCEPTION 'Filtro inválido' USING ERRCODE='22023';END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY nombre,id_veterinaria),'[]') INTO rows_data FROM (
    SELECT v.id_veterinaria,v.nombre,v.estado,v.creado_en,v.telefono,v.correo,v.logo_archivo,
     (SELECT count(*) FROM public.perfilusuario WHERE id_veterinaria=v.id_veterinaria AND NOT private.is_superadmin(id)) usuarios,
     (SELECT count(*) FROM public.perfilusuario WHERE id_veterinaria=v.id_veterinaria AND rol='admin' AND NOT private.is_superadmin(id)) administradores
    FROM public.veterinaria v WHERE (nullif(p_datos->>'q','') IS NULL OR v.nombre ILIKE '%'||(p_datos->>'q')||'%')
     AND (nullif(p_datos->>'estado','') IS NULL OR v.estado=p_datos->>'estado') ORDER BY v.nombre,v.id_veterinaria LIMIT 25 OFFSET off
   ) x;RETURN jsonb_build_object('filas',rows_data,'offset',off,'hay_mas',jsonb_array_length(rows_data)=25);
  END IF;
  IF p_operacion IN ('admin_objetivo','admin_estado') THEN
   PERFORM private.op_body(p_datos,CASE WHEN p_operacion='admin_estado' THEN ARRAY['id_veterinaria','id','activo'] ELSE ARRAY['id_veterinaria','id'] END);
  ELSE PERFORM private.op_body(p_datos,CASE p_operacion WHEN 'tenant' THEN ARRAY['id'] WHEN 'tenant_estado' THEN ARRAY['id','estado','motivo'] ELSE ARRAY['id','nombre','direccion','telefono','correo'] END);END IF;
  tenant:=coalesce(p_datos->>'id_veterinaria',p_datos->>'id')::uuid;
  SELECT * INTO v FROM public.veterinaria WHERE id_veterinaria=tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veterinaria no encontrada' USING ERRCODE='P0002';END IF;
  IF p_operacion IN ('admin_objetivo','admin_estado') THEN
   SELECT * INTO target FROM public.perfilusuario WHERE id=(p_datos->>'id')::uuid AND id_veterinaria=tenant AND rol='admin' AND NOT private.is_superadmin(id) FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Administrador no encontrado' USING ERRCODE='P0002';END IF;
   IF p_operacion='admin_estado' THEN
    IF jsonb_typeof(p_datos->'activo') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Estado requerido' USING ERRCODE='22023';END IF;
    IF NOT (p_datos->>'activo')::boolean AND target.activo AND (SELECT count(*) FROM public.perfilusuario WHERE id_veterinaria=tenant AND rol='admin' AND activo AND NOT private.is_superadmin(id))<=1 THEN
     RAISE EXCEPTION 'Debe conservarse un administrador activo' USING ERRCODE='23514';END IF;
    UPDATE public.perfilusuario SET activo=(p_datos->>'activo')::boolean WHERE id=target.id RETURNING * INTO target;
    INSERT INTO public.auditoria_plataforma(id_veterinaria,id_usuario,accion,detalle) VALUES(tenant,auth.uid(),'admin_estado',jsonb_build_object('id',target.id,'activo',target.activo));
   END IF;RETURN jsonb_build_object('id',target.id,'id_veterinaria',tenant,'activo',target.activo,'nombre',target.nombre);
  ELSIF p_operacion='tenant_estado' THEN
   IF p_datos->>'estado' NOT IN ('activo','suspendido') OR p_datos->>'estado' IS NULL OR (p_datos->>'estado'='suspendido' AND nullif(btrim(p_datos->>'motivo'),'') IS NULL) OR length(p_datos->>'motivo')>2000 THEN
    RAISE EXCEPTION 'Estado y motivo de suspensión requeridos' USING ERRCODE='22023';END IF;
   UPDATE public.veterinaria SET estado=p_datos->>'estado',actualizado_en=now() WHERE id_veterinaria=tenant;
   INSERT INTO public.auditoria_plataforma(id_veterinaria,id_usuario,accion,detalle) VALUES(tenant,auth.uid(),'tenant_estado',jsonb_build_object('anterior',v.estado,'estado',p_datos->>'estado','motivo',p_datos->>'motivo'));
   RETURN jsonb_build_object('estado',p_datos->>'estado');
  ELSIF p_operacion='tenant_guardar' THEN
   IF nullif(btrim(p_datos->>'nombre'),'') IS NULL OR length(p_datos->>'nombre')>150 OR length(p_datos->>'telefono')>20 OR length(p_datos->>'direccion')>2000 OR length(p_datos->>'correo')>100
   OR (nullif(p_datos->>'correo','') IS NOT NULL AND p_datos->>'correo'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'Datos de veterinaria inválidos' USING ERRCODE='22023';END IF;
   UPDATE public.veterinaria SET nombre=btrim(p_datos->>'nombre'),direccion=nullif(btrim(p_datos->>'direccion'),''),telefono=nullif(btrim(p_datos->>'telefono'),''),correo=nullif(btrim(p_datos->>'correo'),''),actualizado_en=now() WHERE id_veterinaria=tenant;
   INSERT INTO public.auditoria_plataforma(id_veterinaria,id_usuario,accion) VALUES(tenant,auth.uid(),'tenant_editar');RETURN jsonb_build_object('guardado',true);
  ELSE
   RETURN jsonb_build_object('veterinaria',to_jsonb(v),'usuarios',(SELECT count(*) FROM public.perfilusuario WHERE id_veterinaria=tenant AND NOT private.is_superadmin(id)),
    'por_rol',(SELECT coalesce(jsonb_object_agg(rol,n),'{}') FROM (SELECT rol,count(*) n FROM public.perfilusuario WHERE id_veterinaria=tenant AND NOT private.is_superadmin(id) GROUP BY rol) x),
    'pacientes',(SELECT count(*) FROM public.mascota m JOIN public.dueno d USING(id_dueno) WHERE d.id_veterinaria=tenant),
    'ultima_actividad',(SELECT max(u.last_sign_in_at) FROM auth.users u JOIN public.perfilusuario p ON p.id=u.id WHERE p.id_veterinaria=tenant AND NOT private.is_superadmin(p.id)),
    'administradores',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'telefono',p.telefono,'activo',p.activo,'correo',u.email,'ultimo_acceso',u.last_sign_in_at) ORDER BY p.nombre,p.id),'[]') FROM public.perfilusuario p JOIN auth.users u ON u.id=p.id WHERE p.id_veterinaria=tenant AND p.rol='admin' AND NOT private.is_superadmin(p.id)));
  END IF;
 END IF;

 IF p_operacion IN ('tickets','ticket','ticket_crear','ticket_responder','ticket_estado') THEN
  IF NOT sa THEN p:=private.support_actor();END IF;
  IF p_operacion='tickets' THEN
   PERFORM private.op_body(p_datos,ARRAY['id_veterinaria','estado','prioridad','offset']);off:=coalesce((p_datos->>'offset')::integer,0);
   IF off NOT BETWEEN 0 AND 100000 OR (NOT sa AND nullif(p_datos->>'id_veterinaria','') IS NOT NULL AND (p_datos->>'id_veterinaria')::uuid<>p.id_veterinaria) THEN RAISE EXCEPTION 'Filtro no permitido' USING ERRCODE='42501';END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY actualizado_en DESC,id_ticket),'[]') INTO rows_data FROM (
    SELECT t.*,v.nombre veterinaria,p.nombre usuario FROM public.ticket_soporte t JOIN public.veterinaria v USING(id_veterinaria) JOIN public.perfilusuario p ON p.id=t.id_usuario
    WHERE private.can_ticket(t.id_ticket) AND (nullif(p_datos->>'id_veterinaria','') IS NULL OR t.id_veterinaria=(p_datos->>'id_veterinaria')::uuid)
     AND (nullif(p_datos->>'estado','') IS NULL OR t.estado=p_datos->>'estado') AND (nullif(p_datos->>'prioridad','') IS NULL OR t.prioridad=p_datos->>'prioridad')
    ORDER BY t.actualizado_en DESC,t.id_ticket LIMIT 25 OFFSET off
   ) x;RETURN jsonb_build_object('filas',rows_data,'offset',off,'hay_mas',jsonb_array_length(rows_data)=25);
  ELSIF p_operacion='ticket_crear' THEN
   IF sa THEN RAISE EXCEPTION 'Cuenta de clínica requerida' USING ERRCODE='42501';END IF;
   PERFORM private.op_body(p_datos,ARRAY['asunto','categoria','descripcion','prioridad','modulo','adjunto']);
   INSERT INTO public.ticket_soporte(id_veterinaria,id_usuario,rol,asunto,categoria,descripcion,prioridad,modulo,adjunto)
    VALUES(p.id_veterinaria,p.id,p.rol,btrim(p_datos->>'asunto'),p_datos->>'categoria',btrim(p_datos->>'descripcion'),coalesce(p_datos->>'prioridad','normal'),p_datos->>'modulo',(p_datos->>'adjunto')::uuid) RETURNING * INTO t;
   RETURN to_jsonb(t);
  END IF;
  PERFORM private.op_body(p_datos,CASE p_operacion WHEN 'ticket' THEN ARRAY['id'] WHEN 'ticket_estado' THEN ARRAY['id','estado'] ELSE ARRAY['id','mensaje','adjunto'] END);
  SELECT * INTO t FROM public.ticket_soporte WHERE id_ticket=(p_datos->>'id')::uuid AND private.can_ticket(id_ticket) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE='P0002';END IF;
  IF p_operacion='ticket_estado' THEN
   IF NOT sa THEN RAISE EXCEPTION 'Superadmin requerido' USING ERRCODE='42501';END IF;
   IF p_datos->>'estado' NOT IN ('abierto','en_revision','en_proceso','resuelto','cerrado') OR p_datos->>'estado' IS NULL THEN RAISE EXCEPTION 'Estado inválido' USING ERRCODE='22023';END IF;
   UPDATE public.ticket_soporte SET estado=p_datos->>'estado',actualizado_en=now(),cerrado_en=CASE WHEN p_datos->>'estado'='cerrado' THEN now() ELSE NULL END WHERE id_ticket=t.id_ticket;
   INSERT INTO public.ticket_respuesta(id_ticket,id_veterinaria,id_usuario,es_superadmin,mensaje) VALUES(t.id_ticket,t.id_veterinaria,auth.uid(),true,'Estado actualizado: '||(p_datos->>'estado'));
  ELSIF p_operacion='ticket_responder' THEN
   IF t.estado='cerrado' THEN RAISE EXCEPTION 'El ticket está cerrado' USING ERRCODE='23514';END IF;
   INSERT INTO public.ticket_respuesta(id_ticket,id_veterinaria,id_usuario,es_superadmin,mensaje,adjunto) VALUES(t.id_ticket,t.id_veterinaria,auth.uid(),sa,btrim(p_datos->>'mensaje'),(p_datos->>'adjunto')::uuid);
   UPDATE public.ticket_soporte SET actualizado_en=now() WHERE id_ticket=t.id_ticket;
  END IF;
  RETURN jsonb_build_object('ticket',(SELECT to_jsonb(x)||jsonb_build_object('veterinaria',v.nombre,'usuario',p.nombre) FROM public.ticket_soporte x JOIN public.veterinaria v USING(id_veterinaria) JOIN public.perfilusuario p ON p.id=x.id_usuario WHERE x.id_ticket=t.id_ticket),
   'respuestas',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'id_veterinaria' ORDER BY r.creado_en,r.id_respuesta),'[]') FROM public.ticket_respuesta r WHERE r.id_ticket=t.id_ticket));
 END IF;


 IF p_operacion IN ('propietarios_resumen','propietario','citas_explorar') THEN
  tenant:=private.my_veterinaria();
  IF tenant IS NULL OR NOT private.has_permission(CASE WHEN p_operacion='citas_explorar' THEN 'citas.ver' ELSE 'propietarios.ver' END) THEN RAISE EXCEPTION 'Permiso requerido' USING ERRCODE='42501';END IF;
  off:=coalesce((p_datos->>'offset')::integer,0);q:=coalesce(p_datos->>'q','');
  IF off NOT BETWEEN 0 AND 100000 OR length(q)>150 THEN RAISE EXCEPTION 'Filtro inválido' USING ERRCODE='22023';END IF;
  IF p_operacion='citas_explorar' THEN
   PERFORM private.op_body(p_datos,ARRAY['vista','fecha','medico','estado','q','offset']);
   IF p_datos->>'vista' NOT IN ('hoy','pendientes','todas') OR p_datos->>'vista' IS NULL THEN RAISE EXCEPTION 'Vista inválida' USING ERRCODE='22023';END IF;
   SELECT coalesce(jsonb_agg(private.op_appointment_json(x.id_cita) ORDER BY x.fecha_inicio,x.id_cita),'[]') INTO rows_data FROM (
    SELECT c.id_cita,c.fecha_inicio FROM public.cita c JOIN public.mascota m USING(id_mascota) JOIN public.dueno d ON d.id_dueno=c.id_dueno LEFT JOIN public.perfilusuario pr ON pr.id=c.id_medico
    WHERE c.id_veterinaria=tenant AND (p_datos->>'vista'<>'pendientes' OR c.estado IN ('programada','confirmada','en_espera','en_consulta'))
     AND (p_datos->>'vista'<>'hoy' OR (c.fecha_inicio AT TIME ZONE 'America/Tijuana')::date=coalesce((p_datos->>'fecha')::date,(now() AT TIME ZONE 'America/Tijuana')::date))
     AND (p_datos->>'vista'='hoy' OR nullif(p_datos->>'fecha','') IS NULL OR (c.fecha_inicio AT TIME ZONE 'America/Tijuana')::date=(p_datos->>'fecha')::date)
     AND (nullif(p_datos->>'medico','') IS NULL OR c.id_medico=(p_datos->>'medico')::uuid)
     AND (nullif(p_datos->>'estado','') IS NULL OR c.estado=p_datos->>'estado')
     AND (q='' OR m.nombre ILIKE '%'||q||'%' OR d.nombre ILIKE '%'||q||'%' OR pr.nombre ILIKE '%'||q||'%')
    ORDER BY c.fecha_inicio,c.id_cita LIMIT 50 OFFSET off
   ) x;RETURN jsonb_build_object('filas',rows_data,'offset',off,'hay_mas',jsonb_array_length(rows_data)=50);
  END IF;
  has_patients:=private.has_permission('pacientes.ver');
  IF p_operacion='propietarios_resumen' THEN
   PERFORM private.op_body(p_datos,ARRAY['q','offset']);
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY nombre,id_dueno),'[]') INTO rows_data FROM (
    SELECT d.id_dueno,d.nombre,d.telefono,d.correo,d.direccion,
     CASE WHEN has_patients THEN (SELECT count(*) FROM public.mascota m WHERE m.id_dueno=d.id_dueno) ELSE NULL END total_pacientes,
     CASE WHEN has_patients THEN (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY nombre,id_mascota),'[]') FROM (SELECT m.id_mascota,m.nombre FROM public.mascota m WHERE m.id_dueno=d.id_dueno ORDER BY m.nombre,m.id_mascota LIMIT 2) a) ELSE '[]'::jsonb END pacientes
    FROM public.dueno d WHERE d.id_veterinaria=tenant AND (q='' OR d.nombre ILIKE '%'||q||'%' OR d.telefono ILIKE '%'||q||'%' OR
     (has_patients AND EXISTS(SELECT 1 FROM public.mascota m WHERE m.id_dueno=d.id_dueno AND lower(m.nombre) LIKE lower(q)||'%')))
    ORDER BY d.nombre,d.id_dueno LIMIT 25 OFFSET off
   ) x;RETURN jsonb_build_object('filas',rows_data,'offset',off,'hay_mas',jsonb_array_length(rows_data)=25);
  END IF;
  PERFORM private.op_body(p_datos,ARRAY['id','offset']);rid:=(p_datos->>'id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.dueno WHERE id_dueno=rid AND id_veterinaria=tenant) THEN RAISE EXCEPTION 'Propietario no encontrado' USING ERRCODE='P0002';END IF;
  SELECT CASE WHEN has_patients THEN coalesce(jsonb_agg(to_jsonb(x) ORDER BY nombre,id_mascota),'[]') ELSE '[]'::jsonb END INTO rows_data FROM (
   SELECT id_mascota,nombre,especie,raza,sexo FROM public.mascota WHERE id_dueno=rid ORDER BY nombre,id_mascota LIMIT 100 OFFSET off
  ) x;
  RETURN jsonb_build_object('propietario',(SELECT jsonb_build_object('id_dueno',id_dueno,'nombre',nombre,'telefono',telefono,'correo',correo,'direccion',direccion) FROM public.dueno WHERE id_dueno=rid AND id_veterinaria=tenant),
   'pacientes',rows_data,'total_pacientes',CASE WHEN has_patients THEN (SELECT count(*) FROM public.mascota WHERE id_dueno=rid) ELSE NULL END,'offset',off,'hay_mas',has_patients AND jsonb_array_length(rows_data)=100);
 END IF;
 IF p_operacion IN ('sesion_plataforma','logo','logo_guardar','archivo_preparar','archivo','archivo_borrar') THEN
  IF NOT sa THEN p:=private.support_actor();tenant:=p.id_veterinaria;END IF;
  IF p_operacion='sesion_plataforma' THEN
   PERFORM private.op_body(p_datos,ARRAY[]::text[]);RETURN jsonb_build_object('nombre_veterinaria',CASE WHEN sa THEN NULL ELSE (SELECT nombre FROM public.veterinaria WHERE id_veterinaria=tenant) END,'superadmin',sa,'estado',CASE WHEN sa THEN NULL ELSE (SELECT estado FROM public.veterinaria WHERE id_veterinaria=tenant) END,
    'logo_archivo',CASE WHEN sa THEN NULL ELSE (SELECT logo_archivo FROM public.veterinaria WHERE id_veterinaria=tenant) END);
  ELSIF p_operacion IN ('logo','logo_guardar') THEN
   IF sa THEN RAISE EXCEPTION 'Cuenta de clínica requerida' USING ERRCODE='42501';END IF;
   PERFORM private.op_body(p_datos,CASE WHEN p_operacion='logo' THEN ARRAY[]::text[] ELSE ARRAY['id_archivo'] END);
   IF private.my_veterinaria() IS NULL THEN RAISE EXCEPTION 'Veterinaria suspendida' USING ERRCODE='42501';END IF;
   IF p_operacion='logo_guardar' THEN
    p:=private.lock_actor('configuracion.editar');UPDATE public.veterinaria SET logo_archivo=(p_datos->>'id_archivo')::uuid,actualizado_en=now() WHERE id_veterinaria=tenant;
   END IF;RETURN jsonb_build_object('id_archivo',(SELECT logo_archivo FROM public.veterinaria WHERE id_veterinaria=tenant));
  ELSIF p_operacion='archivo_preparar' THEN
   PERFORM private.op_body(p_datos,ARRAY['categoria','contexto_id','nombre','mime','tamano']);
   IF p_datos->>'categoria'='soporte' THEN
    rid:=(p_datos->>'contexto_id')::uuid;
    IF rid IS NOT NULL THEN SELECT * INTO t FROM public.ticket_soporte WHERE id_ticket=rid AND private.can_ticket(id_ticket) AND estado<>'cerrado';IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado' USING ERRCODE='P0002';END IF;tenant:=t.id_veterinaria;
    ELSIF sa THEN RAISE EXCEPTION 'Selecciona un ticket' USING ERRCODE='22023';END IF;
   ELSE
    IF sa OR private.my_veterinaria() IS NULL THEN RAISE EXCEPTION 'Operación de clínica requerida' USING ERRCODE='42501';END IF;
    IF p_datos->>'categoria'='logo' THEN p:=private.lock_actor('configuracion.editar');rid:=tenant;
    ELSIF p_datos->>'categoria'='compras' THEN
     p:=private.lock_actor('compras.recibir');rid:=(p_datos->>'contexto_id')::uuid;
     IF NOT EXISTS(SELECT 1 FROM public.compra WHERE id_compra=rid AND id_veterinaria=tenant AND estado='pendiente') THEN RAISE EXCEPTION 'Compra pendiente no encontrada' USING ERRCODE='P0002';END IF;
    ELSIF p_datos->>'categoria'='estudios' THEN
     rid:=(p_datos->>'contexto_id')::uuid;PERFORM private.cl_open(rid,CASE WHEN private.has_permission('estudios.crear') THEN 'estudios.crear' ELSE 'estudios.editar' END);
    ELSE RAISE EXCEPTION 'Categoría inválida' USING ERRCODE='22023';END IF;
   END IF;
   new_id:=gen_random_uuid();
   INSERT INTO public.archivo_clinica(id_archivo,id_veterinaria,categoria,contexto_id,bucket,ruta,nombre,mime,tamano,creado_por)
    VALUES(new_id,tenant,p_datos->>'categoria',rid,CASE WHEN p_datos->>'categoria'='logo' THEN 'clinic-assets' ELSE 'clinic-files' END,
     tenant::text||'/'||(p_datos->>'categoria')||'/'||new_id::text||CASE p_datos->>'mime' WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END,
     btrim(p_datos->>'nombre'),p_datos->>'mime',(p_datos->>'tamano')::integer,auth.uid()) RETURNING * INTO f;
   RETURN to_jsonb(f);
  END IF;
  PERFORM private.op_body(p_datos,ARRAY['id']);
  -- Serialize attachment binding against physical deletion before checking references.
  IF p_operacion='archivo_borrar' THEN
   SELECT * INTO f FROM public.archivo_clinica WHERE id_archivo=(p_datos->>'id')::uuid AND creado_por=auth.uid() FOR UPDATE;
  ELSE SELECT * INTO f FROM public.archivo_clinica WHERE id_archivo=(p_datos->>'id')::uuid;END IF;
  IF f.id_archivo IS NULL THEN RAISE EXCEPTION 'Archivo no encontrado' USING ERRCODE='P0002';END IF;
  IF p_operacion='archivo' THEN
   IF NOT private.can_file(f.id_archivo) AND NOT (f.creado_por=auth.uid() AND f.estado='pendiente' AND ((f.categoria='soporte' AND (f.contexto_id IS NULL OR private.can_ticket(f.contexto_id))) OR (NOT sa AND private.my_veterinaria()=f.id_veterinaria AND private.has_permission(CASE f.categoria WHEN 'logo' THEN 'configuracion.editar' WHEN 'compras' THEN 'compras.recibir' ELSE CASE WHEN private.has_permission('estudios.crear') THEN 'estudios.crear' ELSE 'estudios.editar' END END)))) THEN
    RAISE EXCEPTION 'Archivo no encontrado' USING ERRCODE='P0002';END IF;
  ELSE
   IF f.creado_por<>auth.uid() OR (NOT private.can_file(f.id_archivo) AND f.estado NOT IN ('pendiente','eliminando')) OR (NOT sa AND tenant IS DISTINCT FROM f.id_veterinaria) OR (sa AND f.categoria<>'soporte') THEN RAISE EXCEPTION 'Archivo no encontrado' USING ERRCODE='P0002';END IF;
   IF EXISTS(SELECT 1 FROM public.veterinaria WHERE logo_archivo=f.id_archivo) OR EXISTS(SELECT 1 FROM public.compra WHERE documento_archivo=f.id_archivo) OR EXISTS(SELECT 1 FROM public.estudio_clinico WHERE archivo_adjunto=f.id_archivo)
    OR EXISTS(SELECT 1 FROM public.ticket_soporte WHERE adjunto=f.id_archivo) OR EXISTS(SELECT 1 FROM public.ticket_respuesta WHERE adjunto=f.id_archivo)
    OR EXISTS(SELECT 1 FROM public.documento_clinico WHERE contenido::text LIKE '%'||f.id_archivo::text||'%') THEN RAISE EXCEPTION 'El archivo conserva referencias históricas' USING ERRCODE='23514';END IF;
   UPDATE public.archivo_clinica SET estado='eliminando' WHERE id_archivo=f.id_archivo;
  END IF;RETURN to_jsonb(f);
 END IF;

 RAISE EXCEPTION 'Operación inválida' USING ERRCODE='22023';
END $$;
CREATE FUNCTION public.vettrack_plataforma(p_operacion text,p_datos jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.platform_api(p_operacion,p_datos); $$;

-- Keep the Phase 5B physical receipt path, guarded before it can touch stock.
ALTER FUNCTION private.inv_api(text,jsonb) RENAME TO inv_api_phase6;
CREATE FUNCTION private.inv_api(p_operacion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.perfilusuario;c public.compra;result jsonb;BEGIN
 IF p_operacion IN ('compra_cerrar','compra_recibir') THEN
  actor:=private.lock_actor(CASE WHEN p_operacion='compra_cerrar' THEN 'compras.administrar' ELSE 'compras.recibir' END);
  SELECT * INTO c FROM public.compra WHERE id_compra=(p_datos->>'id')::uuid AND id_veterinaria=actor.id_veterinaria FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada' USING ERRCODE='P0002';END IF;
  IF p_operacion='compra_cerrar' THEN
   PERFORM private.op_body(p_datos,ARRAY['id','estado','motivo']);
   IF p_datos->>'estado' NOT IN ('cancelada','no_recibida') OR p_datos->>'estado' IS NULL OR nullif(btrim(p_datos->>'motivo'),'') IS NULL OR length(p_datos->>'motivo')>2000 THEN RAISE EXCEPTION 'Estado y motivo requeridos' USING ERRCODE='22023';END IF;
   IF c.estado<>'pendiente' THEN RAISE EXCEPTION 'Solo una compra pendiente admite cierre' USING ERRCODE='23514';END IF;
   UPDATE public.compra SET estado=p_datos->>'estado',motivo_cierre=btrim(p_datos->>'motivo'),cerrado_en=now(),cerrado_por=actor.id WHERE id_compra=c.id_compra RETURNING * INTO c;RETURN to_jsonb(c);
  END IF;
  IF c.estado NOT IN ('pendiente','recibida') THEN RAISE EXCEPTION 'La compra ya está cerrada' USING ERRCODE='23514';END IF;
  IF c.estado='recibida' AND p_datos?'documento_archivo' AND c.documento_archivo IS DISTINCT FROM (p_datos->>'documento_archivo')::uuid THEN RAISE EXCEPTION 'La recepción ya conserva otro documento' USING ERRCODE='23514';END IF;
  result:=private.inv_api_phase6(p_operacion,p_datos-'documento_archivo');
  IF p_datos?'documento_archivo' AND c.estado='pendiente' THEN UPDATE public.compra SET documento_archivo=(p_datos->>'documento_archivo')::uuid WHERE id_compra=c.id_compra RETURNING * INTO c;RETURN to_jsonb(c);END IF;
  RETURN result;
 END IF;
 result:=private.inv_api_phase6(p_operacion,p_datos);
 IF p_operacion IN ('compras','recepciones') THEN
  SELECT coalesce(jsonb_agg(x||jsonb_build_object('documento_archivo',pc.documento_archivo,'motivo_cierre',pc.motivo_cierre,'cerrado_en',pc.cerrado_en,'cerrado_por',pc.cerrado_por) ORDER BY coalesce(x->>'creado_en',x->>'recibido_en') DESC),'[]') INTO result
  FROM jsonb_array_elements(result) x JOIN public.compra pc ON pc.id_compra=coalesce(x->>'id_compra',x->>'id')::uuid AND pc.id_veterinaria=private.my_veterinaria();
 END IF;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.vettrack_inventario(p_operacion text,p_datos jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT private.inv_api(p_operacion,p_datos); $$;

CREATE FUNCTION private.storage_file_read(p_bucket text,p_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.archivo_clinica f WHERE f.bucket=p_bucket AND f.ruta=p_name AND private.can_file(f.id_archivo));
$$;

-- New-file policies never allow direct client writes: bytes are sniffed by backend.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('clinic-assets','clinic-assets',false,5242880,ARRAY['image/png','image/jpeg']),
 ('clinic-files','clinic-files',false,10485760,ARRAY['application/pdf','image/png','image/jpeg']);
CREATE POLICY clinic_private_files_read ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id IN ('clinic-assets','clinic-files') AND private.storage_file_read(bucket_id,name)
);
-- Other existing bucket policies must never broaden these two buckets. Restrictive
-- policies compose with any permissive policies the project already has.
CREATE POLICY clinic_files_write_gate ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING(bucket_id NOT IN ('clinic-assets','clinic-files') OR (bucket_id IN ('clinic-assets','clinic-files') AND private.storage_file_read(bucket_id,name)))
 WITH CHECK(bucket_id NOT IN ('clinic-assets','clinic-files'));
CREATE POLICY clinic_files_anon_gate ON storage.objects AS RESTRICTIVE FOR ALL TO anon USING(bucket_id NOT IN ('clinic-assets','clinic-files')) WITH CHECK(bucket_id NOT IN ('clinic-assets','clinic-files'));
CREATE POLICY clinic_files_delete_gate ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id NOT IN ('clinic-assets','clinic-files'));

DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['auditoria_plataforma','ticket_soporte','ticket_respuesta','archivo_clinica'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
 END LOOP;
END $$;
CREATE POLICY clinic_file_metadata_read ON public.archivo_clinica FOR SELECT TO authenticated USING(private.can_file(id_archivo));
CREATE POLICY support_ticket_read ON public.ticket_soporte FOR SELECT TO authenticated USING(private.can_ticket(id_ticket));
CREATE POLICY support_response_read ON public.ticket_respuesta FOR SELECT TO authenticated USING(private.can_ticket(id_ticket));
CREATE POLICY platform_audit_read ON public.auditoria_plataforma FOR SELECT TO authenticated USING(private.is_superadmin(auth.uid()));

REVOKE ALL ON FUNCTION private.storage_file_read(text,text),private.platform_api(text,jsonb),public.vettrack_plataforma(text,jsonb),private.support_actor(),private.can_ticket(uuid),private.can_file(uuid),private.link_file(),private.consultation_next_date(),private.future_document_branding(),private.inv_api_phase6(text,jsonb),private.inv_api(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.storage_file_read(text,text),private.platform_api(text,jsonb),public.vettrack_plataforma(text,jsonb),private.can_ticket(uuid),private.can_file(uuid),private.inv_api(text,jsonb) TO authenticated;

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
   WHEN 'desparasitacion' THEN ARRAY['producto','dosis','peso','fecha','proxima_fecha','observaciones'] ELSE ARRAY['tipo','nombre','resultado','observaciones','fecha','archivo_url','archivo_adjunto'] END;
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
    values_sql:=values_sql||format(',($1->>%L)',key)||CASE WHEN key IN ('fecha','fecha_aplicacion','proxima_fecha','proxima_aplicacion') THEN '::date' WHEN key='peso' THEN '::numeric' WHEN key='archivo_adjunto' THEN '::uuid' ELSE '' END;
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

COMMIT;
