const { validarId, validarCampos, texto, fecha, booleano, entero, datoRPC, responderError, fallar } = require('./operacion.shared')
const { generateClinicalPDF } = require('../services/clinical-pdf')
const { loadDocumentLogo } = require('../services/document-logo')
const checked = result => {
  if (result.error?.code === '22023') {
    const known = {
      'Cédula profesional requerida para emitir receta': 'Registra la cédula del médico antes de emitir la receta.',
      'Receta requiere domicilio profesional y especie del paciente': 'Completa el domicilio de la clínica y la especie del paciente antes de emitir la receta.',
    }
    if (known[result.error.message]) fallar(400, known[result.error.message])
  }
  return datoRPC(result)
}

const coreTexts = ['motivo_consulta', 'anamnesis', 'exploracion_fisica', 'mucosas', 'trc', 'observaciones', 'pronostico', 'indicaciones', 'observaciones_administrativas']
const forms = {
  diagnostico: { module: 'diagnosticos', fields: ['tipo', 'descripcion'], required: ['tipo', 'descripcion'] },
  tratamiento: { module: 'tratamientos', fields: ['descripcion', 'indicaciones', 'duracion', 'observaciones'], required: ['descripcion'] },
  vacuna: { module: 'vacunas', fields: ['nombre', 'laboratorio', 'lote', 'fecha_aplicacion', 'proxima_aplicacion', 'observaciones'], required: ['nombre', 'fecha_aplicacion'] },
  desparasitacion: { module: 'desparasitacion', fields: ['producto', 'dosis', 'peso', 'fecha', 'proxima_fecha', 'observaciones'], required: ['producto', 'dosis', 'fecha'] },
  estudio: { module: 'estudios', fields: ['tipo', 'nombre', 'resultado', 'observaciones', 'fecha', 'archivo_url', 'archivo_adjunto'], required: ['tipo', 'nombre', 'fecha'] },
}
const number = (value, max, min = 0, integer = false) => {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= min || value > max || (integer && !Number.isInteger(value))) fallar(400, 'Valor numérico clínico no válido.')
  return value
}
const recordBody = (kind, body) => {
  if (kind === 'receta') {
    validarCampos(body, ['indicaciones', 'detalles'])
    if (!Array.isArray(body.detalles) || body.detalles.length < 1 || body.detalles.length > 50) fallar(400, 'Selecciona de uno a cincuenta medicamentos.')
    return { indicaciones: texto(body.indicaciones, 'Las indicaciones', 20000), detalles: body.detalles.map(item => {
      const fields = ['nombre_medicamento', 'principio_activo', 'concentracion', 'presentacion', 'dosis', 'frecuencia', 'duracion', 'via_administracion', 'cantidad', 'indicaciones', 'grupo_prescripcion', 'tiempo_retiro', 'entregar']
      validarCampos(item, [...fields, 'id_producto'])
      const data = Object.fromEntries(fields.filter(key => !['cantidad', 'entregar'].includes(key)).map(key => [key, texto(item[key], key.replaceAll('_', ' '), 5000, ['nombre_medicamento', 'dosis', 'frecuencia', 'duracion', 'via_administracion'].includes(key))]))
      data.grupo_prescripcion = item.grupo_prescripcion || 'no_clasificado'
      if (!['I', 'II', 'III', 'no_clasificado'].includes(data.grupo_prescripcion)) fallar(400, 'Grupo de prescripción no válido.')
      data.cantidad = number(item.cantidad, 999999999)
      if (data.cantidad == null) fallar(400, 'Cantidad requerida.')
      data.entregar = booleano(item.entregar, false)
      if (item.id_producto != null) data.id_producto = validarId(item.id_producto)
      return data
    }) }
  }
  const spec = forms[kind]
  if (!spec) fallar(400, 'Tipo de registro clínico no válido.')
  validarCampos(body, ['id', ...spec.fields])
  const data = {}
  if (body.id !== undefined) data.id = validarId(body.id)
  for (const key of spec.fields) {
    if (!Object.hasOwn(body, key) && !spec.required.includes(key)) continue
    if (['fecha', 'fecha_aplicacion', 'proxima_fecha', 'proxima_aplicacion'].includes(key)) data[key] = body[key] == null && !spec.required.includes(key) ? null : fecha(body[key])
    else if (key === 'archivo_adjunto') data[key] = body[key] == null ? null : validarId(body[key])
    else if (key === 'peso') data[key] = number(body[key], 99999)
    else data[key] = texto(body[key], key.replaceAll('_', ' '), 20000, spec.required.includes(key))
  }
  if (kind === 'diagnostico' && !['presuntivo', 'definitivo'].includes(data.tipo)) fallar(400, 'Tipo de diagnóstico no válido.')
  if (kind === 'estudio' && !['radiografia', 'ultrasonido', 'laboratorio', 'otro'].includes(data.tipo)) fallar(400, 'Tipo de estudio no válido.')
  if (data.archivo_url && (!data.archivo_url.startsWith('https://') || data.archivo_url.length > 2000)) fallar(400, 'El archivo debe usar una URL HTTPS.')
  return data
}
const run = (rpc, args) => async (req, res) => {
  try { return res.json(datoRPC(await req.supabase.rpc(rpc, args(req)))) }
  catch (error) { return responderError(res, error) }
}
const noBody = req => { if (req.body !== undefined) validarCampos(req.body, []) }
const list = run('vettrack_consultas', req => {
  validarCampos(req.query, ['mias'])
  if (req.query.mias !== undefined && !['true', 'false'].includes(req.query.mias)) fallar(400, 'Filtro no válido.')
  return { p_mias: req.query.mias === 'true' }
})
const get = run('vettrack_consulta', req => ({ p_id: validarId(req.params.id) }))
const start = run('vettrack_iniciar_consulta', req => { noBody(req); return { p_cita: validarId(req.params.id) } })
const saveBody = req => {
  validarCampos(req.body, [...coreTexts, 'temperatura', 'frecuencia_cardiaca', 'frecuencia_respiratoria', 'peso', 'proxima_cita'])
  const data = {}
  for (const key of coreTexts) if (Object.hasOwn(req.body, key)) data[key] = texto(req.body[key], key.replaceAll('_', ' '), 20000, key === 'motivo_consulta')
  for (const [key, max] of [['temperatura', 69.99], ['frecuencia_cardiaca', 500], ['frecuencia_respiratoria', 400], ['peso', 99999]]) {
    if (Object.hasOwn(req.body, key)) data[key] = number(req.body[key], max, key.startsWith('frecuencia') ? -1 : 0, key.startsWith('frecuencia'))
  }
  if (Object.hasOwn(req.body, 'proxima_cita')) data.proxima_cita = req.body.proxima_cita == null ? null : fecha(req.body.proxima_cita)
  return { p_id: validarId(req.params.id), p_datos: data }
}
const save = async (req,res) => {
 try {
  const args=saveBody(req)
  if(args.p_datos.proxima_cita){
   const current=checked(await req.supabase.rpc('vettrack_consulta',{p_id:args.p_id}))
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Tijuana',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(current.consulta.fecha_inicio))
   const date=['year','month','day'].map(key=>parts.find(p=>p.type===key).value).join('-')
   if(args.p_datos.proxima_cita<date) fallar(400,'La próxima cita sugerida no puede ser anterior a la fecha de consulta.')
  }
  const result=await req.supabase.rpc('vettrack_guardar_consulta',args)
  if(result.error?.message==='La próxima cita no puede ser anterior a la consulta')fallar(400,'La próxima cita sugerida no puede ser anterior a la fecha de consulta.')
  return res.json(datoRPC(result))
 }catch(error){return responderError(res,error)}
}
const record = async (req, res) => {
  try {
    const kind = req.params.tipo
    const module = kind === 'receta' ? 'recetas' : forms[kind]?.module
    if (!module) fallar(400, 'Tipo de registro clínico no válido.')
    if (!req.clinicAccess.permisos.some(key => [module + '.crear', module + '.editar'].includes(key))) fallar(403, 'No tienes permiso para este registro clínico.')
    return res.json(datoRPC(await req.supabase.rpc('vettrack_guardar_registro_clinico', { p_consulta: validarId(req.params.id), p_tipo: kind, p_datos: recordBody(kind, req.body) })))
  } catch (error) { return responderError(res, error) }
}
const license = run('vettrack_cedula_medico', req => {
  validarCampos(req.body, ['cedula_profesional'])
  const value = req.body.cedula_profesional
  if (value !== null && (typeof value !== 'string' || !/^[0-9]{5,20}$/.test(value))) fallar(400, 'La cédula debe contener de 5 a 20 dígitos.')
  return { p_medico: validarId(req.params.id), p_cedula: value }
})
const addService = run('vettrack_agregar_servicio_consulta', req => {
  validarCampos(req.body, ['id_servicio'])
  return { p_consulta: validarId(req.params.id), p_servicio: validarId(req.body.id_servicio) }
})
const finish = async (req, res) => {
  try {
    noBody(req)
    const data = checked(await req.supabase.rpc('vettrack_finalizar_consulta', { p_id: validarId(req.params.id) }))
    let pending = false
    // Idempotent finalization stores immutable snapshots first. If rendering is
    // interrupted, authenticated document downloads can retry from those snapshots.
    for (const meta of data.documentos || []) {
      if (meta.revision !== data.consulta.revision) continue
      try {
        const doc = datoRPC(await req.supabase.rpc('vettrack_documento_clinico', { p_id: meta.id_documento }))
        await generateClinicalPDF(doc, { logoBuffer: await loadDocumentLogo(req.supabase, doc) })
      } catch { pending = true }
    }
    return res.status(pending ? 202 : 200).json({ ...data, documentos_pendientes: pending })
  } catch (error) { return responderError(res, error) }
}
const reopen = run('vettrack_reabrir_consulta', req => {
  validarCampos(req.body, ['motivo'])
  return { p_id: validarId(req.params.id), p_motivo: texto(req.body.motivo, 'El motivo de reapertura', 2000, true) }
})
const history = run('vettrack_expediente', req => {
  validarCampos(req.query, ['limite', 'offset'])
  const parse = (value, fallback, max) => {
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !/^\d+$/.test(value)) fallar(400, 'Paginación no válida.')
    return entero(Number(value), 0, max, 'La paginación')
  }
  const limit = parse(req.query.limite, 100, 200)
  if (limit < 1) fallar(400, 'El límite debe ser positivo.')
  return { p_mascota: validarId(req.params.id), p_limite: limit, p_offset: parse(req.query.offset, 0, 100000) }
})
const orders = run('vettrack_ordenes_recepcion', () => ({}))
const processOrder = run('vettrack_procesar_orden_recepcion', req => { noBody(req); return { p_id: validarId(req.params.id) } })
const clinic = run('vettrack_datos_profesionales_clinica', req => {
  validarCampos(req.body, ['nombre', 'direccion', 'telefono'])
  const data = {}
  for (const [key, max] of [['nombre', 150], ['direccion', 2000], ['telefono', 20]]) if (Object.hasOwn(req.body, key)) data[key] = texto(req.body[key], key, max, key === 'nombre')
  return { p_datos: data }
})
const document = async (req, res) => {
  try {
    const doc = datoRPC(await req.supabase.rpc('vettrack_documento_clinico', { p_id: validarId(req.params.id) }))
    const pdf = await generateClinicalPDF(doc, { logoBuffer: await loadDocumentLogo(req.supabase, doc) })
    res.set('Content-Type', 'application/pdf').set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Disposition', `attachment; filename="vettrack-${doc.tipo}-${doc.id_documento}.pdf"`)
    return res.send(pdf)
  } catch (error) { return responderError(res, error) }
}
module.exports = { list, get, start, save, record, license, clinic, addService, finish, reopen, history, orders, processOrder, document, recordBody }
