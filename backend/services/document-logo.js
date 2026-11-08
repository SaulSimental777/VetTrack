// Read only the immutable, tenant-authorized Storage reference frozen in the PDF.
// Never fetch arbitrary historical HTTPS URLs from the backend.
async function loadDocumentLogo(client,document){
 const id=document.contenido?.logo_archivo
 if(Number(document.contenido?.pdf_version)<2||!id||!client)return null
 try{
  const file=await client.rpc('vettrack_plataforma',{p_operacion:'archivo',p_datos:{id}})
  if(file.error||file.data?.categoria!=='logo'||file.data?.estado!=='listo')return null
  const result=await client.storage.from(file.data.bucket).download(file.data.ruta)
  if(result.error||!result.data)return null
  const buffer=Buffer.from(await result.data.arrayBuffer())
  return buffer.length<=5242880?buffer:null
 }catch{return null}
}
module.exports={loadDocumentLogo}
