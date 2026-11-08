const { validarId, validarCampos, texto, comprobarBD, filaRPC, responderError, fallar } = require('./usuarios.shared')

const representar = fila => ({ id_especialidad: fila.id_especialidad, nombre: fila.nombre, descripcion: fila.descripcion ?? null })

const obtenerEspecialidades = async (req, res) => {
  try {
    const filas = comprobarBD(await req.supabase.from('especialidad').select('id_especialidad, nombre, descripcion')
      .eq('id_veterinaria', req.clinicAccess.id_veterinaria).order('nombre')) || []
    return res.json(filas.map(representar))
  } catch (error) { return responderError(res, error) }
}

const guardarEspecialidad = async (req, res) => {
  try {
    const creacion = !req.params.id
    if (!creacion) validarId(req.params.id)
    validarCampos(req.body, ['nombre', 'descripcion'])
    const nombre = texto(req.body.nombre, 'El nombre de la especialidad', 100)
    const descripcion = texto(req.body.descripcion, 'La descripción', 2000, false)
    const fila = filaRPC(await req.supabase.rpc('vettrack_guardar_especialidad', {
      p_nombre: nombre, p_descripcion: descripcion, p_id: req.params.id || null,
    }))
    if (!fila) fallar(404, 'Especialidad no encontrada')
    return res.status(creacion ? 201 : 200).json(representar(fila))
  } catch (error) { return responderError(res, error) }
}

module.exports = { obtenerEspecialidades, guardarEspecialidad }
