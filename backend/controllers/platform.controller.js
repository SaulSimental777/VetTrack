const { createUserClient, supabaseAdmin } = require('../config/supabase')
const { validarCampos, validarId, texto, booleano, fecha, entero, datoRPC, responderError, fallar } = require('./operacion.shared')
const { randomUUID } = require('node:crypto')
const definitions = {
 global_dashboard: [], tenants: ['q','estado','offset'], tenant: ['id'], tenant_guardar: ['id','nombre','direccion','telefono','correo'], tenant_estado: ['id','estado','motivo'],
 tickets: ['id_veterinaria','estado','prioridad','offset'], ticket: ['id'], ticket_crear: ['asunto','categoria','descripcion','prioridad','modulo','adjunto'], ticket_responder: ['id','mensaje','adjunto'], ticket_estado: ['id','estado'],
 sesion_plataforma: [], logo: [], logo_guardar: ['id_archivo'], propietarios_resumen: ['q','offset'], propietario: ['id','offset'], citas_explorar: ['vista','fecha','medico','estado','q','offset'],
}
const reads = ['global_dashboard','tenants','tenant','tickets','ticket','sesion_plataforma','logo','propietarios_resumen','propietario','citas_explorar']
const globals = ['global_dashboard','tenants','tenant','tenant_guardar','tenant_estado','ticket_estado']
const strongPassword = value => typeof value === 'string' && value.length>=8 && value.length<=128 && /\p{Lu}/u.test(value) && /\p{Ll}/u.test(value) && /\p{Nd}/u.test(value)
const email = value => typeof value === 'string' && value.length<=100 && /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(value)
const requireGlobal = req => { if(req.user?.app_metadata?.super_admin!==true) fallar(403,'Esta operación requiere Superadmin.') }
const clientFor = req => req.supabase || createUserClient(req.accessToken)
const friendlyRPC = result => {
 const known = {
  'Debe conservarse un administrador activo':'Crea o reactiva otro administrador antes de desactivar esta cuenta.',
  'El ticket está cerrado':'El ticket está cerrado. Crea uno nuevo si necesitas más ayuda.',
  'El archivo conserva referencias históricas':'El archivo se conserva porque forma parte de un registro o documento histórico.',
  'La próxima cita no puede ser anterior a la consulta':'La próxima cita sugerida no puede ser anterior a la fecha de consulta.',
 }
 if(result.error && known[result.error.message]) fallar(result.error.code==='22023'?400:409,known[result.error.message])
 return datoRPC(result)
}
const execute = async (req,res) => {
 try {
  const op=req.params.operacion
  if(!Object.hasOwn(definitions,op)) fallar(404,'Operación no disponible.')
  if(globals.includes(op)) requireGlobal(req)
  if(req.method==='GET'&&!reads.includes(op)) fallar(405,'Esta operación requiere POST.')
  const source=(req.method==='GET'?req.query:req.body)||{};validarCampos(source,definitions[op]);const data={}
  for(const [key,value] of Object.entries(source)){
   if(key==='id'||key.startsWith('id_')||['adjunto','medico'].includes(key)) data[key]=value==null&&['adjunto','id_archivo'].includes(key)?null:validarId(value)
   else if(key==='offset') data[key]=entero(typeof value==='string'&&/^\d+$/.test(value)?Number(value):value,0,100000,'La página')
   else if(key==='fecha') data[key]=fecha(value)
   else data[key]=texto(value,key,{asunto:200,descripcion:10000,mensaje:10000,nombre:150,telefono:20,correo:100,modulo:150,q:150}[key]||2000,['asunto','descripcion','mensaje','nombre'].includes(key))
  }
  if(['tenant','tenant_guardar','tenant_estado','ticket','ticket_responder','ticket_estado','propietario'].includes(op)&&!data.id) fallar(400,'Selecciona un registro.')
  if(data.correo&&!email(data.correo))fallar(400,'Ingresa un correo completo, como nombre@veterinaria.com.')
  if(op==='ticket_crear'&&(!data.asunto||!data.descripcion||!['acceso','operacion','archivos','otro'].includes(data.categoria)))fallar(400,'Completa asunto, categoría y descripción.')
  if(op==='ticket_responder'&&!data.mensaje)fallar(400,'Escribe una respuesta.')
  if(data.prioridad&&!['baja','normal','alta'].includes(data.prioridad))fallar(400,'Selecciona una prioridad válida.')
  if(op==='ticket_estado'&&!['abierto','en_revision','en_proceso','resuelto','cerrado'].includes(data.estado))fallar(400,'Selecciona un estado válido.')
  if(op==='tenant_estado'&&(!['activo','suspendido'].includes(data.estado)||(data.estado==='suspendido'&&!data.motivo)))fallar(400,'Selecciona el estado e indica el motivo de suspensión.')
  if(op==='citas_explorar'&&!['hoy','pendientes','todas'].includes(data.vista))fallar(400,'Selecciona Hoy, Pendientes o Todas.')
  const client=clientFor(req)
  const permission={propietarios_resumen:'propietarios.ver',propietario:'propietarios.ver',citas_explorar:'citas.ver',logo_guardar:'configuracion.editar'}[op]
  if(permission){const effective=datoRPC(await client.rpc('get_my_permissions'));if(!Array.isArray(effective)||!effective.includes(permission))fallar(403,'No tienes permiso para esta operación.')}
  return res.json(friendlyRPC(await client.rpc('vettrack_plataforma',{p_operacion:op,p_datos:data})))
 }catch(error){return responderError(res,error)}
}
const account = (req,res) => res.json({id:req.user.id,correo:req.user.email||null,superadmin:req.user.app_metadata?.super_admin===true})
const ownPassword = async (req,res) => {
 try{requireGlobal(req);validarCampos(req.body,['password']);if(!strongPassword(req.body.password))fallar(400,'Mínimo 8 caracteres, con mayúscula, minúscula y número.')
  const result=await supabaseAdmin.auth.admin.updateUserById(req.user.id,{password:req.body.password});if(result.error)fallar(502,'No se pudo actualizar la contraseña. Intenta de nuevo.')
  return res.json({message:'Contraseña actualizada.'})
 }catch(error){return responderError(res,error)}
}
const administrator = async (req,res) => {
 try{
  requireGlobal(req);const op=req.params.accion;const tenant=validarId(req.params.tenant);const client=clientFor(req)
  if(op==='crear'){
   validarCampos(req.body,['nombre','correo','password','telefono']);const name=texto(req.body.nombre,'El nombre',100,true),phone=texto(req.body.telefono,'El teléfono',20)
   if(!email(req.body.correo)||!strongPassword(req.body.password))fallar(400,'Revisa el correo y la contraseña: mínimo 8 caracteres, mayúscula, minúscula y número.')
   friendlyRPC(await client.rpc('vettrack_plataforma',{p_operacion:'tenant',p_datos:{id:tenant}}))
   const id=randomUUID();let authCreated=false
   try{
    const created=await supabaseAdmin.auth.admin.createUser({id,email:req.body.correo.trim().toLowerCase(),password:req.body.password,email_confirm:true})
    if(created.error){if(['email_exists','user_already_exists'].includes(created.error.code))fallar(409,'El correo ya pertenece a una cuenta.');fallar(502,'No se pudo crear la cuenta de administrador.')}
    authCreated=true
    if(created.data?.user?.id!==id)fallar(502,'No se pudo confirmar la identidad de la cuenta nueva.')
    const saved=await supabaseAdmin.from('perfilusuario').upsert({id,nombre:name,telefono:phone,rol:'admin',activo:true,id_veterinaria:tenant},{onConflict:'id'})
    if(saved.error)fallar(502,'No se pudo vincular el administrador con la veterinaria.')
    return res.status(201).json({id,nombre:name,correo:req.body.correo.trim().toLowerCase(),activo:true})
   }catch(error){
    // A server-generated ID bounds compensation even if Auth's response was lost.
    try{const cleanup=await supabaseAdmin.auth.admin.deleteUser(id);if(cleanup.error&&cleanup.error.status!==404)throw Error('cleanup')}
    catch{return res.status(502).json({error:authCreated?'La cuenta nueva requiere revisión para completar su vínculo.':'No se pudo confirmar el resultado del alta. Revisa antes de repetir.',cleanupPending:true})}
    throw error
   }
  }
  if(!['estado','password'].includes(op))fallar(404,'Acción no disponible.')
  validarCampos(req.body,op==='estado'?['id','activo']:['id','password']);const id=validarId(req.body.id)
  const target=friendlyRPC(await client.rpc('vettrack_plataforma',{p_operacion:'admin_objetivo',p_datos:{id_veterinaria:tenant,id}}))
  const auth=await supabaseAdmin.auth.admin.getUserById(target.id)
  if(auth.error||!auth.data?.user)fallar(502,'No se pudo comprobar la cuenta del administrador.')
  if(auth.data.user.app_metadata?.super_admin===true)fallar(403,'La cuenta global se administra por separado.')
  if(op==='password'){
   if(!strongPassword(req.body.password))fallar(400,'Mínimo 8 caracteres, con mayúscula, minúscula y número.')
   const changed=await supabaseAdmin.auth.admin.updateUserById(id,{password:req.body.password});if(changed.error)fallar(502,'No se pudo restablecer el acceso.')
   return res.json({message:'Contraseña del administrador actualizada.'})
  }
  const active=booleano(req.body.activo)
  if(!active){friendlyRPC(await client.rpc('vettrack_plataforma',{p_operacion:'admin_estado',p_datos:{id_veterinaria:tenant,id,activo:false}}))
   const banned=await supabaseAdmin.auth.admin.updateUserById(id,{ban_duration:'876000h'});if(banned.error)return res.status(502).json({error:'El perfil quedó inactivo; el bloqueo de Auth requiere revisión.',syncPending:true})
  }else{
   const unbanned=await supabaseAdmin.auth.admin.updateUserById(id,{ban_duration:'none'});if(unbanned.error)fallar(502,'No se pudo reactivar el acceso.')
   try{friendlyRPC(await client.rpc('vettrack_plataforma',{p_operacion:'admin_estado',p_datos:{id_veterinaria:tenant,id,activo:true}}))}
   catch(error){if(!target.activo){const restored=await supabaseAdmin.auth.admin.updateUserById(id,{ban_duration:'876000h'});if(restored.error)return res.status(502).json({error:'El perfil continúa inactivo; revisa la sincronización de Auth.',syncPending:true})}throw error}
  }
  return res.json({id,activo:active,message:active?'Administrador reactivado.':'Administrador desactivado.'})
 }catch(error){return responderError(res,error)}
}
module.exports={execute,account,ownPassword,administrator,friendlyRPC,strongPassword,email}
