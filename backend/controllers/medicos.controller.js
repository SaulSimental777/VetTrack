const {
  fallar, validarCampos, validarId, texto, booleano, entero, listaIds,
  fecha, fechaHora, hora, datoRPC, responderError,
} = require('./operacion.shared')

const obtenerMedicos = async (req, res) => {
  try {
    validarCampos(req.query, ['q', 'especialidad', 'activo'])
    let activo = null
    if (req.query.activo !== undefined) {
      if (!['true', 'false'].includes(req.query.activo)) fallar(400, 'El filtro activo debe ser true o false.')
      activo = req.query.activo === 'true'
    }
    const medicos = datoRPC(await req.supabase.rpc('vettrack_medicos', {
      p_q: texto(req.query.q, 'La búsqueda', 100),
      p_especialidad: req.query.especialidad === undefined ? null : validarId(req.query.especialidad),
      p_activo: activo,
    }))
    return res.json(medicos)
  } catch (error) { return responderError(res, error) }
}

const obtenerHorarios = async (req, res) => {
  try {
    const horarios = datoRPC(await req.supabase.rpc('vettrack_horarios', { p_medico: validarId(req.params.id) }))
    return res.json(horarios)
  } catch (error) { return responderError(res, error) }
}

const guardarHorarios = async (req, res) => {
  try {
    const medico = validarId(req.params.id)
    validarCampos(req.body, ['bloques'])
    if (!Array.isArray(req.body.bloques) || req.body.bloques.length > 100) fallar(400, 'Los horarios deben ser una lista de hasta 100 bloques.')
    const bloques = req.body.bloques.map(bloque => {
      validarCampos(bloque, ['dia_semana', 'hora_inicio', 'hora_fin', 'activo'])
      const data = {
        dia_semana: entero(bloque.dia_semana, 0, 6, 'El día de la semana'),
        hora_inicio: hora(bloque.hora_inicio), hora_fin: hora(bloque.hora_fin),
        activo: booleano(bloque.activo, true),
      }
      if (data.hora_inicio >= data.hora_fin) fallar(400, 'El inicio de cada bloque debe ser anterior al fin en el mismo día.')
      return data
    })
    const activos = bloques.filter(bloque => bloque.activo).sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio))
    for (let i = 1; i < activos.length; i += 1) {
      if (activos[i].dia_semana === activos[i - 1].dia_semana && activos[i].hora_inicio < activos[i - 1].hora_fin) {
        fallar(409, 'No se permiten bloques de horario solapados para el mismo día.')
      }
    }
    const horarios = datoRPC(await req.supabase.rpc('vettrack_guardar_horarios', { p_medico: medico, p_bloques: bloques }))
    return res.json({ message: 'Horario guardado correctamente.', horarios })
  } catch (error) { return responderError(res, error) }
}

const obtenerBloqueos = async (req, res) => {
  try {
    const bloqueos = datoRPC(await req.supabase.rpc('vettrack_bloqueos', { p_medico: validarId(req.params.id) }))
    return res.json(bloqueos)
  } catch (error) { return responderError(res, error) }
}

const crearBloqueo = async (req, res) => {
  try {
    const medico = validarId(req.params.id)
    validarCampos(req.body, ['fecha_inicio', 'fecha_fin', 'motivo', 'tipo'])
    const datos = {
      fecha_inicio: fechaHora(req.body.fecha_inicio), fecha_fin: fechaHora(req.body.fecha_fin),
      motivo: texto(req.body.motivo, 'El motivo del bloqueo', 2000),
      tipo: req.body.tipo === undefined ? 'manual' : req.body.tipo,
    }
    if (!['vacaciones', 'comida', 'cirugia', 'ausencia', 'manual'].includes(datos.tipo)) fallar(400, 'El tipo de bloqueo no es válido.')
    if (Date.parse(datos.fecha_fin) <= Date.parse(datos.fecha_inicio)) fallar(400, 'El fin del bloqueo debe ser posterior al inicio.')
    const bloqueo = datoRPC(await req.supabase.rpc('vettrack_guardar_bloqueo', { p_medico: medico, p_datos: datos }))
    return res.status(201).json({ message: 'Bloqueo creado correctamente.', bloqueo })
  } catch (error) { return responderError(res, error) }
}

const eliminarBloqueo = async (req, res) => {
  try {
    const eliminado = datoRPC(await req.supabase.rpc('vettrack_eliminar_bloqueo', {
      p_medico: validarId(req.params.id), p_id: validarId(req.params.idBloqueo),
    }))
    if (!eliminado) fallar(404, 'Bloqueo no encontrado.')
    return res.json({ message: 'Bloqueo eliminado correctamente.' })
  } catch (error) { return responderError(res, error) }
}

const obtenerDisponibilidad = async (req, res) => {
  try {
    validarCampos(req.query, ['fecha', 'duracion_minutos', 'servicios', 'excluir_cita'])
    const medico = validarId(req.params.id)
    const fechaSolicitada = fecha(req.query.fecha)
    let duracion = 30
    if (req.query.duracion_minutos !== undefined) {
      if (typeof req.query.duracion_minutos !== 'string' || !/^\d+$/.test(req.query.duracion_minutos)) fallar(400, 'La duración solicitada no es válida.')
      duracion = entero(Number(req.query.duracion_minutos), 1, 1440, 'La duración')
    }
    let servicios = null
    if (req.query.servicios !== undefined) {
      if (typeof req.query.servicios !== 'string') fallar(400, 'Los servicios deben ser UUID separados por comas.')
      servicios = listaIds(req.query.servicios.split(','), 1)
    }
    const disponibilidad = datoRPC(await req.supabase.rpc('vettrack_disponibilidad', {
      p_medico: medico, p_fecha: fechaSolicitada, p_duracion: duracion, p_servicios: servicios,
      p_excluir_cita: req.query.excluir_cita === undefined ? null : validarId(req.query.excluir_cita),
    }))
    return res.json(disponibilidad)
  } catch (error) { return responderError(res, error) }
}

module.exports = { obtenerMedicos, obtenerHorarios, guardarHorarios, obtenerBloqueos, crearBloqueo, eliminarBloqueo, obtenerDisponibilidad }
