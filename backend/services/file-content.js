const {createHash}=require('node:crypto')
class FileValidationError extends Error{}
function imageDimensions(buffer,mime){
 if(mime==='image/png'){
  if(buffer.length<33||buffer.subarray(12,16).toString()!=='IHDR'||!buffer.includes(Buffer.from('IEND')))throw new FileValidationError('El PNG no está completo.')
  return [buffer.readUInt32BE(16),buffer.readUInt32BE(20)]
 }
 let position=2
 while(position+4<buffer.length){
  if(buffer[position++]!==255)continue
  let marker=buffer[position++];while(marker===255)marker=buffer[position++]
  if(marker===217||marker===218)break
  if(marker===0||marker===1||(marker>=208&&marker<=215))continue
  const size=buffer.readUInt16BE(position);if(size<2||position+size>buffer.length)break
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=7)return [buffer.readUInt16BE(position+5),buffer.readUInt16BE(position+3)]
  position+=size
 }
 throw new FileValidationError('El JPEG no contiene una imagen válida.')
}
function validateFile(buffer,{mime,tamano,categoria}){
 const maximum=categoria==='logo'?5242880:10485760
 if(!Buffer.isBuffer(buffer)||!buffer.length)throw new FileValidationError('Selecciona un archivo con contenido.')
 if(buffer.length>maximum)throw new FileValidationError(`El archivo supera ${categoria==='logo'?5:10} MB.`)
 if(buffer.length!==tamano)throw new FileValidationError('El tamaño recibido no coincide. Vuelve a seleccionar el archivo.')
 const actual=buffer.subarray(0,5).toString()==='%PDF-'?'application/pdf':buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':buffer[0]===255&&buffer[1]===216&&buffer[2]===255?'image/jpeg':null
 if(!actual||actual!==mime||(categoria==='logo'&&actual==='application/pdf'))throw new FileValidationError('El contenido debe ser PDF, PNG o JPG/JPEG y coincidir con el tipo seleccionado.')
 if(actual==='application/pdf'&&!buffer.subarray(-1024).includes(Buffer.from('%%EOF')))throw new FileValidationError('El PDF no está completo.')
 if(actual!=='application/pdf'){
  if(actual==='image/jpeg'&&(buffer.at(-2)!==255||buffer.at(-1)!==217))throw new FileValidationError('El JPEG no está completo.')
  const [width,height]=imageDimensions(buffer,actual);if(!width||!height||width>6000||height>6000||width*height>20000000)throw new FileValidationError('La imagen es demasiado grande. Usa una imagen de hasta 6000 píxeles por lado y 20 megapíxeles.')
 }
 return {mime:actual,sha256:createHash('sha256').update(buffer).digest('hex')}
}
module.exports={validateFile,FileValidationError}
