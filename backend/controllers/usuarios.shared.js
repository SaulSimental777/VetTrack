class ErrorUsuarios extends Error {
  constructor(status, message, flags = {}) {
    super(message)
    this.status = status
    this.flags = flags
  }
}

const fallar = (status, message, flags) => { throw new ErrorUsuarios(status, message, flags) }
const esObjeto = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const uuidValido = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const validarId = id => { if (!uuidValido(id)) fallar(400, 'El identificador debe ser un UUID válido') }
const validarCampos = (body, permitidos) => {
  if (!esObjeto(body) || Object.keys(body).some(clave => !permitidos.includes(clave))) {
    fallar(400, 'Los datos enviados contienen campos no permitidos')
  }
}
const texto = (valor, campo, maximo, obligatorio = true) => {
  if (!obligatorio && valor == null) return null
  if (typeof valor !== 'string' || [...valor.trim()].length > maximo || (obligatorio && !valor.trim())) {
    fallar(400, `${campo} debe ser texto ${obligatorio ? 'obligatorio ' : ''}de hasta ${maximo} caracteres`)
  }
  return valor.trim() || null
}
const validarPassword = password => {
  if (typeof password !== 'string' || [...password].length < 8 ||
    !/\p{Lu}/u.test(password) || !/\p{Ll}/u.test(password) ||
    !/\p{Nd}/u.test(password)) {
    fallar(400, 'Mínimo 8 caracteres, con mayúscula, minúscula y número.')
  }
  return password
}

const correoValido = value => {
  if (typeof value !== 'string') return false
  const email = value.trim()
  const parts = email.split('@')
  if ([...email].length > 100 || parts.length !== 2) return false
  const [local, domain] = parts
  const labels = domain.split('.')
  return [...local].length <= 64 && /^[\p{L}\p{M}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u.test(local) &&
    !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
    labels.length >= 2 && /^[A-Za-z]{2,63}$/.test(labels.at(-1)) &&
    labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
}

const comprobarBD = (resultado, mensaje = 'No se pudo completar la operación de usuarios') => {
  if (!resultado.error) return resultado.data
  const estados = { '42501': 403, P0002: 404, '23514': 409, '22023': 400, '23505': 409, '22P02': 400 }
  const status = estados[resultado.error.code] || 502
  const mensajes = {
    400: 'Los datos enviados no son válidos',
    403: 'No tienes permiso para realizar esta operación',
    404: 'Usuario o recurso no encontrado',
    409: 'La operación entra en conflicto con las reglas de administración de la clínica',
  }
  fallar(status, mensajes[status] || mensaje)
}

// Composite-returning PostgreSQL functions may be encoded by PostgREST as a
// singleton relation. JSONB-returning permission functions remain objects.
const filaRPC = resultado => {
  const data = comprobarBD(resultado)
  if (Array.isArray(data)) {
    if (data.length > 1) fallar(502, 'La operación devolvió un resultado inesperado')
    return data[0] || null
  }
  return data
}

const responderError = (res, error) => {
  if (error instanceof ErrorUsuarios) {
    return res.status(error.status).json({ error: error.message, ...error.flags })
  }
  console.error('No se pudo completar una operación de administración de usuarios')
  return res.status(500).json({ error: 'Error interno al administrar usuarios' })
}

module.exports = { ErrorUsuarios, fallar, esObjeto, uuidValido, validarId, validarCampos, texto, validarPassword, correoValido, comprobarBD, filaRPC, responderError }
