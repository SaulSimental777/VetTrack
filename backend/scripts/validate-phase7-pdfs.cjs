// Optional local visual validation tools live in a temporary folder, not app deps.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {pathToFileURL}=require('node:url')
const {generateClinicalPDF}=require('../services/clinical-pdf')
let output
const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function sample(type,long=false,sparse=false){
 const notes=long?'Seguimiento clínico documentado. Exploración y evolución del paciente registradas por su médico veterinario. '.repeat(100):'Paciente alerta. Se explica el plan de seguimiento al propietario.'
 const context={clinica:{nombre:'Veterinaria Norte',direccion:'Av. Clínica 123, Tijuana, B.C.',telefono:'664 123 4567'},paciente:{nombre:'Marvin',especie:'Gato',raza:sparse?null:'Mestizo',sexo:sparse?null:'Macho',peso:4.2},propietario:{nombre:'Jaziel'},medico:{nombre:'MVZ Ana Veterinaria',cedula_profesional:'12345678'}}
 const data={pdf_version:2,contexto:context,consulta:{fecha_inicio:'2026-11-08T18:00:00Z',fecha_fin:'2026-11-08T18:40:00Z',motivo_consulta:'Revisión y seguimiento',anamnesis:sparse?null:notes,exploracion_fisica:sparse?null:'Estado general estable. '+(long?notes:''),peso:4.2,temperatura:sparse?null:38.2,indicaciones:notes,proxima_cita:'2026-11-15'},
  diagnosticos:sparse?[]:[{tipo:'definitivo',descripcion:'Hallazgo documentado por el médico.'}],tratamientos:[{descripcion:'Plan de seguimiento individual',indicaciones:notes,duracion:'Según evolución',observaciones:long?notes:null}],
  vacunas:sparse?[]:[{nombre:'Vacuna de prueba',fecha_aplicacion:'2026-11-08',proxima_aplicacion:'2027-11-08',lote:'VAC-7'}],desparasitaciones:[],estudios:sparse?[]:[{nombre:'Estudio de seguimiento',tipo:'laboratorio',fecha:'2026-11-08',resultado:long?notes:'Resultado documentado',archivo_url:'https://example.com/legacy.pdf',archivo_adjunto:id(80)}],
  servicios:[{nombre:'Consulta general',precio_aplicado:450,duracion_aplicada:30}],receta:{indicaciones:notes,detalles:Array.from({length:long?12:1},(_,i)=>({nombre_medicamento:`Medicamento de prueba ${i+1}`,principio_activo:sparse?null:'Principio activo',concentracion:sparse?null:'Según presentación',presentacion:sparse?null:'Frasco',dosis:'Dosis indicada por el MVZ',frecuencia:'Frecuencia indicada',duracion:'Duración indicada',via_administracion:'Vía indicada',cantidad:1,grupo_prescripcion:'II',indicaciones:long?notes.slice(0,1200):null}))}}
 if(type==='orden_recepcion'){delete data.contexto;Object.assign(data,context,{productos:[{nombre:'Producto de entrega',cantidad:2}],observaciones_administrativas:long?notes:'Entregar indicaciones al propietario.',proxima_cita:'2026-11-15'});delete data.diagnosticos;delete data.tratamientos;delete data.receta;delete data.vacunas;delete data.estudios;delete data.consulta.anamnesis;delete data.consulta.exploracion_fisica;delete data.consulta.indicaciones}
 return {id_documento:id(1),id_consulta:id(2),revision:2,tipo:type,creado_en:'2026-11-08T18:40:00Z',contenido:data}
}
async function main(){
 output=fs.mkdtempSync(path.join(os.tmpdir(),'vettrack-phase7-pdfs-'))
 const tools=process.env.PDF_TOOLS;if(!tools)throw Error('Set PDF_TOOLS to a temporary install containing pdfjs-dist and @napi-rs/canvas')
 const canvas=require(path.join(tools,'node_modules/@napi-rs/canvas'));Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D})
 const pdfjs=await import(pathToFileURL(path.join(tools,'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href)
 class CanvasFactory{getNoAlphaContext(c){return c.getContext("2d",{alpha:false})}create(width,height){const c=canvas.createCanvas(width,height);return {canvas:c,context:c.getContext('2d')}}reset(target,width,height){target.canvas.width=width;target.canvas.height=height}destroy(target){target.canvas.width=0;target.canvas.height=0;target.canvas=null;target.context=null}}
 const logo=fs.readFileSync(path.resolve(__dirname,'../../frontend/src/assets/hero.png'))
 const results=[]
 for(const type of ['nota_consulta','plan_tratamiento','orden_recepcion','receta_simple'])for(const variant of ['corto_sin_logo','corto_con_logo','largo_con_logo','pocos_campos']){
  const document=sample(type,variant==='largo_con_logo',variant==='pocos_campos'),frozen=JSON.stringify(document)
  const bytes=await generateClinicalPDF(document,{logoBuffer:variant.includes('con_logo')?logo:null});assert.equal(JSON.stringify(document),frozen,'render never alters snapshot')
  const name=type+'_'+variant;fs.writeFileSync(path.join(output,name+'.pdf'),bytes)
  const loaded=await pdfjs.getDocument({data:new Uint8Array(bytes),CanvasFactory,standardFontDataUrl:pathToFileURL(path.join(tools,'node_modules/pdfjs-dist/standard_fonts')).href+'/',isEvalSupported:false}).promise
  const pages=[]
  for(let index=1;index<=loaded.numPages;index++){
   const page=await loaded.getPage(index),viewport=page.getViewport({scale:1.3}),target=canvas.createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
   await page.render({canvasContext:target.getContext('2d'),viewport}).promise
   fs.writeFileSync(path.join(output,`${name}_p${index}.png`),target.toBuffer('image/png'))
   const items=(await page.getTextContent()).items.filter(i=>i.str?.trim()),text=items.map(i=>i.str).join('\n')
   assert.ok(items.length>=5,'no empty page');assert.ok(text.includes(`Página ${index}/${loaded.numPages}`),'page footer');assert.ok(!text.includes('No registrado'),'optional blanks omitted');assert.ok(!text.includes(id(1)),'UUID remains in metadata');assert.ok(!text.includes('archivo_adjunto'),'no raw file identifiers')
   for(const item of items){assert.ok(item.transform[4]>=40&&item.transform[4]+item.width<=573,'text stays within page width: '+item.str);assert.ok(item.transform[5]>18&&item.transform[5]<770,'text stays within page height')}
   if(text.includes('Firma del MVZ')){assert.equal(index,loaded.numPages);assert.ok(items.filter(i=>!/VetTrack|Página|Veterinaria Norte|MVZ Ana Veterinaria|Cédula profesional|Firma del MVZ|Nota de Consulta|Plan de Tratamiento|Orden de Cierre|Receta Médica/.test(i.str)).length>=2,'signature shares page with clinical content')}
   pages.push({page:index,items:items.length,signature:text.includes('Firma del MVZ')});fs.writeFileSync(path.join(output,`${name}_p${index}.txt`),text)
  }
  assert.equal(pages.filter(p=>p.signature).length,1);if(variant==='pocos_campos')assert.equal(loaded.numPages,1,'few-field documents fit one page');else if(variant!=='largo_con_logo')assert.ok(loaded.numPages<=2,'all-section short documents stay compact')
  results.push({name,pages:loaded.numPages,bytes:bytes.length});await loaded.cleanup()
 }
 fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({output,cases:results},null,2))
}
if(require.main===module)main().catch(error=>{console.error('PDF output: '+output);console.error(error);process.exitCode=1})
module.exports={sample}
