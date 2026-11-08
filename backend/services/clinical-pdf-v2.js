const PDFDocument=require('pdfkit')
const fs=require('node:fs')
const {titles,validatePrescription}=require('./clinical-pdf-legacy')
const present=value=>value!==null&&value!==undefined&&String(value).trim()!==''
const money=value=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(value)||0)
const date=value=>{
 if(!value)return ''
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('/')
 return new Intl.DateTimeFormat('es-MX',{timeZone:'America/Tijuana',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
}
function sectionsFor(document){
 const data=document.contenido,c=data.consulta||{},sections=[]
 const add=(title,entries)=>{const rows=entries.filter(e=>present(e.value));if(rows.length)sections.push({title,entries:rows})}
 const fields=(object,labels)=>Object.entries(labels).map(([key,label])=>({label,value:object[key]}))
 if(document.tipo==='nota_consulta'){
  add('CONSULTA Y EXPLORACIÓN',fields(c,{motivo_consulta:'Motivo',anamnesis:'Anamnesis',exploracion_fisica:'Exploración física',temperatura:'Temperatura (°C)',frecuencia_cardiaca:'Frecuencia cardiaca',frecuencia_respiratoria:'Frecuencia respiratoria',mucosas:'Mucosas',trc:'TRC',observaciones:'Observaciones',pronostico:'Pronóstico'}))
  add('DIAGNÓSTICOS',(data.diagnosticos||[]).map(d=>({label:d.tipo==='definitivo'?'Definitivo':'Presuntivo',value:d.descripcion})))
  add('VACUNACIÓN',(data.vacunas||[]).flatMap(v=>fields({...v,fecha_aplicacion:date(v.fecha_aplicacion),proxima_aplicacion:date(v.proxima_aplicacion)},{nombre:'Vacuna',laboratorio:'Laboratorio',lote:'Lote',fecha_aplicacion:'Aplicación',proxima_aplicacion:'Próxima aplicación',observaciones:'Observaciones'})))
  add('DESPARASITACIÓN',(data.desparasitaciones||[]).flatMap(v=>fields({...v,fecha:date(v.fecha),proxima_fecha:date(v.proxima_fecha)},{producto:'Producto',dosis:'Dosis',peso:'Peso (kg)',fecha:'Fecha',proxima_fecha:'Próxima aplicación',observaciones:'Observaciones'})))
  add('ESTUDIOS',(data.estudios||[]).flatMap(v=>fields({...v,fecha:date(v.fecha)},{nombre:'Estudio',tipo:'Tipo',fecha:'Fecha',resultado:'Resultado',observaciones:'Observaciones'})))
 }
 if(['nota_consulta','plan_tratamiento'].includes(document.tipo)){
  add('TRATAMIENTOS',(data.tratamientos||[]).flatMap((v,i)=>fields(v,{descripcion:`${i+1}. Tratamiento`,indicaciones:'Indicaciones',duracion:'Duración',observaciones:'Observaciones'})))
 }
 if(document.tipo==='receta_simple'){
  add('RECETA',data.receta.detalles.flatMap((v,i)=>[{label:`${i+1}. Medicamento`,value:v.nombre_medicamento},...fields(v,{principio_activo:'Principio activo',concentracion:'Concentración',presentacion:'Presentación',dosis:'Dosis',frecuencia:'Frecuencia',duracion:'Duración',via_administracion:'Vía de administración',cantidad:'Cantidad',grupo_prescripcion:'Grupo de prescripción',tiempo_retiro:'Tiempo de retiro',indicaciones:'Indicaciones'})]))
  add('INDICACIONES',[{label:'Indicaciones generales',value:data.receta.indicaciones}])
 }
 if(['nota_consulta','orden_recepcion'].includes(document.tipo)){
  const services=data.servicios||[]
  add('SERVICIOS',services.map(s=>({label:s.nombre,value:`${money(s.precio_aplicado)} MXN`})))
  if(document.tipo==='orden_recepcion'){
   add('PRODUCTOS O MEDICAMENTOS A ENTREGAR',(data.productos||[]).map(p=>({label:p.nombre,value:`Cantidad: ${p.cantidad}${p.precio_unitario!=null?' · '+money(p.precio_unitario)+' MXN':''}`})))
   add('CIERRE ADMINISTRATIVO',[{label:'Subtotal de servicios',value:money(services.reduce((n,s)=>n+Number(s.precio_aplicado||0),0))+' MXN'},{label:'Observaciones administrativas',value:data.observaciones_administrativas},{label:'Próxima cita sugerida',value:date(data.proxima_cita)},{label:'Registro',value:'El pago y la entrega física se procesan en sus módulos correspondientes.'}])
  }
 }
 if(['nota_consulta','plan_tratamiento'].includes(document.tipo))add('INDICACIONES',[{label:'Indicaciones generales',value:c.indicaciones},{label:'Próxima cita sugerida',value:date(c.proxima_cita)}])
 return sections
}
function generateModernClinicalPDF(document,{logoBuffer}={}){
 const title=titles[document.tipo],data=document.contenido
 if(!title||!data)throw Error('Documento clínico no válido.')
 if(document.tipo==='receta_simple')validatePrescription(data)
 return new Promise((resolve,reject)=>{
  const pdf=new PDFDocument({size:'LETTER',margins:{top:44,bottom:60,left:44,right:44},bufferPages:true,info:{Title:title,Author:'VetTrack',Creator:'VetTrack · documentos clínicos v2',CreationDate:new Date(document.creado_en),Subject:`Consulta ${document.id_consulta} · documento ${document.id_documento} · revisión ${document.revision}`}})
  const chunks=[];pdf.on('data',c=>chunks.push(c));pdf.on('error',reject);pdf.on('end',()=>resolve(Buffer.concat(chunks)))
  try{
   const normal=['C:/Windows/Fonts/arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(p=>fs.existsSync(p))
   const bold=['C:/Windows/Fonts/arialbd.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(p=>fs.existsSync(p))
   if(normal)pdf.registerFont('Body',normal);if(bold)pdf.registerFont('Strong',bold)
   const bodyFont=normal?'Body':'Helvetica',boldFont=bold?'Strong':'Helvetica-Bold'
   const ctx=document.tipo==='orden_recepcion'?data:data.contexto||{},clinic=ctx.clinica||{},patient=ctx.paciente||{},doctor=ctx.medico||{},consultation=data.consulta||{}
   const left=44,width=524,ink='#19352b',green='#176447',muted='#52665d',signatureHeight=84
   const setFont=(size=10,strong=false)=>pdf.font(strong?boldFont:bodyFont).fontSize(size)
   const wrap=(value,maxWidth=width,size=10,strong=false)=>{
    setFont(size,strong);const lines=[]
    for(const paragraph of String(value).replaceAll('\r','').split('\n')){
     if(!paragraph.trim()){lines.push('');continue}
     let line=''
     for(let word of paragraph.split(/\s+/)){
      while(pdf.widthOfString(word)>maxWidth){
       if(line){lines.push(line);line=''}
       let cut=1;while(cut<word.length&&pdf.widthOfString(word.slice(0,cut+1))<=maxWidth)cut++
       lines.push(word.slice(0,cut));word=word.slice(cut)
      }
      if(!word)continue
      const next=line?line+' '+word:word
      if(pdf.widthOfString(next)>maxWidth){lines.push(line);line=word}else line=next
     }
     if(line)lines.push(line)
    }return lines.length?lines:['']
   }
   const runningHeader=()=>{
    setFont(9,true);pdf.fillColor(green).text(clinic.nombre||'VetTrack',left,35,{lineBreak:false,width});setFont(8);pdf.fillColor(muted).text(title,left,51,{lineBreak:false,width})
    pdf.strokeColor('#d4e3da').lineWidth(.6).moveTo(left,69).lineTo(left+width,69).stroke();pdf.y=84
   }
   const ensureSpace=height=>{if(pdf.y+height>pdf.page.height-60){pdf.addPage();runningHeader()}}
   const paragraph=(value,{size=10,strong=false,color=ink,reserve=0,x=left,available=width}={})=>{
    const lines=wrap(value,available,size,strong),lineHeight=size*1.35+1
    for(let i=0;i<lines.length;i++){
     // Keep at least the final three content lines with the signature block.
     if(reserve&&lines.length-i<=3)ensureSpace((lines.length-i)*lineHeight+reserve)
     else ensureSpace(lineHeight)
     const y=pdf.y;setFont(size,strong);pdf.fillColor(color).text(lines[i]||' ',x,y,{lineBreak:false,width:available});pdf.y=y+lineHeight
    }
   }
   let headerX=left,headerWidth=width
   if(logoBuffer){try{pdf.image(logoBuffer,left,44,{fit:[64,64],align:'center',valign:'center'});headerX=124;headerWidth=444}catch{/* Safe fallback for a missing or unreadable historical logo. */}}
   pdf.y=44
   paragraph(clinic.nombre||'VetTrack',{size:17,strong:true,color:green,x:headerX,available:headerWidth})
   if(present(clinic.direccion))paragraph(clinic.direccion,{size:9,color:muted,x:headerX,available:headerWidth})
   if(present(clinic.telefono))paragraph('Teléfono: '+clinic.telefono,{size:9,color:muted,x:headerX,available:headerWidth})
   pdf.y=Math.max(pdf.y,logoBuffer?114:80)+12
   paragraph(title,{size:15,strong:true,color:green});paragraph(date(consultation.fecha_fin||consultation.fecha_inicio||document.creado_en),{size:9,color:muted})
   if(document.tipo==='receta_simple')paragraph('RESERVADO AL TRATAMIENTO DE ANIMALES',{size:8,strong:true,color:green})
   pdf.y+=6;pdf.strokeColor('#c9ded1').lineWidth(.8).moveTo(left,pdf.y).lineTo(left+width,pdf.y).stroke();pdf.y+=15
   const grid=[['Paciente',patient.nombre],['Propietario',ctx.propietario?.nombre],['Especie',patient.especie],['Raza',patient.raza],['Sexo',patient.sexo],['Peso',present(consultation.peso)?consultation.peso+' kg':present(patient.peso)?patient.peso+' kg':null],['Médico veterinario',doctor.nombre],['Cédula profesional',doctor.cedula_profesional||'Pendiente'],['Fecha',date(consultation.fecha_fin||consultation.fecha_inicio||document.creado_en)]].filter(([,v])=>present(v))
   for(let i=0;i<grid.length;i+=2){
    const pair=grid.slice(i,i+2),height=Math.max(...pair.map(([,v])=>wrap(v,242,10).length))*14.5+20;ensureSpace(height)
    const top=pdf.y
    pair.forEach(([label,value],col)=>{const x=left+col*270;setFont(8,true);pdf.fillColor(muted).text(label.toUpperCase(),x,top,{lineBreak:false,width:242});const lines=wrap(value,242,10);lines.forEach((line,n)=>{setFont(10);pdf.fillColor(ink).text(line,x,top+13+n*14.5,{lineBreak:false,width:242})})})
    pdf.y=top+height
   }
   const sections=sectionsFor(document)
   for(let si=0;si<sections.length;si++){
    const section=sections[si];ensureSpace(62);pdf.y+=10
    paragraph(section.title,{size:11,strong:true,color:green});pdf.y+=4
    for(let ei=0;ei<section.entries.length;ei++){
     const entry=section.entries[ei],last=si===sections.length-1&&ei===section.entries.length-1
     const tail=section.entries.slice(ei+1),tailHeight=tail.reduce((sum,e)=>sum+wrap(`${e.label}: ${e.value}`).length*14.5+5,0)
     const reserve=si===sections.length-1&&tail.length<=3&&tailHeight<250?signatureHeight+10+tailHeight:last?signatureHeight+10:0
     paragraph(`${entry.label}: ${entry.value}`,{reserve});pdf.y+=5
    }
   }
   if(!sections.length)ensureSpace(signatureHeight)
   // The last paragraph reserved this space, so signature cannot be orphaned.
   ensureSpace(signatureHeight);pdf.y+=14
   paragraph('Firma del MVZ __________________________________',{size:10})
   if(present(doctor.nombre))paragraph(doctor.nombre,{size:10,strong:true})
   paragraph(doctor.cedula_profesional?'Cédula profesional: '+doctor.cedula_profesional:'Cédula profesional pendiente',{size:9,color:muted})
   const range=pdf.bufferedPageRange()
   for(let i=range.start;i<range.start+range.count;i++){
    pdf.switchToPage(i);const bottom=pdf.page.margins.bottom;pdf.page.margins.bottom=0
    pdf.strokeColor('#d4e3da').lineWidth(.5).moveTo(left,pdf.page.height-45).lineTo(left+width,pdf.page.height-45).stroke()
    setFont(8);pdf.fillColor(muted).text(`VetTrack · Página ${i+1}/${range.count} · Revisión ${document.revision}`,left,pdf.page.height-32,{lineBreak:false,width,align:'center'});pdf.page.margins.bottom=bottom
   }
   pdf.end()
  }catch(error){pdf.destroy();reject(error)}
 })
}
module.exports={generateModernClinicalPDF,sectionsFor}
