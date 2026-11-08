class ErrorOperacion extends Error {
  constructor(status, message) { super(message); this.status = status }
}

const fallar = (status, message) => { throw new ErrorOperacion(status, message) }
const objeto = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validarCampos = (body, allowed) => {
  if (!objeto(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    fallar(400, 'Los datos enviados contienen campos no permitidos.')
  }
}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const validarId = value => {
  if (!uuid(value)) fallar(400, 'El identificador debe ser un UUID válido.')
  return value.toLowerCase()
}
const texto = (value, label, max, required = false) => {
  if (!required && value == null) return null
  if (typeof value !== 'string' || [...value.trim()].length > max || (required && !value.trim())) {
    fallar(400, `${label} debe ser texto ${required ? 'obligatorio ' : ''}de hasta ${max} caracteres.`)
  }
  return value.trim() || null
}
const booleano = (value, fallback) => {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'boolean') fallar(400, 'El estado y las opciones deben ser booleanos.')
  return value
}
const entero = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fallar(400, `${label} debe ser un entero entre ${min} y ${max}.`)
  }
  return value
}
const listaIds = (value, min = 0, max = 50) => {
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some(id => !uuid(id))) {
    fallar(400, `Selecciona entre ${min} y ${max} identificadores UUID válidos.`)
  }
  const ids = value.map(id => id.toLowerCase())
  if (new Set(ids).size !== ids.length) fallar(400, 'No se permiten identificadores repetidos.')
  return ids
}
const fecha = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') {
    fallar(400, 'La fecha debe tener formato YYYY-MM-DD.')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fallar(400, 'La fecha no es válida.')
  return value
}
const fechaHora = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(value)) {
    fallar(400, 'La fecha y hora deben incluir una zona horaria explícita (ISO 8601).')
  }
  fecha(value.slice(0, 10))
  if (!Number.isFinite(Date.parse(value))) fallar(400, 'La fecha y hora no son válidas.')
  return new Date(value).toISOString()
}
const hora = value => {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fallar(400, 'La hora debe tener formato HH:mm.')
  return value
}
const permiso = (req, key) => {
  if (!req.clinicAccess.permisos.includes(key)) fallar(403, 'No tienes permiso para realizar esta operación.')
}
const datoRPC = result => {
  if (!result.error) return result.data
  const status = { '42501': 403, P0002: 404, '22023': 400, '22P02': 400, '23503': 409, '23505': 409, '23514': 409, '23P01': 409, '40001': 409 }[result.error.code] || 502
  const message = {
    400: 'Los datos enviados no son válidos.',
    403: 'No tienes permiso para realizar esta operación.',
    404: 'El recurso no existe o no está disponible en tu clínica.',
    409: 'La operación entra en conflicto con un horario, bloqueo, cita o registro relacionado.',
    502: 'No se pudo completar la operación de la clínica.',
  }[status]
  fallar(status, message)
}
const responderError = (res, error) => {
  if (error instanceof ErrorOperacion) return res.status(error.status).json({ error: error.message })
  return res.status(500).json({ error: 'Error interno al procesar la operación de la clínica.' })
}

module.exports = { fallar, objeto, validarCampos, validarId, texto, booleano, entero, listaIds, fecha, fechaHora, hora, permiso, datoRPC, responderError }
