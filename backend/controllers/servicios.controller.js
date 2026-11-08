const { fallar, validarCampos, validarId, texto, booleano, entero, listaIds, permiso, datoRPC, responderError } = require('./operacion.shared')

const obtenerServicios = async (req, res) => {
  try { return res.json(datoRPC(await req.supabase.rpc('vettrack_servicios'))) }
  catch (error) { return responderError(res, error) }
}

const guardarServicio = async (req, res) => {
  try {
    const id = req.params.id === undefined ? null : validarId(req.params.id)
    validarCampos(req.body, ['nombre', 'descripcion', 'costo', 'duracion_minutos', 'activo', 'especialidades'])
    if (!Object.keys(req.body).length) fallar(400, 'Indica los datos del servicio.')
    if (id && Object.keys(req.body).some(key => key !== 'costo')) permiso(req, 'servicios.editar')
    const datos = {}
    if (!id || Object.hasOwn(req.body, 'nombre')) datos.nombre = texto(req.body.nombre, 'El nombre del servicio', 100, true)
    if (Object.hasOwn(req.body, 'descripcion')) datos.descripcion = texto(req.body.descripcion, 'La descripción', 5000)
    if (Object.hasOwn(req.body, 'costo')) {
      const costo = req.body.costo
      if (typeof costo !== 'number' || !Number.isFinite(costo) || costo < 0 || costo > 99999999.99 || Math.abs(costo * 100 - Math.round(costo * 100)) > 0.000001) {
        fallar(400, 'El costo debe ser un número entre 0 y 99999999.99, con hasta dos decimales.')
      }
      if (!id && costo !== 0) permiso(req, 'servicios.editar_precio')
      datos.costo = costo
    }
    if (Object.hasOwn(req.body, 'duracion_minutos')) datos.duracion_minutos = entero(req.body.duracion_minutos, 1, 1440, 'La duración')
    if (Object.hasOwn(req.body, 'activo')) datos.activo = booleano(req.body.activo)
    if (Object.hasOwn(req.body, 'especialidades')) datos.especialidades = listaIds(req.body.especialidades)
    // SQL compares the stored price with the requested one under the clinic
    // lock. An editor may resend an unchanged price without price permission.
    const servicio = datoRPC(await req.supabase.rpc('vettrack_guardar_servicio', { p_id: id, p_datos: datos }))
    return res.status(id ? 200 : 201).json({ message: id ? 'Servicio actualizado correctamente.' : 'Servicio creado correctamente.', servicio })
  } catch (error) { return responderError(res, error) }
}

const eliminarServicio = async (req, res) => {
  try {
    const eliminado = datoRPC(await req.supabase.rpc('vettrack_eliminar_servicio', { p_id: validarId(req.params.id) }))
    if (!eliminado) fallar(404, 'Servicio no encontrado.')
    return res.json({ message: 'Servicio desactivado correctamente; se conserva su historial.' })
  } catch (error) { return responderError(res, error) }
}

module.exports = { obtenerServicios, guardarServicio, eliminarServicio }
