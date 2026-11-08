const PDFDocument = require('pdfkit')
const fs = require('node:fs')

const titles = {
  nota_consulta: 'Nota de Consulta Veterinaria',
  plan_tratamiento: 'Plan de Tratamiento',
  orden_recepcion: 'Orden de Cierre a Recepción',
  receta_simple: 'Receta Médica Veterinaria Simple',
}
const text = value => value == null || value === '' ? 'No registrado' : String(value)
const date = value => value ? new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Tijuana', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'No registrado'

function validatePrescription(data) {
  const details = data.receta?.detalles || []
  if (!details.length) throw new Error('La receta no contiene medicamentos.')
  if (details.some(item => item.grupo_prescripcion === 'I')) throw new Error('Este medicamento requiere receta médica cuantificada autorizada.')
  if (details.some(item => !['II', 'III'].includes(item.grupo_prescripcion))) throw new Error('Clasifica los medicamentos antes de emitir una receta simple.')
  if (!data.contexto?.medico?.cedula_profesional) throw new Error('La receta requiere cédula profesional.')
  if (!data.contexto?.clinica?.direccion?.trim() || !data.contexto?.paciente?.especie?.trim()) throw new Error('La receta requiere domicilio profesional y especie del paciente.')
}

async function generateClinicalPDF(document) {
  const title = titles[document.tipo]
  if (!title || !document.contenido) throw new Error('Documento clínico no válido.')
  const data = document.contenido
  if (document.tipo === 'receta_simple') validatePrescription(data)
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'LETTER', margin: 46, bufferPages: true, info: {
      Title: title, Author: 'VetTrack', CreationDate: new Date(document.creado_en), Subject: `Consulta ${document.id_consulta} · revisión ${document.revision}`,
    } })
    const chunks = []
    pdf.on('data', chunk => chunks.push(chunk))
    pdf.on('error', reject)
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    try {
      const font = ['C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(candidate => fs.existsSync(candidate))
      if (font) pdf.font(font)
      const ctx = document.tipo === 'orden_recepcion' ? data : data.contexto
      const consultation = data.consulta || {}
      const heading = label => { pdf.moveDown(0.7).fontSize(12).fillColor('#176447').text(label); pdf.moveDown(0.2).fontSize(10).fillColor('#1f2937') }
      const field = (label, value) => pdf.text(`${label}: ${text(value)}`, { lineGap: 3 })
      pdf.fontSize(20).fillColor('#176447').text('VetTrack')
      pdf.fontSize(15).text(title).moveDown(0.5).fontSize(10).fillColor('#1f2937')
      field('Clínica', ctx?.clinica?.nombre); field('Domicilio profesional', ctx?.clinica?.direccion)
      field('Teléfono', ctx?.clinica?.telefono); field('Fecha', date(consultation.fecha_fin || consultation.fecha_inicio || document.creado_en))
      field('Propietario', ctx?.propietario?.nombre); field('Paciente', ctx?.paciente?.nombre)
      field('Especie', ctx?.paciente?.especie)
      if (document.tipo !== 'orden_recepcion') {
        field('Raza', ctx?.paciente?.raza); field('Peso', consultation.peso == null ? ctx?.paciente?.peso : `${consultation.peso} kg`)
      }
      field('Médico veterinario', ctx?.medico?.nombre)
      if (document.tipo !== 'orden_recepcion') field('Cédula profesional', ctx?.medico?.cedula_profesional)
      if (document.tipo === 'nota_consulta') {
        heading('Consulta y exploración')
        for (const [key, label] of Object.entries({ motivo_consulta: 'Motivo', anamnesis: 'Anamnesis', exploracion_fisica: 'Exploración física', temperatura: 'Temperatura (°C)', frecuencia_cardiaca: 'Frecuencia cardiaca', frecuencia_respiratoria: 'Frecuencia respiratoria', mucosas: 'Mucosas', trc: 'TRC', observaciones: 'Observaciones', pronostico: 'Pronóstico' })) field(label, consultation[key])
        heading('Diagnósticos')
        for (const item of data.diagnosticos || []) field(item.tipo || 'Diagnóstico', item.descripcion)
        for (const [key, label] of [['vacunas', 'Vacunación'], ['desparasitaciones', 'Desparasitación'], ['estudios', 'Estudios']]) {
          if (!data[key]?.length) continue
          heading(label)
          for (const item of data[key]) {
            field('Registro', item.nombre || item.producto)
            for (const [name, value] of Object.entries(item)) if (!name.startsWith('id_') && !['nombre', 'producto'].includes(name) && value != null) field(name.replaceAll('_', ' '), value)
          }
        }
      }
      if (['nota_consulta', 'plan_tratamiento'].includes(document.tipo)) {
        heading('Tratamiento e indicaciones')
        for (const item of data.tratamientos || []) { field('Tratamiento', item.descripcion); field('Indicaciones', item.indicaciones); field('Duración', item.duracion); if (item.observaciones) field('Observaciones', item.observaciones) }
        field('Indicaciones generales', consultation.indicaciones); field('Próxima cita sugerida', consultation.proxima_cita)
      }
      if (document.tipo === 'receta_simple') {
        heading('RESERVADO AL TRATAMIENTO DE ANIMALES')
        for (const [index, item] of data.receta.detalles.entries()) {
          heading(`${index + 1}. ${item.nombre_medicamento}`)
          for (const [key, label] of Object.entries({ principio_activo: 'Principio activo', concentracion: 'Concentración', presentacion: 'Presentación', dosis: 'Dosis', frecuencia: 'Frecuencia', duracion: 'Duración', via_administracion: 'Vía de administración', cantidad: 'Cantidad', indicaciones: 'Indicaciones', tiempo_retiro: 'Tiempo de retiro', grupo_prescripcion: 'Grupo de prescripción' })) field(label, item[key])
        }
        field('Indicaciones generales', data.receta.indicaciones)
      }
      if (['orden_recepcion', 'nota_consulta'].includes(document.tipo)) {
        heading('Servicios realizados')
        for (const item of data.servicios || []) field(item.nombre, `${Number(item.precio_aplicado).toFixed(2)} MXN`)
      }
      if (document.tipo === 'orden_recepcion') {
        heading('Productos o medicamentos a entregar')
        for (const item of data.productos || []) field(item.nombre, `Cantidad: ${item.cantidad}`)
        field('Observaciones administrativas', data.observaciones_administrativas); field('Próxima cita sugerida', data.proxima_cita)
        pdf.moveDown().text('Orden administrativa; el cobro y la entrega física se registran por separado.')
      }
      pdf.moveDown(2).text('Firma del MVZ: __________________________________________')
      field('Nombre', ctx?.medico?.nombre)
      pdf.moveDown().fontSize(8).fillColor('#4b5563').text(`Consulta ${document.id_consulta} · revisión ${document.revision} · documento ${document.id_documento}`)
      const pages = pdf.bufferedPageRange()
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        pdf.switchToPage(i)
        pdf.fontSize(8).text(`VetTrack · ${i + 1}/${pages.count}`, 46, pdf.page.height - 35, { lineBreak: false })
      }
      pdf.end()
    } catch (error) { pdf.destroy(); reject(error) }
  })
}
module.exports = { generateClinicalPDF, validatePrescription, titles }
