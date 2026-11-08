const {createUserClient,supabaseAdmin}=require('../config/supabase')
const {validarCampos,validarId,texto,entero,responderError,fallar}=require('./operacion.shared')
const {friendlyRPC}=require('./platform.controller')
const {validateFile,FileValidationError}=require('../services/file-content')
const clientFor=req=>createUserClient(req.accessToken)
const publicFile=f=>({id_archivo:f.id_archivo,nombre:f.nombre,mime:f.mime,tamano:f.tamano,estado:f.estado})
const resolve=async(req,client,op='archivo')=>friendlyRPC(await client.rpc('vettrack_plataforma',{p_operacion:op,p_datos:{id:validarId(req.params.id)}}))
const prepare=async(req,res)=>{
 try{
  validarCampos(req.body,['categoria','contexto_id','nombre','mime','tamano']);const b=req.body
  if(!['logo','compras','estudios','soporte'].includes(b.categoria)||!['application/pdf','image/png','image/jpeg'].includes(b.mime)||(b.categoria==='logo'&&b.mime==='application/pdf'))fallar(400,'Selecciona un formato permitido: PDF, PNG o JPG/JPEG; el logo debe ser imagen.')
  const data={categoria:b.categoria,nombre:texto(b.nombre,'El nombre del archivo',200,true),mime:b.mime,tamano:entero(b.tamano,1,b.categoria==='logo'?5242880:10485760,'El tamaño del archivo')}
  if(b.contexto_id!=null)data.contexto_id=validarId(b.contexto_id)
  const file=friendlyRPC(await clientFor(req).rpc('vettrack_plataforma',{p_operacion:'archivo_preparar',p_datos:data}))
  return res.status(201).json(publicFile(file))
 }catch(error){return responderError(res,error)}
}
const upload=async(req,res)=>{
 try{
  const file=await resolve(req,clientFor(req));if(file.creado_por!==req.user.id||!['pendiente','listo'].includes(file.estado))fallar(403,'Solo puedes cargar el archivo que acabas de seleccionar.')
  let verified;try{verified=validateFile(req.body,file)}catch(error){if(error instanceof FileValidationError)fallar(400,error.message);throw error}
  if(req.get('Content-Type')?.split(';')[0]!==verified.mime)fallar(400,'El tipo del archivo recibido no coincide con su contenido.')
  if(file.estado==='listo'){if(file.huella_sha256!==verified.sha256)fallar(409,'Este archivo ya se cargó. Selecciona Reemplazar para subir otra versión.');return res.json(publicFile(file))}
  const storage=supabaseAdmin.storage.from(file.bucket)
  const sent=await storage.upload(file.ruta,req.body,{contentType:verified.mime,upsert:false,cacheControl:'3600'})
  if(sent.error){
   // Recover an interrupted upload only when the immutable bytes are identical.
   const prior=await storage.download(file.ruta);if(prior.error||!prior.data)fallar(502,'No se pudo cargar el archivo. Puedes volver a intentar.')
   const buffer=Buffer.from(await prior.data.arrayBuffer());if(validateFile(buffer,file).sha256!==verified.sha256)fallar(409,'Ya existe otro contenido para esta selección. Reemplaza el archivo.')
  }
  const saved=await supabaseAdmin.from('archivo_clinica').update({estado:'listo',huella_sha256:verified.sha256}).eq('id_archivo',file.id_archivo).eq('creado_por',req.user.id).eq('estado','pendiente').select('id_archivo,nombre,mime,tamano,estado').single()
  if(saved.error||!saved.data)fallar(502,'El archivo se recibió pero no se pudo confirmar. Vuelve a intentar para completar la carga.')
  return res.json(publicFile(saved.data))
 }catch(error){return responderError(res,error)}
}
const view=async(req,res)=>{
 try{
  const client=clientFor(req),file=await resolve(req,client);if(file.estado!=='listo')fallar(404,'El archivo aún no está disponible.')
  const result=await client.storage.from(file.bucket).download(file.ruta);if(result.error||!result.data)fallar(404,'No se pudo abrir el archivo. Intenta de nuevo.')
  const bytes=Buffer.from(await result.data.arrayBuffer())
  res.set('Content-Type',file.mime).set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff')
  res.set('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.nombre)}`).set('Content-Security-Policy',"sandbox; default-src 'none'")
  return res.send(bytes)
 }catch(error){return responderError(res,error)}
}
const info=async(req,res)=>{
 try{const file=await resolve(req,clientFor(req));if(file.estado!=='listo')fallar(404,'El archivo aún no está disponible.');return res.json(publicFile(file))}
 catch(error){return responderError(res,error)}
}
const remove=async(req,res)=>{
 try{
  const file=await resolve(req,clientFor(req),'archivo_borrar')
  const result=await supabaseAdmin.storage.from(file.bucket).remove([file.ruta]);if(result.error)fallar(502,'No se pudo quitar el archivo. Puedes volver a intentar.')
  const deleted=await supabaseAdmin.from('archivo_clinica').delete().eq('id_archivo',file.id_archivo).eq('estado','eliminando');if(deleted.error)fallar(502,'El archivo se quitó pero su registro requiere revisión.')
  return res.status(204).end()
 }catch(error){return responderError(res,error)}
}
module.exports={prepare,upload,view,remove,info}
