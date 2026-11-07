const { randomUUID } = require('node:crypto')
const { supabaseAdmin } = require('../config/supabase')
const {
  ErrorUsuarios, fallar, esObjeto, uuidValido, validarId, validarCampos,
  texto, validarPassword, correoValido, comprobarBD, filaRPC, responderError,
} = require('./usuarios.shared')

const camposPerfil = 'id, nombre, telefono, rol, activo, id_veterinaria, creado_en, cedula_profesional'
const roles = ['admin', 'recepcionista', 'medico']
const duracionBloqueo = '876000h'

const validarUsuario = (body, creacion, acceso) => {
  validarCampos(body, ['nombre', 'correo', 'telefono', 'rol', 'activo', 'especialidades', 'cedula_profesional', ...(creacion ? ['passwordTemporal', 'permisos'] : [])])
  const nombre = texto(body.nombre, 'El nombre', 100)
  const correo = texto(body.correo, 'El correo', 100).toLowerCase()
  if (!correoValido(correo)) fallar(400, 'Ingresa un correo válido, por ejemplo nombre@veterinaria.com.')
  if (body.activo !== undefined && typeof body.activo !== 'boolean') fallar(400, 'El estado activo debe ser booleano')
  const telefono = texto(body.telefono, 'El teléfono', 20, false)
  if (!roles.includes(body.rol)) fallar(400, 'El rol debe ser admin, recepcionista o medico')
  if (body.rol === 'admin' && acceso.rol !== 'admin') fallar(403, 'Solo un administrador puede asignar el rol admin')
  const especialidades = body.especialidades ?? []
  if (!Array.isArray(especialidades) || especialidades.length > 50 || especialidades.some(id => !uuidValido(id))) {
    fallar(400, 'Las especialidades deben ser una lista de hasta 50 identificadores UUID válidos')
  }
  if (new Set(especialidades.map(id => id.toLowerCase())).size !== especialidades.length) fallar(400, 'No se permiten especialidades repetidas')
  if (body.rol !== 'medico' && especialidades.length) fallar(400, 'Solo los médicos pueden tener especialidades')
  if (creacion) validarPassword(body.passwordTemporal)
  if (body.cedula_profesional !== undefined) {
    if (acceso.rol !== 'admin') fallar(403, 'Solo el administrador puede registrar la cédula de otro médico')
    if (body.rol !== 'medico' || (body.cedula_profesional !== null && (typeof body.cedula_profesional !== 'string' || !/^[0-9]{5,20}$/.test(body.cedula_profesional)))) fallar(400, 'La cédula del médico debe contener de 5 a 20 dígitos')
  }
  return { nombre, correo, telefono, rol: body.rol, especialidades, cedula: body.cedula_profesional, password: body.passwordTemporal, activo: body.activo ?? (creacion ? true : undefined) }
}

const leerCatalogo = async req => comprobarBD(await req.supabase
  .from('permiso').select('clave, modulo, accion, descripcion').order('modulo').order('accion')) || []

const validarOverrides = async (req, overrides, rol, catalogo) => {
  if (!esObjeto(overrides)) fallar(400, 'Los permisos deben ser un objeto de claves y valores booleanos o null')
  const entradas = Object.entries(overrides)
  if (rol === 'admin' && entradas.length) fallar(409, 'El administrador posee todos los permisos y no admite overrides')
  if (entradas.length && req.clinicAccess.rol !== 'admin') fallar(403, 'Solo un administrador puede personalizar permisos')
  if (entradas.some(([, valor]) => typeof valor !== 'boolean' && valor !== null)) fallar(400, 'Los permisos solo aceptan true, false o null')
  if (!entradas.length) return overrides
  const claves = new Set((catalogo || await leerCatalogo(req)).map(permiso => permiso.clave))
  if (entradas.some(([clave]) => !claves.has(clave))) fallar(400, 'Existe una clave de permiso desconocida')
  if (overrides['usuarios.permisos'] === true) fallar(400, 'La gestión de permisos está reservada al administrador')
  return overrides
}

const especialidadesSolicitadas = async (req, ids) => {
  if (!ids.length) return []
  const filas = comprobarBD(await req.supabase.from('especialidad')
    .select('id_especialidad, nombre').eq('id_veterinaria', req.clinicAccess.id_veterinaria).in('id_especialidad', ids)) || []
  if (filas.length !== ids.length) fallar(400, 'Alguna especialidad no pertenece a la clínica o no existe')
  return filas.map(({ id_especialidad, nombre }) => ({ id_especialidad, nombre }))
}

const especialidadesActuales = async (req, perfil) => {
  if (perfil.rol !== 'medico') return []
  const enlaces = comprobarBD(await req.supabase.from('medico_especialidad')
    .select('especialidad(id_especialidad, nombre)').eq('id_usuario', perfil.id)) || []
  return enlaces.flatMap(enlace => Array.isArray(enlace.especialidad) ? enlace.especialidad : [enlace.especialidad])
    .filter(Boolean).map(({ id_especialidad, nombre }) => ({ id_especialidad, nombre }))
}

const ultimoAcceso = (req, cuenta) => req.clinicAccess.permisos.includes('usuarios.ver') && typeof cuenta?.last_sign_in_at === 'string'
  ? cuenta.last_sign_in_at : null

const representarUsuario = (perfil, correo, especialidades, ultimo_acceso = null) => ({
  id: perfil.id,
  nombre: perfil.nombre,
  correo: typeof correo === 'string' ? correo : null,
  telefono: perfil.telefono ?? null,
  rol: perfil.rol,
  activo: perfil.activo === true,
  especialidades,
  creado_en: typeof perfil.creado_en === 'string' ? perfil.creado_en : null,
  ultimo_acceso,
  cedula_profesional: perfil.cedula_profesional ?? null,
})

const autorizarTarget = async (req, id, permiso) => {
  validarId(id)
  const perfil = filaRPC(await req.supabase.rpc('vettrack_autorizar_usuario', { p_id: id, p_permiso: permiso }))
  if (!perfil || perfil.id?.toLowerCase() !== id.toLowerCase() || perfil.id_veterinaria !== req.clinicAccess.id_veterinaria) {
    fallar(404, 'Usuario no encontrado')
  }
  // Never query privileged Auth data until SQL has authorized this exact target.
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(id)
  if (error) fallar(error.status === 404 ? 404 : 502, 'No se pudo consultar la cuenta del usuario')
  const cuenta = data?.user
  if (!cuenta || cuenta.id?.toLowerCase() !== id.toLowerCase() || cuenta.app_metadata?.super_admin === true) fallar(404, 'Usuario no encontrado')
  return { perfil, cuenta }
}

const errorAuth = error => {
  const duplicado = ['email_exists', 'user_already_exists'].includes(error?.code)
  fallar(duplicado ? 409 : 502, duplicado ? 'El correo ya está registrado' : 'No se pudo actualizar la cuenta de acceso')
}

const obtenerUsuarios = async (req, res) => {
  try {
    if (!req.clinicAccess.permisos.includes('usuarios.ver')) fallar(403, 'No tienes permiso para consultar usuarios')
    const perfiles = comprobarBD(await req.supabase.from('perfilusuario').select(camposPerfil)
      .eq('id_veterinaria', req.clinicAccess.id_veterinaria).order('nombre')) || []
    const usuarios = []
    for (const fila of perfiles) {
      try {
        const { perfil, cuenta } = await autorizarTarget(req, fila.id, 'usuarios.ver')
        usuarios.push(representarUsuario(perfil, cuenta.email, await especialidadesActuales(req, perfil), ultimoAcceso(req, cuenta)))
      } catch (error) {
        // SQL and the live Auth check hide any global or removed account.
        if (!(error instanceof ErrorUsuarios) || error.status !== 404) throw error
      }
    }
    return res.json(usuarios)
  } catch (error) { return responderError(res, error) }
}

const crearUsuario = async (req, res) => {
  let nuevaCuentaId = null
  let perfilCreado = false
  try {
    const usuario = validarUsuario(req.body, true, req.clinicAccess)
    if (!usuario.activo) exigirCambioEstado(req, null, false)
    const overrides = await validarOverrides(req, req.body.permisos === undefined ? {} : req.body.permisos, usuario.rol)
    const especialidades = await especialidadesSolicitadas(req, usuario.especialidades)
    // Auth accepts a server-generated ID. Keep it before sending the request so
    // an interrupted response can still be compensated without touching any
    // pre-existing account, including an account with a duplicate email.
    nuevaCuentaId = randomUUID()
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      id: nuevaCuentaId,
      email: usuario.correo,
      password: usuario.password,
      email_confirm: true,
      // Block Auth before a new inactive account can obtain its first session.
      ...(!usuario.activo ? { ban_duration: duracionBloqueo } : {}),
      app_metadata: {
        vettrack_tenant_id: req.clinicAccess.id_veterinaria,
        vettrack_created_by: req.clinicAccess.id,
      },
    })
    if (error || data?.user?.id !== nuevaCuentaId) errorAuth(error)
    let perfil = filaRPC(await req.supabase.rpc('vettrack_crear_usuario', {
      p_id: nuevaCuentaId, p_nombre: usuario.nombre, p_telefono: usuario.telefono,
      p_rol: usuario.rol, p_especialidades: usuario.especialidades, p_overrides: overrides,
    }))
    if (!perfil) fallar(502, 'No se pudo crear el perfil del usuario')
    if (!usuario.activo) {
      const estado = await actualizarEstadoUsuario(req, nuevaCuentaId, false)
      perfil = estado.perfil
    }
    if (usuario.cedula !== undefined) {
      comprobarBD(await req.supabase.rpc('vettrack_usuario_cedula', { p_id: nuevaCuentaId, p_cedula: usuario.cedula }))
      perfil.cedula_profesional = usuario.cedula
    }
    perfilCreado = true
    return res.status(201).json({ message: 'Usuario creado correctamente', usuario: representarUsuario(perfil, data.user.email || usuario.correo, especialidades) })
  } catch (error) {
    if (nuevaCuentaId && !perfilCreado) {
      try {
        const limpieza = await supabaseAdmin.auth.admin.deleteUser(nuevaCuentaId)
        if (limpieza.error && limpieza.error.status !== 404 && limpieza.error.code !== 'user_not_found') throw new Error('cleanup')
      } catch {
        console.error('No se pudo eliminar la cuenta recién creada tras fallar el alta del perfil')
        return res.status(502).json({ error: 'No se pudo completar el alta; la limpieza de la cuenta requiere revisión', cleanupPending: true })
      }
    }
    return responderError(res, error)
  }
}

const editarUsuario = async (req, res) => {
  let correoAnterior
  let correoModificado = false
  let perfilModificado = false
  try {
    validarId(req.params.id)
    const usuario = validarUsuario(req.body, false, req.clinicAccess)
    const { perfil: anterior, cuenta } = await autorizarTarget(req, req.params.id, 'usuarios.editar')
    const cambiaEstado = usuario.activo !== undefined && usuario.activo !== anterior.activo
    if (cambiaEstado) {
      exigirCambioEstado(req, anterior.id, usuario.activo)
      await autorizarTarget(req, anterior.id, 'usuarios.desactivar')
    }
    const especialidades = await especialidadesSolicitadas(req, usuario.especialidades)
    correoAnterior = cuenta.email
    if (!correoAnterior) fallar(409, 'La cuenta no tiene un correo administrable')
    if (usuario.correo !== correoAnterior.toLowerCase()) {
      const resultado = await supabaseAdmin.auth.admin.updateUserById(req.params.id, { email: usuario.correo, email_confirm: true })
      if (resultado.error) errorAuth(resultado.error)
      correoModificado = true
    }
    let perfil = filaRPC(await req.supabase.rpc('vettrack_editar_usuario', {
      p_id: req.params.id, p_nombre: usuario.nombre, p_telefono: usuario.telefono,
      p_rol: usuario.rol, p_especialidades: usuario.especialidades,
    }))
    if (!perfil) fallar(502, 'No se pudo actualizar el perfil del usuario')
    perfilModificado = true
    if (usuario.cedula !== undefined) {
      try {
        comprobarBD(await req.supabase.rpc('vettrack_usuario_cedula', { p_id: perfil.id, p_cedula: usuario.cedula }))
        perfil.cedula_profesional = usuario.cedula
      } catch { fallar(502, 'El perfil se guardó, pero falta confirmar la cédula. Recarga los usuarios antes de continuar.', { syncPending: true }) }
    }
    if (cambiaEstado) {
      try {
        const estado = await actualizarEstadoUsuario(req, perfil.id, usuario.activo)
        perfil = estado.perfil
      } catch {
        fallar(502, 'Los datos del usuario se guardaron, pero no se pudo completar el cambio de estado. Recarga la lista para revisar su estado actual.', { syncPending: true })
      }
    }
    return res.json({ message: 'Usuario actualizado correctamente', usuario: representarUsuario(perfil, usuario.correo, especialidades, ultimoAcceso(req, cuenta)) })
  } catch (error) {
    if (correoModificado && !perfilModificado) {
      try {
        const restauracion = await supabaseAdmin.auth.admin.updateUserById(req.params.id, { email: correoAnterior, email_confirm: true })
        if (restauracion.error) throw new Error('restore_email')
      } catch {
        console.error('No se pudo restaurar el correo tras fallar la actualización del perfil')
        return res.status(502).json({ error: 'No se pudo completar la edición; el correo de acceso requiere revisión', syncPending: true })
      }
    }
    return responderError(res, error)
  }
}

const cambiarPassword = async (req, res) => {
  try {
    validarCampos(req.body, ['nuevaPassword'])
    validarPassword(req.body.nuevaPassword)
    await autorizarTarget(req, req.params.id, 'usuarios.editar')
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, { password: req.body.nuevaPassword })
    if (error) errorAuth(error)
    return res.json({ message: 'Contraseña actualizada correctamente' })
  } catch (error) { return responderError(res, error) }
}

const exigirCambioEstado = (req, id, activo) => {
  if (!req.clinicAccess.permisos.includes('usuarios.desactivar')) fallar(403, 'No tienes permiso para cambiar el estado de usuarios')
  if (!activo && id?.toLowerCase() === req.clinicAccess.id.toLowerCase()) fallar(409, 'No puedes desactivar tu propia cuenta')
}

// Shared by create, edit and the contextual state action. SQL retains the
// existing tenant, capability and last-administrator checks.
const actualizarEstadoUsuario = async (req, id, activo) => {
  let reactivacionAuth = false
  let estadoSQLModificado = false
  let targetAnterior
  let capabilityTargetId = null
  try {
    exigirCambioEstado(req, id, activo)
    const { perfil, cuenta } = await autorizarTarget(req, id, 'usuarios.desactivar')
    targetAnterior = perfil
    const especialidades = await especialidadesActuales(req, perfil)
    // A short-lived capability proves that this transition passed through the
    // backend's Auth synchronization path. SQL checks the live Auth metadata,
    // exact actor, requested state, expiry and nonce before changing the profile.
    const tokenEstado = randomUUID()
    capabilityTargetId = perfil.id
    const emision = await supabaseAdmin.auth.admin.updateUserById(perfil.id, {
      app_metadata: {
        vettrack_state_change: {
          actor_id: req.clinicAccess.id,
          activo,
          nonce: tokenEstado,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        },
      },
    })
    if (emision.error) errorAuth(emision.error)
    // Reactivation unbans while SQL is still inactive. The inverse order would
    // grant database access before Auth has been successfully synchronized.
    if (activo) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(perfil.id, { ban_duration: 'none' })
      if (error) errorAuth(error)
      reactivacionAuth = true
    }
    const actualizado = filaRPC(await req.supabase.rpc('vettrack_estado_usuario', {
      p_id: perfil.id, p_activo: activo, p_token: tokenEstado,
    }))
    if (!actualizado) fallar(502, 'No se pudo actualizar el estado del usuario')
    estadoSQLModificado = true
    if (!activo) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(perfil.id, { ban_duration: duracionBloqueo })
      if (error) {
        // The SQL profile remains inactive, denying access even with an old JWT.
        fallar(502, 'El usuario quedó inactivo; falta sincronizar el bloqueo de acceso', { syncPending: true })
      }
    }
    return { perfil: actualizado, cuenta, especialidades }
  } catch (error) {
    if (reactivacionAuth && !estadoSQLModificado && targetAnterior?.activo === false) {
      try {
        const restauracion = await supabaseAdmin.auth.admin.updateUserById(targetAnterior.id, { ban_duration: duracionBloqueo })
        if (restauracion.error) throw new Error('restore_ban')
      } catch {
        console.error('La reactivación falló; el perfil sigue inactivo pero el bloqueo Auth requiere revisión')
        fallar(502, 'El perfil continúa inactivo; la sincronización de acceso requiere revisión', { syncPending: true })
      }
    }
    if (estadoSQLModificado && activo === false) {
      fallar(502, 'El usuario quedó inactivo; falta sincronizar el bloqueo de acceso', { syncPending: true })
    }
    throw error
  } finally {
    if (capabilityTargetId) {
      try {
        // Auth merges this top-level metadata key, preserving unrelated claims.
        const limpieza = await supabaseAdmin.auth.admin.updateUserById(capabilityTargetId, {
          app_metadata: { vettrack_state_change: null },
        })
        if (limpieza.error) throw new Error('cleanup_capability')
      } catch {
        // Expiry bounds the capability even when cleanup cannot be confirmed.
        // Cleanup must never replace the result of the requested transition.
        console.error('No se pudo limpiar la autorización temporal del cambio de estado')
      }
    }
  }
}

const cambiarEstado = async (req, res) => {
  try {
    validarCampos(req.body, ['activo'])
    if (typeof req.body.activo !== 'boolean') fallar(400, 'El estado activo debe ser booleano')
    const { perfil, cuenta, especialidades } = await actualizarEstadoUsuario(req, req.params.id, req.body.activo)
    return res.json({ message: perfil.activo ? 'Usuario reactivado correctamente' : 'Usuario desactivado correctamente', usuario: representarUsuario(perfil, cuenta.email, especialidades, ultimoAcceso(req, cuenta)) })
  } catch (error) { return responderError(res, error) }
}

const representarPermisos = (catalogo, permisos) => {
  const porRol = new Set(permisos.permisos_rol || [])
  const efectivos = new Set(permisos.permisos_efectivos || [])
  return {
    catalogo,
    porRol: Object.fromEntries(catalogo.map(({ clave }) => [clave, porRol.has(clave)])),
    overrides: permisos.overrides || {},
    efectivos: Object.fromEntries(catalogo.map(({ clave }) => [clave, efectivos.has(clave)])),
  }
}

const obtenerPermisos = async (req, res) => {
  try {
    await autorizarTarget(req, req.params.id, 'usuarios.permisos')
    const permisos = comprobarBD(await req.supabase.rpc('vettrack_ver_permisos_usuario', { p_id: req.params.id }))
    const catalogo = await leerCatalogo(req)
    return res.json(representarPermisos(catalogo, permisos))
  } catch (error) { return responderError(res, error) }
}

const actualizarPermisos = async (req, res) => {
  try {
    const { perfil } = await autorizarTarget(req, req.params.id, 'usuarios.permisos')
    if (perfil.rol === 'admin') fallar(409, 'El administrador posee todos los permisos y no admite overrides')
    const catalogo = await leerCatalogo(req)
    await validarOverrides(req, req.body, perfil.rol, catalogo)
    const permisos = comprobarBD(await req.supabase.rpc('vettrack_permisos_usuario', {
      p_id: req.params.id, p_overrides: req.body, p_restaurar: Object.keys(req.body).length === 0,
    }))
    return res.json({ message: 'Permisos actualizados correctamente', permisos: representarPermisos(catalogo, permisos) })
  } catch (error) { return responderError(res, error) }
}

module.exports = { obtenerUsuarios, crearUsuario, editarUsuario, cambiarPassword, cambiarEstado, obtenerPermisos, actualizarPermisos }
