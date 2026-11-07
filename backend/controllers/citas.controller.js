const { fallar, validarCampos, validarId, texto, booleano, listaIds, fechaHora, permiso, datoRPC, responderError } = require('./operacion.shared')

const estadosEditables = ['programada', 'confirmada', 'en_espera', 'no_asistio']
const estadosConsulta = [...estadosEditables, 'en_consulta', 'completada', 'cancelada']

const obtenerCitas = async (req, res) => {
  try {
    validarCampos(req.query, ['inicio', 'fin', 'medico', 'estado'])
    const inicio = req.query.inicio === undefined ? null : fechaHora(req.query.inicio)
    const fin = req.query.fin === undefined ? null : fechaHora(req.query.fin)
    if (inicio && fin && Date.parse(inicio) >= Date.parse(fin)) fallar(400, 'El fin del rango debe ser posterior al inicio.')
    const estado = req.query.estado === undefined ? null : req.query.estado
    if (estado !== null && !estadosConsulta.includes(estado)) fallar(400, 'El filtro de estado no es válido.')
    const citas = datoRPC(await req.supabase.rpc('vettrack_citas', {
      p_inicio: inicio, p_fin: fin,
      p_medico: req.query.medico === undefined ? null : validarId(req.query.medico), p_estado: estado,
    }))
    return res.json(citas)
  } catch (error) { return responderError(res, error) }
}

const obtenerSelectoresCitas = async (req, res) => {
  try { return res.json(datoRPC(await req.supabase.rpc('vettrack_selectores_citas'))) }
  catch (error) { return responderError(res, error) }
}

const guardarCita = async (req, res) => {
  try {
    const id = req.params.id === undefined ? null : validarId(req.params.id)
    validarCampos(req.body, ['id_mascota', 'id_dueno', 'id_medico', 'fecha_inicio', 'motivo', 'servicios', 'forzar_horario', 'estado'])
    if (!id && req.body.estado !== undefined && req.body.estado !== 'programada') {
      fallar(400, 'Las nuevas citas se crean automáticamente como programadas.')
    }
    const datos = {
      id_mascota: validarId(req.body.id_mascota), id_dueno: validarId(req.body.id_dueno),
      id_medico: validarId(req.body.id_medico), fecha_inicio: fechaHora(req.body.fecha_inicio),
      motivo: texto(req.body.motivo, 'El motivo de la cita', 2000),
      servicios: listaIds(req.body.servicios, 1),
      forzar_horario: booleano(req.body.forzar_horario, false),
      ...(!id || req.body.estado !== undefined ? { estado: id ? req.body.estado : 'programada' } : {}),
    }
    if (datos.estado !== undefined && !estadosEditables.includes(datos.estado)) fallar(400, 'Este estado no está disponible en la operación de citas.')
    if (datos.forzar_horario) permiso(req, 'citas.forzar_horario')
    // No specialty is required or compared. SQL validates patient ownership,
    // active doctor membership, schedule, blocks and concurrent appointments.
    // Service snapshots are captured by SQL, never supplied by this caller.
    const cita = datoRPC(await req.supabase.rpc('vettrack_guardar_cita', { p_id: id, p_datos: datos }))
    return res.status(id ? 200 : 201).json({ message: id ? 'Cita actualizada correctamente.' : 'Cita creada correctamente.', cita })
  } catch (error) { return responderError(res, error) }
}

const cancelarCita = async (req, res) => {
  try {
    if (req.body !== undefined) validarCampos(req.body, [])
    const cita = datoRPC(await req.supabase.rpc('vettrack_cancelar_cita', { p_id: validarId(req.params.id) }))
    return res.json({ message: 'Cita cancelada correctamente.', cita })
  } catch (error) { return responderError(res, error) }
}

module.exports = { obtenerCitas, obtenerSelectoresCitas, guardarCita, cancelarCita }
