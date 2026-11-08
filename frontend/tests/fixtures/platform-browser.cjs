// Runs inside Chrome; no production requests or credentials.
module.exports=function(roles){
 localStorage.clear()
 const nativeFetch=window.fetch.bind(window),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
 const initial=new URLSearchParams(location.search).get('as')||'admin',today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Tijuana',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 const state=window.__finalSmoke={role:initial,metadata:initial==='superadmin'?{super_admin:true}:{},requests:[],unknown:[],clinicState:'activo',logo:null,files:{},counter:800,opened:0,stockMoves:0,passwordChanges:0,
  settings:{nombre:'Clínica Norte',direccion:'Av. Clínica 123',telefono:'6641234567',correo:'norte@example.com',horario:'Lunes a viernes',descripcion:'Atención veterinaria',foto_veterinaria:null,valoracion:null},
  tenants:[{id_veterinaria:id(2),nombre:'Clínica Norte',estado:'activo',creado_en:'2026-11-07T18:00:00Z',telefono:'6641234567',correo:'norte@example.com',direccion:'Av. Clínica 123',logo_archivo:null,usuarios:3,administradores:1},{id_veterinaria:id(3),nombre:'Clínica Sur',estado:'suspendido',creado_en:null,telefono:null,correo:null,direccion:null,logo_archivo:null,usuarios:0,administradores:0}],
  admins:{[id(2)]:[{id:id(15),nombre:'Ana Administradora',correo:'ana@example.com',telefono:'6641000000',activo:true,ultimo_acceso:'2026-11-07T18:00:00Z'}],[id(3)]:[]},
  owners:[{id_dueno:id(40),nombre:'Jaziel',telefono:'6641000001',correo:'jaziel@example.com',direccion:'Domicilio'},{id_dueno:id(41),nombre:'Sin pacientes',telefono:null,correo:null,direccion:null}],
  patients:['Marvin','Luna','Sol','Estrella'].map((nombre,i)=>({id_mascota:id(50+i),nombre,id_dueno:id(40),especie:'Gato',raza:'Mestizo',sexo:'Hembra',fecha_nacimiento:'2020-01-01',peso_actual:4,observaciones:null,propietario:{id_dueno:id(40),nombre:'Jaziel'}})),
  tickets:[{id_ticket:id(200),id_veterinaria:id(2),id_usuario:id(22),rol:'recepcionista',asunto:'Problema con agenda',categoria:'operacion',descripcion:'Necesito revisar disponibilidad',prioridad:'normal',estado:'abierto',modulo:'Citas',creado_en:'2026-11-07T18:00:00Z',actualizado_en:'2026-11-07T18:00:00Z',cerrado_en:null,adjunto:null,veterinaria:'Clínica Norte',usuario:'Recepción'},{id_ticket:id(201),id_veterinaria:id(3),id_usuario:id(29),rol:'admin',asunto:'Acceso de clínica Sur',categoria:'acceso',descripcion:'Solicitud de reactivación',prioridad:'alta',estado:'en_revision',modulo:'Sesión',creado_en:'2026-11-07T18:00:00Z',actualizado_en:'2026-11-07T18:00:00Z',cerrado_en:null,adjunto:null,veterinaria:'Clínica Sur',usuario:'Admin Sur'}],replies:{[id(200)]:[],[id(201)]:[]},
  products:[{id_producto:id(100),nombre:'Insumo prueba',tipo_producto:'insumo',unidad:'unidad',stock_actual:10,stock_minimo:2,precio_venta:20,precio_compra:10,activo:true,grupo_prescripcion:'no_clasificado'}],
  purchases:['Pedido cancelable','Pedido no entregado','Pedido para recibir'].map((referencia,i)=>({id_compra:id(300+i),proveedor:'Proveedor Norte',referencia,estado:'pendiente',creado_en:'2026-11-07T18:00:00Z',documento_url:i===2?'https://example.com/historico.pdf':null,documento_archivo:null,detalles:[{id_detalle:id(400+i),id_producto:id(100),nombre:'Insumo prueba',cantidad:2,precio_unitario:10}]})),users:[],appointments:[],started:false,
 }
 const uid=()=>state.role==='medico'?id(21):state.role==='recepcionista'?id(22):state.role==='superadmin'?id(25):id(23)
 const doctor={id:id(21),nombre:'MVZ Norte',cedula_profesional:'12345678',activo:true,especialidades:[],horario_hoy:[{dia_semana:1,hora_inicio:'09:00',hora_fin:'17:00',activo:true}],proxima_cita:null}
 const service={id_servicio:id(30),nombre:'Consulta general',costo:450,duracion_minutos:30,activo:true,especialidades:[]}
 state.appointments=[['2025-01-01','programada'],[today,'programada'],['2025-01-02','en_consulta'],['2030-01-07','confirmada']].map(([day,estado],i)=>({id_cita:id(60+i),id_mascota:id(50),id_dueno:id(40),id_medico:id(21),paciente:'Marvin',propietario:'Jaziel',medico:doctor.nombre,fecha_inicio:day+'T18:00:00Z',fecha_fin:day+'T18:30:00Z',estado,motivo:'Revisión',servicios:[{id_servicio:id(30),nombre:service.nombre,precio_aplicado:450,duracion_aplicada:30}],subtotal:450}))
 const bundle={consulta:{id_consulta:id(70),id_cita:id(61),id_mascota:id(50),id_dueno:id(40),id_medico:id(21),estado:'en_curso',revision:1,fecha_inicio:today+'T18:00:00Z',motivo_consulta:'Revisión',proxima_cita:null},contexto:{clinica:{nombre:state.settings.nombre,direccion:state.settings.direccion,telefono:state.settings.telefono},paciente:{nombre:'Marvin',especie:'Gato',raza:'Mestizo',peso:4},propietario:{nombre:'Jaziel'},medico:{id:id(21),nombre:doctor.nombre,cedula_profesional:doctor.cedula_profesional}},diagnosticos:[],tratamientos:[],vacunas:[],desparasitaciones:[],estudios:[],receta:null,servicios:[{id_servicio:id(30),nombre:service.nombre,precio_aplicado:450,duracion_aplicada:30}],documentos:[]}
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}),denied=()=>json({error:'No tienes permiso para este recurso.'},403)
 const perms=()=>state.clinicState==='suspendido'?[]:roles[state.role]||[]
 const session=user=>{const b=v=>btoa(JSON.stringify(v)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');return {user,access_token:b({alg:'HS256',typ:'JWT'})+'.'+b({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})+'.fake',refresh_token:'fake',expires_in:3600,token_type:'bearer'}}
 const canTicket=t=>state.role==='superadmin'||(t.id_veterinaria===id(2)&&(state.role==='admin'||t.id_usuario===uid()))
 const fileMeta=f=>({id_archivo:f.id_archivo,nombre:f.nombre,mime:f.mime,tamano:f.tamano,estado:f.estado})
 window.open=()=>{state.opened++;return {location:{href:''},close(){}}}
 let current
 window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href),method=(init.method||input.method||'GET').toUpperCase(),binary=init.body instanceof Blob,body=typeof init.body==='string'?JSON.parse(init.body):{}
  if(url.hostname!=='vettrack-smoke.invalid'&&!url.pathname.startsWith('/api/')){if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('External requests disabled');return nativeFetch(input,init)}
  state.requests.push({path:url.pathname,query:url.search,method,body:binary?{binary:true,size:init.body.size}:body})
  if(url.pathname==='/auth/v1/token'){current={id:uid(),email:state.role+'@example.test',app_metadata:state.metadata,user_metadata:{},aud:'authenticated',role:'authenticated',created_at:new Date().toISOString()};return json(session(current))}
  if(url.pathname==='/auth/v1/user')return json(current)
  if(url.pathname==='/auth/v1/logout')return new Response(null,{status:204})
  if(url.pathname==='/api/sesion')return json({id:uid(),id_veterinaria:id(2),nombre:state.role==='medico'?doctor.nombre:state.role==='recepcionista'?'Recepción':'Admin Norte',rol:state.role,activo:true,nombre_veterinaria:state.settings.nombre,estado:state.clinicState,logo_archivo:state.logo,permisos:perms()})
  if(url.pathname==='/api/tenants'&&method==='POST'){
   const tid=id(++state.counter),tenant={id_veterinaria:tid,nombre:body.nombre,direccion:body.direccion,telefono:body.telefono,correo:body.adminEmail||null,estado:'activo',creado_en:new Date().toISOString(),usuarios:body.crearAdmin?1:0,administradores:body.crearAdmin?1:0,logo_archivo:null};state.tenants.push(tenant);state.admins[tid]=body.crearAdmin?[{id:id(++state.counter),nombre:body.adminNombre,correo:body.adminEmail,telefono:body.adminTelefono,activo:true,ultimo_acceso:null}]:[];return json({tenant},201)
  }
  if(url.pathname.startsWith('/api/plataforma/tenants/')){
   if(state.role!=='superadmin')return denied();const tid=url.pathname.split('/')[4],action=url.pathname.split('/').at(-1),list=state.admins[tid]||[]
   if(action==='crear'){list.push({id:id(++state.counter),nombre:body.nombre,correo:body.correo,telefono:body.telefono,activo:true,ultimo_acceso:null});state.admins[tid]=list;return json({message:'Creado'},201)}
   if(action==='estado'){list.find(a=>a.id===body.id).activo=body.activo;return json({})}
   if(action==='password'){state.passwordChanges++;return json({})}
  }
  if(url.pathname.startsWith('/api/plataforma/')){
   const op=url.pathname.split('/').at(-1),params=method==='GET'?Object.fromEntries(url.searchParams):body
   if(['global_dashboard','tenants','tenant','tenant_guardar','tenant_estado'].includes(op)&&state.role!=='superadmin')return denied()
   if(op==='mi-cuenta')return json({correo:current.email,superadmin:state.role==='superadmin'})
   if(op==='password'){state.passwordChanges++;return json({})}
   if(op==='global_dashboard')return json({activos:state.tenants.filter(t=>t.estado==='activo').length,suspendidos:state.tenants.filter(t=>t.estado==='suspendido').length,usuarios:3,administradores:1,recientes:1,tickets_abiertos:1,tickets_en_atencion:1})
   if(op==='tenants'){const list=state.tenants.filter(t=>(!params.q||t.nombre.toLowerCase().includes(params.q.toLowerCase()))&&(!params.estado||t.estado===params.estado));return json({filas:list.slice(Number(params.offset||0),Number(params.offset||0)+25),hay_mas:false,offset:Number(params.offset||0)})}
   if(op==='tenant'){const t=state.tenants.find(t=>t.id_veterinaria===params.id);return json({veterinaria:t,usuarios:(state.admins[t.id_veterinaria]||[]).length+(t.id_veterinaria===id(2)?2:0),pacientes:t.id_veterinaria===id(2)?4:0,por_rol:{admin:state.admins[t.id_veterinaria].length,medico:t.id_veterinaria===id(2)?1:0,recepcionista:t.id_veterinaria===id(2)?1:0},ultima_actividad:'2026-11-07T18:00:00Z',administradores:state.admins[t.id_veterinaria]})}
   if(op==='tenant_guardar'){Object.assign(state.tenants.find(t=>t.id_veterinaria===params.id),params);return json({guardado:true})}
   if(op==='tenant_estado'){const t=state.tenants.find(t=>t.id_veterinaria===params.id);t.estado=params.estado;return json({estado:t.estado})}
   if(op==='logo')return json({id_archivo:state.logo})
   if(op==='logo_guardar'){state.logo=params.id_archivo;return json({id_archivo:state.logo})}
   if(op==='tickets'){const list=state.tickets.filter(t=>canTicket(t)&&(!params.estado||t.estado===params.estado)&&(!params.prioridad||t.prioridad===params.prioridad)&&(!params.id_veterinaria||t.id_veterinaria===params.id_veterinaria));return json({filas:list,offset:0,hay_mas:false})}
   if(op==='ticket_crear'){const t={...params,id_ticket:id(++state.counter),id_veterinaria:id(2),id_usuario:uid(),rol:state.role,estado:'abierto',creado_en:new Date().toISOString(),actualizado_en:new Date().toISOString(),cerrado_en:null,veterinaria:state.settings.nombre,usuario:state.role};state.tickets.push(t);state.replies[t.id_ticket]=[];return json(t)}
   if(['ticket','ticket_responder','ticket_estado'].includes(op)){const t=state.tickets.find(t=>t.id_ticket===params.id);if(!t||!canTicket(t))return denied();if(op==='ticket_responder'){state.replies[t.id_ticket].push({id_respuesta:id(++state.counter),mensaje:params.mensaje,adjunto:params.adjunto,es_superadmin:state.role==='superadmin',creado_en:new Date().toISOString()})}if(op==='ticket_estado'){if(state.role!=='superadmin')return denied();t.estado=params.estado;t.cerrado_en=params.estado==='cerrado'?new Date().toISOString():null;state.replies[t.id_ticket].push({id_respuesta:id(++state.counter),mensaje:'Estado actualizado: '+params.estado,es_superadmin:true,creado_en:new Date().toISOString()})}return json({ticket:t,respuestas:state.replies[t.id_ticket]})}
   if(op==='propietario'){const owner=state.owners.find(o=>o.id_dueno===params.id);return json({propietario:owner,pacientes:state.patients.filter(p=>p.id_dueno===owner.id_dueno),total_pacientes:state.patients.filter(p=>p.id_dueno===owner.id_dueno).length,hay_mas:false})}
   if(op==='citas_explorar'){const rows=state.appointments.filter(a=>params.vista!=='pendientes'||['programada','confirmada','en_espera','en_consulta'].includes(a.estado));return json({filas:rows.slice(Number(params.offset||0),Number(params.offset||0)+50),hay_mas:rows.length>50})}
  }
  if(url.pathname==='/api/archivos'&&method==='POST'){const fid=id(++state.counter),f={...body,id_archivo:fid,estado:'pendiente',tenant:id(2),bytes:null};state.files[fid]=f;return json(fileMeta(f),201)}
  if(url.pathname.startsWith('/api/archivos/')){const fid=url.pathname.split('/')[3],f=state.files[fid];if(!f)return json({error:'Archivo no disponible'},404);if(method==='DELETE'){delete state.files[fid];return new Response(null,{status:204})}if(binary){f.bytes=Array.from(new Uint8Array(await init.body.arrayBuffer()));f.estado='listo';return json(fileMeta(f))}if(url.pathname.endsWith('/info'))return json(fileMeta(f));return new Response(new Uint8Array(f.bytes||[]),{headers:{'Content-Type':f.mime}})}
  if(url.pathname==='/api/duenos'&&method==='GET'){
   if(url.searchParams.get('resumen')==='1'){const list=state.owners.filter(o=>!url.searchParams.get('q')||o.nombre.toLowerCase().includes(url.searchParams.get('q').toLowerCase())||state.patients.some(p=>p.id_dueno===o.id_dueno&&p.nombre.toLowerCase().startsWith(url.searchParams.get('q').toLowerCase()))).map(o=>({...o,total_pacientes:state.patients.filter(p=>p.id_dueno===o.id_dueno).length,pacientes:state.patients.filter(p=>p.id_dueno===o.id_dueno).slice(0,2)}));return json({filas:list,hay_mas:false})}return json(state.owners)
  }
  if(url.pathname==='/api/duenos'&&method==='POST'){const o={...body,id_dueno:id(++state.counter)};state.owners.push(o);return json(o,201)}
  if(url.pathname==='/api/pacientes/propietarios')return json(state.owners)
  if(url.pathname==='/api/pacientes'&&method==='GET')return json(state.patients)
  if(url.pathname==='/api/pacientes'&&method==='POST'){const p={...body,id_mascota:id(++state.counter),propietario:state.owners.find(o=>o.id_dueno===body.id_dueno)};state.patients.push(p);return json(p,201)}
  if(url.pathname.startsWith('/api/pacientes/')&&method==='PUT'){Object.assign(state.patients.find(p=>p.id_mascota===url.pathname.split('/').at(-1)),body);return json({})}
  if(url.pathname==='/api/citas/selectores')return json({propietarios:state.owners,pacientes:state.patients})
  if(url.pathname==='/api/citas')return json(state.appointments.filter(a=>(!url.searchParams.get('inicio')||a.fecha_inicio>=url.searchParams.get('inicio'))&&(!url.searchParams.get('fin')||a.fecha_inicio<url.searchParams.get('fin'))))
  if(url.pathname==='/api/medicos')return json([doctor]);if(url.pathname.endsWith('/horarios'))return json(doctor.horario_hoy);if(url.pathname.endsWith('/bloqueos'))return json([])
  if(url.pathname==='/api/servicios')return json([service]);if(url.pathname==='/api/especialidades')return json([])
  if(url.pathname==='/api/usuarios')return json(state.users)
  if(url.pathname==='/api/clinica/consultas')return json(state.started?[{...bundle.consulta,paciente:'Marvin',propietario:'Jaziel',medico:doctor.nombre}]:[])
  if(url.pathname.endsWith('/iniciar')){state.started=true;return json(bundle)}
  if(url.pathname==='/api/clinica/consultas/'+id(70)&&method==='GET')return json(bundle)
  if(url.pathname==='/api/clinica/consultas/'+id(70)&&method==='PUT'){Object.assign(bundle.consulta,body);return json(bundle)}
  if(url.pathname.includes('/registros/estudio')){bundle.estudios.push({...body,id_estudio:id(++state.counter)});return json(bundle)}
  if(url.pathname.endsWith('/finalizar')){bundle.consulta.estado='finalizada';return json(bundle)}
  if(url.pathname.endsWith('/expediente'))return json({paciente:bundle.contexto.paciente,entradas:bundle.estudios.map(s=>({id:s.id_estudio,tipo:'estudio',fecha:new Date().toISOString(),id_consulta:id(70),descripcion:s.nombre,datos:s})),hay_mas:false})
  if(url.pathname==='/api/clinica/ordenes')return json([])
  if(url.pathname.startsWith('/api/inventario/')){const op=url.pathname.split('/').at(-1)
   if(op==='productos'||op==='medicamentos')return json(state.products)
   if(op==='proveedores')return json([{id_proveedor:id(110),nombre:'Proveedor Norte',activo:true}])
   if(op==='compras')return json(state.purchases)
   if(op==='recepciones')return json(state.purchases.filter(p=>p.estado==='recibida').map(p=>({...p,recibido_en:p.recibido_en,detalles:p.detalles.map(d=>({...d,numero_lote:'LOTE-7',fecha_caducidad:'2099-01-01'}))})))
   if(op==='compra_cerrar'){const p=state.purchases.find(p=>p.id_compra===body.id);p.estado=body.estado;p.motivo_cierre=body.motivo;p.cerrado_en=new Date().toISOString();return json(p)}
   if(op==='compra_recibir'){const p=state.purchases.find(p=>p.id_compra===body.id);if(p.estado==='pendiente'){p.estado='recibida';p.recibido_en=new Date().toISOString();p.documento_archivo=body.documento_archivo;p.documento_url=body.documento_url;state.products[0].stock_actual+=2;state.stockMoves++}return json(p)}
   return json([])
  }
  if(url.pathname==='/api/operacion/configuracion')return json(state.settings)
  if(url.pathname==='/api/operacion/configuracion_guardar'){Object.assign(state.settings,body);return json({guardado:true})}
  if(url.pathname==='/api/operacion/dashboard')return json({fecha:today,metricas:[{titulo:'Citas del día',valor:1,ruta:'/citas'}],citas:[]})
  if(url.pathname==='/api/operacion/horarios_medicos')return json([doctor])
  if(url.pathname==='/api/operacion/pagos')return json({pagos:[],pendientes:[]})
  state.unknown.push(method+' '+url.pathname);throw Error('Missing Phase 7 mock '+url.pathname)
 }
}
