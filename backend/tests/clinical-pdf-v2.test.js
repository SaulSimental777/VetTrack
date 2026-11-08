const {test}=require('node:test')
const assert=require('node:assert/strict')
const {generateClinicalPDF}=require('../services/clinical-pdf')
const {loadDocumentLogo}=require('../services/document-logo')
const {sample}=require('../scripts/validate-phase7-pdfs.cjs')

test('future documents render all four types without mutating their frozen snapshots',async()=>{
 for(const type of ['nota_consulta','plan_tratamiento','orden_recepcion','receta_simple']){
  const doc=sample(type,false,true),before=JSON.stringify(doc)
  const pdf=await generateClinicalPDF(doc,{logoBuffer:Buffer.from('unreadable historical image')})
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000)
  assert.equal(JSON.stringify(doc),before)
 }
})
test('future simple prescriptions retain Group I and professional-license rejection',async()=>{
 const doc=sample('receta_simple');doc.contenido.receta.detalles[0].grupo_prescripcion='I'
 assert.throws(()=>generateClinicalPDF(doc),/cuantificada autorizada/i)
 doc.contenido.receta.detalles[0].grupo_prescripcion='II';doc.contenido.contexto.medico.cedula_profesional=null
 assert.throws(()=>generateClinicalPDF(doc),/cédula profesional/)
})
test('historical PDFs never resolve a current or external logo',async()=>{
 const client={rpc(){throw Error('Historical document must not query branding')}}
 const doc=sample('nota_consulta');delete doc.contenido.pdf_version;delete doc.contenido.logo_archivo
 assert.equal(await loadDocumentLogo(client,doc),null)
 const pdf=await generateClinicalPDF(doc);assert.equal(pdf.subarray(0,5).toString(),'%PDF-')
})
test('PDF logo loading uses the snapshot UUID and the requesting JWT Storage client',async()=>{
 const doc=sample('nota_consulta');doc.contenido.logo_archivo='70000000-0000-4000-8000-000000000080'
 const calls=[],bytes=Buffer.from('stored image')
 const client={async rpc(op,args){calls.push([op,args]);return {data:{categoria:'logo',estado:'listo',bucket:'clinic-assets',ruta:'authorized/path.png'}}},storage:{from(bucket){assert.equal(bucket,'clinic-assets');return {async download(path){assert.equal(path,'authorized/path.png');return {data:new Blob([bytes])}}}}}}
 assert.deepEqual(await loadDocumentLogo(client,doc),bytes)
 assert.equal(calls[0][1].p_datos.id,doc.contenido.logo_archivo)
})
test('denied, missing or oversized historical logo falls back without blocking PDF generation',async()=>{
 const doc=sample('nota_consulta');doc.contenido.logo_archivo='70000000-0000-4000-8000-000000000080'
 for(const client of [{rpc:async()=>({error:{code:'P0002'}})},{rpc:async()=>{throw Error('unavailable')}},{rpc:async()=>({data:{categoria:'logo',estado:'listo',bucket:'clinic-assets',ruta:'authorized/path.png'}}),storage:{from:()=>({download:async()=>({data:new Blob([Buffer.alloc(5242881)])})})}}])assert.equal(await loadDocumentLogo(client,doc),null)
})
