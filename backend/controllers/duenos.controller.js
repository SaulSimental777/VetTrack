const { createUserClient } = require('../config/supabase')

const obtenerDuenos = async (req, res) => {
  try {
    const supabase = createUserClient(req.accessToken)

    const { data, error } = await supabase
      .from('dueno')
      .select('id_dueno, nombre, telefono, correo, direccion')
      .order('nombre')

    if (error) {
      return res.status(400).json({
        error: error.message,
      })
    }

    return res.json(data)
  } catch (error) {
    console.error('Error al obtener dueños:', error)

    return res.status(500).json({
      error: 'Error interno del servidor',
    })
  }
}

const crearDueno = async (req, res) => {
  try {
    const { nombre, telefono, correo, direccion } = req.body

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        error: 'El nombre es obligatorio',
      })
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
        nombre: nombre.trim(),
        telefono: telefono?.trim() || null,
        correo: correo?.trim() || null,
        direccion: direccion?.trim() || null,
        id_veterinaria: perfil.id_veterinaria,
      })
      .select('id_dueno, nombre, telefono, correo, direccion')
      .single()

    if (error) {
      return res.status(400).json({
        error: error.message,
      })
    }

    return res.status(201).json(data)
  } catch (error) {
    console.error('Error al crear dueño:', error)

    return res.status(500).json({
      error: 'Error interno del servidor',
    })
  }
}

const actualizarDueno = async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, telefono, correo, direccion } = req.body

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        error: 'El nombre es obligatorio',
      })
    }

    const supabase = createUserClient(req.accessToken)

    const { data, error } = await supabase
      .from('dueno')
      .update({
        nombre: nombre.trim(),
        telefono: telefono?.trim() || null,
        correo: correo?.trim() || null,
        direccion: direccion?.trim() || null,
      })
      .eq('id_dueno', id)
      .select('id_dueno, nombre, telefono, correo, direccion')
      .maybeSingle()

    if (error) {
      return res.status(400).json({
        error: error.message,
      })
    }

    if (!data) {
      return res.status(404).json({
        error: 'Dueño no encontrado',
      })
    }

    return res.json(data)
  } catch (error) {
    console.error('Error al actualizar dueño:', error)

    return res.status(500).json({
      error: 'Error interno del servidor',
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

    if (error) {
      return res.status(400).json({
        error: error.message,
      })
    }

    if (!data) {
      return res.status(404).json({
        error: 'Dueño no encontrado',
      })
    }

    return res.json({
      mensaje: 'Dueño eliminado correctamente',
    })
  } catch (error) {
    console.error('Error al eliminar dueño:', error)

    return res.status(500).json({
      error: 'Error interno del servidor',
    })
  }
}

module.exports = {
  obtenerDuenos,
  crearDueno,
  actualizarDueno,
  eliminarDueno,
}