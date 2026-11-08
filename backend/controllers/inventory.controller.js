const { validarCampos, validarId, texto, booleano, fecha, datoRPC, responderError, fallar } = require('./operacion.shared')
const documentFields = ['fecha_solicitud', 'fecha_documento', 'folio_documento', 'documento_url', 'observaciones']

const specs = {
  compra_cerrar: ['compras.administrar', ['id','estado','motivo']],
  productos: ['inventario.ver', []], medicamentos: ['medicamentos.ver', []], venta_catalogo: ['venta_libre.ver', []],
  producto_guardar: ['inventario.crear', ['id', 'nombre', 'descripcion', 'tipo_producto', 'sku', 'unidad', 'precio_compra', 'precio_venta', 'stock_minimo', 'activo', 'principio_activo', 'concentracion', 'presentacion', 'grupo_prescripcion', 'requiere_receta', 'tiempo_retiro_default']],
  movimientos: ['inventario.movimientos', ['id_producto']], mover: ['inventario.ajustar', ['id_producto', 'tipo', 'cantidad', 'idempotencia', 'motivo', 'referencia', 'numero_lote', 'fecha_caducidad']],
  uso_clinico: ['inventario.uso_clinico', ['id_producto', 'cantidad', 'idempotencia', 'motivo', 'id_consulta']],
  proveedores: ['proveedores.ver', []], proveedor_guardar: ['proveedores.crear', ['id', 'nombre', 'razon_social', 'rfc', 'telefono', 'correo', 'direccion', 'contacto', 'activo']],
  compras: ['compras.ver', []], compra_crear: ['compras.crear', ['id_proveedor', 'referencia', 'motivo', 'detalles', ...documentFields]], compra_recibir: ['compras.recibir', ['id', 'documento_archivo', 'recepciones', ...documentFields.filter(key => key !== 'fecha_solicitud')]],
  ventas: ['venta_libre.ver', []], venta_preparar: ['venta_libre.preparar', ['referencia', 'detalles']], venta_entregar: ['inventario.entregar', ['id']],
  receta_entregar: ['inventario.entregar', ['id_orden', 'id_detalle']],
  entregas_receta: ['orden_recepcion.ver', ['id_orden']],
  lotes: ['inventario.ver', ['id_producto', 'estado', 'dias']], recepciones: ['compras.ver', ['dias']],
}
const numeric = (value, positive = false, signed = false, precision = 3) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 999999999 || (!signed && value < 0) || (positive && value <= 0) || Math.abs(value * 10 ** precision - Math.round(value * 10 ** precision)) > 0.00001) fallar(400, 'Cantidad o precio no válido.')
  return value
}
const validate = (op, body) => {
  validarCampos(body, specs[op][1])
  const data = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'documento_archivo') data[key] = value == null ? null : validarId(value)
    else if (key === 'id' || key.startsWith('id_') || key === 'idempotencia') data[key] = validarId(value)
    else if (key === 'dias') {
      const days = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
      if (!(op === 'lotes' ? [30, 60, 90] : [7, 30, 90]).includes(days)) fallar(400, 'Ventana de consulta no válida.')
      data.dias = days
    }
    else if (key.startsWith('fecha_')) data[key] = value == null ? null : fecha(value)
    else if (['precio_compra', 'precio_venta', 'stock_minimo', 'cantidad'].includes(key)) data[key] = numeric(value, key === 'cantidad' && !(op === 'mover' && body.tipo === 'ajuste'), op === 'mover' && body.tipo === 'ajuste', key.startsWith('precio') ? 2 : 3)
    else if (['activo', 'requiere_receta'].includes(key)) data[key] = booleano(value)
    else if (key === 'recepciones') {
      if (!Array.isArray(value) || !value.length || value.length > 200) fallar(400, 'Selecciona de una a doscientas líneas de recepción.')
      data.recepciones = value.map(item => {
        validarCampos(item, ['id_compra_detalle', 'cantidad', 'precio_unitario', 'numero_lote', 'fecha_caducidad'])
        const result = { id_compra_detalle: validarId(item.id_compra_detalle), cantidad: numeric(item.cantidad, true), precio_unitario: numeric(item.precio_unitario, false, false, 2), numero_lote: texto(item.numero_lote, 'El lote', 100), fecha_caducidad: item.fecha_caducidad == null ? null : fecha(item.fecha_caducidad) }
        if (result.fecha_caducidad && !result.numero_lote) fallar(400, 'Indica el número de lote para registrar caducidad.')
        return result
      })
    }
    else if (key === 'detalles') {
      if (!Array.isArray(value) || !value.length || value.length > 100) fallar(400, 'Selecciona de uno a cien productos.')
      data.detalles = value.map(item => {
        validarCampos(item, op === 'compra_crear' ? ['id_producto', 'cantidad', 'precio_unitario'] : ['id_producto', 'cantidad'])
        return { id_producto: validarId(item.id_producto), cantidad: numeric(item.cantidad, true), ...(op === 'compra_crear' ? { precio_unitario: numeric(item.precio_unitario, false, false, 2) } : {}) }
      })
      if (new Set(data.detalles.map(item => item.id_producto)).size !== data.detalles.length) fallar(400, 'No repitas productos en los detalles.')
    } else data[key] = texto(value, key, key === 'nombre' ? op === 'producto_guardar' ? 100 : 150 : 2000, ['nombre', 'unidad', 'motivo'].includes(key))
  }
  const required = {
    producto_guardar: ['nombre', 'tipo_producto', 'unidad', 'precio_venta', 'stock_minimo'], proveedor_guardar: ['nombre'],
    mover: ['id_producto', 'tipo', 'cantidad', 'idempotencia', 'motivo'], uso_clinico: ['id_producto', 'cantidad', 'idempotencia', 'motivo', 'id_consulta'],
    compra_crear: ['id_proveedor', 'detalles'], venta_preparar: ['detalles'], compra_recibir: ['id'], venta_entregar: ['id'], receta_entregar: ['id_orden', 'id_detalle'],
  }
  if (required[op]?.some(key => data[key] == null)) fallar(400, 'Faltan datos requeridos.')
  for (const [key, allowed] of Object.entries({ tipo_producto: ['medicamento', 'insumo', 'venta_libre'], tipo: ['entrada', 'salida', 'ajuste'], grupo_prescripcion: ['I', 'II', 'III', 'no_clasificado'] })) if (data[key] !== undefined && !allowed.includes(data[key])) fallar(400, 'Clasificación no válida.')
  if (data.correo && !/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(data.correo)) fallar(400, 'El correo no es válido.')
  if (data.cantidad === 0) fallar(400, 'La cantidad debe ser distinta de cero.')
  if (data.estado !== undefined && !(op === 'compra_cerrar' ? ['cancelada','no_recibida'] : ['todos', 'activos', 'caducados', 'proximos']).includes(data.estado)) fallar(400, 'Estado de lote no válido.')
  if (data.numero_lote?.length > 100) fallar(400, 'El lote admite hasta 100 caracteres.')
  if (data.fecha_caducidad && !data.numero_lote) fallar(400, 'Indica el número de lote para registrar caducidad.')
  if (op === 'mover' && (Object.hasOwn(data, 'numero_lote') || Object.hasOwn(data, 'fecha_caducidad')) && data.tipo !== 'entrada') fallar(400, 'Los lotes se capturan en una entrada; las salidas usan FEFO.')
  if (data.documento_url) {
    let url
    try { url = new URL(data.documento_url) } catch { fallar(400, 'El documento debe usar una URL HTTPS válida.') }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) fallar(400, 'El documento debe usar una URL HTTPS válida.')
  }
  if (op === 'compra_cerrar' && (!data.id || !data.estado || !data.motivo)) fallar(400, 'Selecciona una compra pendiente e indica el motivo del cierre.')
  return data
}
const execute = async (req, res) => {
  try {
    const op = req.params.operacion
    if (!Object.hasOwn(specs, op)) fallar(404, 'Operación no disponible.')
    const source = req.method === 'GET' ? req.query : req.body
    const editing = source && Object.hasOwn(source, 'id') && ['producto_guardar', 'proveedor_guardar'].includes(op)
    const permission = editing ? specs[op][0].replace('.crear', '.editar') : specs[op][0]
    if (!req.clinicAccess.permisos.includes(permission)) fallar(403, 'No tienes permiso para esta operación.')
    if (req.method === 'GET' && !['productos', 'medicamentos', 'venta_catalogo', 'movimientos', 'proveedores', 'compras', 'ventas', 'entregas_receta', 'lotes', 'recepciones'].includes(op)) fallar(405, 'Esta operación requiere POST.')
    const data = validate(op, source || {})
    const result = await req.supabase.rpc('vettrack_inventario', { p_operacion: op, p_datos: data })
    if (result.error?.code === '23514' && result.error.message === 'Existencias insuficientes') fallar(409, 'Existencias insuficientes. Revisa el stock disponible.')
    if (result.error?.code === '23514' && result.error.message === 'Existencias vigentes insuficientes; hay lotes caducados o inactivos') fallar(409, 'No hay suficientes existencias vigentes. Revisa los lotes caducados o inactivos.')
    if (result.error?.code === '23514' && result.error.message === 'La recepción debe cubrir la cantidad solicitada') fallar(409, 'La suma de las cantidades recibidas debe coincidir con cada producto solicitado.')
    if (result.error?.code === '23514' && ['Solo una compra pendiente admite cierre','La compra ya está cerrada'].includes(result.error.message)) fallar(409, 'La compra ya está cerrada. Solo una compra pendiente puede recibirse, cancelarse o marcarse no recibida.')
    return res.json(datoRPC(result))
  } catch (error) { return responderError(res, error) }
}
module.exports = { execute }
