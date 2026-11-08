const { createUserClient } = require('../config/supabase')

const validarPropietario = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.nombre !== 'string' || !body.nombre.trim()) {
    return { error: 'El nombre es obligatorio y debe ser un texto no vacío.' }
  }

  for (const campo of ['telefono', 'correo', 'direccion']) {
    if (body[campo] !== undefined && typeof body[campo] !== 'string') {
      return { error: `El campo ${campo} debe ser un texto.` }
    }
  }

  const correo = body.correo?.trim() || null
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return { error: 'El correo debe tener un formato válido.' }
  }

  // Lista explícita: nunca copiar tenant, rol o identidad desde req.body.
  return { data: {
    nombre: body.nombre.trim(),
    telefono: body.telefono?.trim() || null,
    correo,
    direccion: body.direccion?.trim() || null,
  } }
}

const obtenerDuenos = async (req, res) => {
  try {
    if (req.query?.resumen === '1') {
      const { texto, entero, datoRPC, responderError } = require('./operacion.shared')
      try {
        const offset = req.query.offset === undefined ? 0 : Number(req.query.offset)
        const data = { q: texto(req.query.q, 'La búsqueda', 150), offset: entero(offset, 0, 100000, 'La página') }
        const result = await (req.supabase || createUserClient(req.accessToken)).rpc('vettrack_plataforma', { p_operacion: 'propietarios_resumen', p_datos: data })
        return res.json(datoRPC(result))
      } catch (error) { return responderError(res, error) }
    }
    const supabase = createUserClient(req.accessToken)

    const { data, error } = await supabase
      .from('dueno')
      .select('id_dueno, nombre, telefono, correo, direccion')
      .order('nombre')

    if (error) {
      console.error('Error en operación de propietarios:', error)
      return res.status(400).json({
        error: 'No se pudieron consultar los propietarios.',
      })
    }

    return res.json(data)
  } catch (error) {
    console.error('Error al obtener dueños:', error)

    return res.status(500).json({
      error: 'No se pudieron consultar los propietarios.',
    })
  }
}

const crearDueno = async (req, res) => {
  try {
    const validated = validarPropietario(req.body)
    if (validated.error) {
      return res.status(400).json({ error: validated.error })
    }

    const supabase = createUserClient(req.accessToken)

    // Obtenemos el tenant desde el usuario autenticado.
    // No confiamos en un id_veterinaria enviado por el frontend.
    const { data: perfil, error: perfilError } = await supabase
      .from('perfilusuario')
      .select('id_veterinaria')
      .eq('id', req.user.id)
      .single()

    if (perfilError || !perfil?.id_veterinaria) {
      return res.status(403).json({
        error: 'El usuario no tiene una veterinaria asignada',
      })
    }

    const { data, error } = await supabase
      .from('dueno')
      .insert({
        ...validated.data,
        id_veterinaria: perfil.id_veterinaria,
      })
      .select('id_dueno, nombre, telefono, correo, direccion')
      .single()

    if (error) {
      console.error('Error en operación de propietarios:', error)
      return res.status(400).json({
        error: 'No se pudo registrar el propietario.',
      })
    }

    return res.status(201).json(data)
  } catch (error) {
    console.error('Error al crear dueño:', error)

    return res.status(500).json({
      error: 'No se pudo registrar el propietario.',
    })
  }
}

const actualizarDueno = async (req, res) => {
  try {
    const { id } = req.params
    const validated = validarPropietario(req.body)
    if (validated.error) {
      return res.status(400).json({ error: validated.error })
    }

    const supabase = createUserClient(req.accessToken)

    const { data, error } = await supabase
      .from('dueno')
      .update({
        ...validated.data,
      })
      .eq('id_dueno', id)
      .select('id_dueno, nombre, telefono, correo, direccion')
      .maybeSingle()

    if (error) {
      console.error('Error en operación de propietarios:', error)
      return res.status(400).json({
        error: 'No se pudo actualizar el propietario.',
      })
    }

    if (!data) {
      return res.status(404).json({
        error: 'Propietario no encontrado',
      })
    }

    return res.json(data)
  } catch (error) {
    console.error('Error al actualizar dueño:', error)

    return res.status(500).json({
      error: 'No se pudo actualizar el propietario.',
    })
  }
}

const eliminarDueno = async (req, res) => {
  try {
    const { id } = req.params

    const supabase = createUserClient(req.accessToken)

    const { data, error } = await supabase
      .from('dueno')
      .delete()
      .eq('id_dueno', id)
      .select('id_dueno')
      .maybeSingle()

    if (error?.code === '23503') {
      return res.status(409).json({ error: 'No se puede eliminar el propietario porque tiene pacientes o información relacionada.' })
    }
    if (error) {
      console.error('Error en operación de propietarios:', error)
      return res.status(400).json({
        error: 'No se pudo eliminar el propietario.',
      })
    }

    if (!data) {
      return res.status(404).json({
        error: 'Propietario no encontrado',
      })
    }

    return res.json({
      mensaje: 'Propietario eliminado correctamente',
    })
  } catch (error) {
    console.error('Error al eliminar dueño:', error)

    return res.status(500).json({
      error: 'No se pudo eliminar el propietario.',
    })
  }
}

module.exports = {
  obtenerDuenos,
  crearDueno,
  actualizarDueno,
  eliminarDueno,
}
