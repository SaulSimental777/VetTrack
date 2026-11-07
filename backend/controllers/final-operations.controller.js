const { validarCampos, validarId, texto, fecha, fechaHora, datoRPC, responderError, fallar } = require('./operacion.shared')
const specs = {
  dashboard: ['dashboard.ver', []], horarios_medicos: ['horarios.ver', []], reporte: ['reportes.ver', ['tipo', 'desde', 'hasta', 'id_mascota']],
  configuracion: ['configuracion.ver', []], configuracion_guardar: ['configuracion.editar', ['nombre', 'direccion', 'telefono', 'correo', 'horario', 'descripcion', 'foto_veterinaria']],
  pagos: ['pagos.ver', []], orden_pago: ['pagos.ver', ['id_orden']], metodos_pago: ['pagos.ver', []],
  pago_registrar: ['pagos.crear', ['id_orden', 'id_metodopago', 'fecha_pago']],
}
const reports = { agenda: 'citas.ver', pacientes: 'pacientes.ver', historial: 'expediente.ver', vacunas: 'vacunas.ver', desparasitaciones: 'desparasitacion.ver', tratamientos: 'tratamientos.ver', servicios: 'servicios.ver', uso_inventario: 'inventario.movimientos', stock_bajo: 'inventario.ver', caducidades: 'inventario.ver' }
const execute = async (req, res) => {
  try {
    const op = req.params.operacion
    if (!Object.hasOwn(specs, op)) fallar(404, 'Operación no disponible.')
    const permissions = req.clinicAccess.permisos
    if (!permissions.includes(specs[op][0])) fallar(403, 'No tienes permiso para esta operación.')
    if (req.method === 'GET' && ['configuracion_guardar', 'pago_registrar'].includes(op)) fallar(405, 'Esta operación requiere POST.')
    const source = (req.method === 'GET' ? req.query : req.body) || {}
    validarCampos(source, specs[op][1])
    const data = {}
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('id_')) data[key] = validarId(value)
      else if (key === 'fecha_pago') data[key] = fechaHora(value)
      else if (['desde', 'hasta'].includes(key)) data[key] = fecha(value)
      else data[key] = texto(value, key.replaceAll('_', ' '), { nombre: 150, telefono: 20, correo: 100, horario: 100, descripcion: 5000 }[key] || 2000, key === 'nombre')
    }
    if (op === 'reporte') {
      if (!Object.hasOwn(reports, data.tipo)) fallar(400, 'Selecciona un reporte válido.')
      if (!permissions.includes(reports[data.tipo]) || (['historial', 'vacunas', 'desparasitaciones', 'tratamientos'].includes(data.tipo) && !['admin', 'medico'].includes(req.clinicAccess.rol))) fallar(403, 'No tienes permiso para los datos de este reporte.')
      if (data.desde && data.hasta && (data.desde > data.hasta || (Date.parse(data.hasta) - Date.parse(data.desde)) / 86400000 > 366)) fallar(400, 'Selecciona un periodo de hasta 366 días.')
      if (data.tipo === 'historial' && !data.id_mascota) fallar(400, 'Selecciona el paciente del historial.')
    }
    if (op === 'configuracion_guardar') {
      if (!data.nombre) fallar(400, 'El nombre de la clínica es obligatorio.')
      if (data.correo && !/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(data.correo)) fallar(400, 'Ingresa un correo completo, como clinica@ejemplo.com.')
      if (data.foto_veterinaria) { let url; try { url = new URL(data.foto_veterinaria) } catch { fallar(400, 'La imagen debe usar una URL HTTPS válida.') }; if (url.protocol !== 'https:' || url.username || url.password) fallar(400, 'La imagen debe usar una URL HTTPS válida.') }
    }
    if (['orden_pago', 'pago_registrar'].includes(op) && !data.id_orden) fallar(400, 'Selecciona una orden.')
    if (op === 'pago_registrar') {
      if (!permissions.includes('orden_recepcion.procesar')) fallar(403, 'Necesitas permiso para procesar la orden.')
      if (!data.id_metodopago) fallar(400, 'Selecciona el método de pago.')
    }
    const result = await req.supabase.rpc('vettrack_operacion_final', { p_operacion: op, p_datos: data })
    const messages = {
      'Confirma las entregas antes de registrar el pago': 'Confirma primero la entrega física de los productos desde Órdenes de recepción.',
      'Entrega histórica sin precio guardado; requiere revisión': 'La entrega histórica no tiene un precio guardado. Solicita revisión al administrador; no se aplicará el precio actual.',
      'Fecha de pago futura': 'La fecha del pago no puede ser futura.',
    }
    if (result.error && messages[result.error.message]) fallar(result.error.code === '22023' ? 400 : 409, messages[result.error.message])
    return res.json(datoRPC(result))
  } catch (error) { return responderError(res, error) }
}
module.exports = { execute }
