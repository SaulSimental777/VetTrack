const { randomUUID } = require('node:crypto')
const { supabaseAdmin } = require('../config/supabase')

const camposVeterinaria = 'id_veterinaria, nombre, telefono, direccion, correo'

const representarTenant = (veterinaria, adminEmail) => ({
  id_veterinaria: veterinaria.id_veterinaria,
  nombre: veterinaria.nombre,
  telefono: veterinaria.telefono ?? null,
  direccion: veterinaria.direccion ?? null,
  adminEmail: adminEmail ?? null,
})

class ErrorSolicitud extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const errorOperacion = (status, message) => new ErrorSolicitud(status, message)

const validarAlta = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw errorOperacion(400, 'Los datos de la veterinaria son obligatorios')
  }

  const { nombre, adminEmail, adminPassword, telefono, direccion } = body

  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 150) {
    throw errorOperacion(400, 'El nombre debe contener entre 1 y 150 caracteres')
  }

  if (
    typeof adminEmail !== 'string' ||
    adminEmail.trim().length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())
  ) {
    throw errorOperacion(400, 'El correo del administrador debe ser válido y tener hasta 100 caracteres')
  }

  if (typeof adminPassword !== 'string' || adminPassword.length < 8) {
    throw errorOperacion(400, 'La contraseña del administrador debe tener al menos 8 caracteres')
  }

  if (telefono != null && (typeof telefono !== 'string' || telefono.trim().length > 20)) {
    throw errorOperacion(400, 'El teléfono debe ser texto de hasta 20 caracteres')
  }

  if (direccion != null && typeof direccion !== 'string') {
    throw errorOperacion(400, 'La dirección debe ser texto')
  }

  return {
    nombre: nombre.trim(),
    adminEmail: adminEmail.trim().toLowerCase(),
    // Passwords are intentionally preserved, including leading/trailing spaces.
    adminPassword,
    telefono: telefono?.trim() || null,
    direccion: direccion?.trim() || null,
  }
}

const obtenerTenants = async (req, res) => {
  try {
    const { data: veterinarias, error } = await supabaseAdmin
      .from('veterinaria')
      .select(camposVeterinaria)
      .order('nombre')

    if (error) {
      return res.status(502).json({ error: 'No se pudieron consultar las veterinarias' })
    }

    if (!veterinarias?.length) return res.json([])

    const { data: perfiles, error: perfilesError } = await supabaseAdmin
      .from('perfilusuario')
      .select('id, id_veterinaria')
      .eq('rol', 'admin')
      .in('id_veterinaria', veterinarias.map(({ id_veterinaria }) => id_veterinaria))
      .order('id')

    if (perfilesError) {
      return res.status(502).json({ error: 'No se pudieron consultar los administradores' })
    }

    const administradorPorVeterinaria = new Map()
    for (const perfil of perfiles || []) {
      if (!administradorPorVeterinaria.has(perfil.id_veterinaria)) {
        administradorPorVeterinaria.set(perfil.id_veterinaria, perfil.id)
      }
    }

    const tenants = []
    for (const veterinaria of veterinarias) {
      let adminEmail = null
      const administradorId = administradorPorVeterinaria.get(veterinaria.id_veterinaria)

      if (administradorId) {
        const { data, error: usuarioError } = await supabaseAdmin.auth.admin.getUserById(administradorId)

        if (usuarioError) {
          return res.status(502).json({ error: 'No se pudo consultar el correo de un administrador' })
        }

        adminEmail = data?.user?.email ?? null
      }

      tenants.push(representarTenant(veterinaria, adminEmail))
    }

    return res.json(tenants)
  } catch {
    console.error('No se pudo completar la consulta de veterinarias')
    return res.status(500).json({ error: 'Error interno al consultar las veterinarias' })
  }
}

// Supabase Auth and PostgREST do not share a transaction. Only compensate the
// resources created by this request, deleting Auth first to preserve the link
// if an account cannot be removed.
const revertirAlta = async (veterinariaId, usuarioId) => {
  if (usuarioId) {
    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(usuarioId)
      if (error) throw new Error('cleanup_auth')
    } catch {
      console.error('La reversión del alta no pudo eliminar el usuario recién creado; se conserva la veterinaria')
      return false
    }
  }

  if (veterinariaId) {
    try {
      const { error } = await supabaseAdmin
        .from('veterinaria')
        .delete()
        .eq('id_veterinaria', veterinariaId)
      if (error) throw new Error('cleanup_veterinaria')
    } catch {
      console.error('La reversión del alta no pudo eliminar la veterinaria recién creada')
      return false
    }
  }

  return true
}

const crearTenant = async (req, res) => {
  let veterinariaId = null
  let usuarioId = null

  try {
    const datos = validarAlta(req.body)
    const nuevaVeterinariaId = randomUUID()
    // Keep the server-generated ID even if the insert response is interrupted.
    // Compensation can only target this request's new resource.
    veterinariaId = nuevaVeterinariaId
    const { data: veterinaria, error: veterinariaError } = await supabaseAdmin
      .from('veterinaria')
      .insert({
        id_veterinaria: nuevaVeterinariaId,
        nombre: datos.nombre,
        telefono: datos.telefono,
        direccion: datos.direccion,
        correo: datos.adminEmail,
      })
      .select(camposVeterinaria)
      .single()

    if (veterinariaError || !veterinaria) {
      throw errorOperacion(502, 'No se pudo crear la veterinaria')
    }

    const { data: cuenta, error: cuentaError } = await supabaseAdmin.auth.admin.createUser({
      email: datos.adminEmail,
      password: datos.adminPassword,
      email_confirm: true,
    })

    if (cuentaError || !cuenta?.user?.id) {
      const duplicado = ['email_exists', 'user_already_exists'].includes(cuentaError?.code) ||
        /^(a user with this email address has already been registered|user already registered)$/i.test(cuentaError?.message || '')
      throw errorOperacion(
        duplicado ? 409 : 502,
        duplicado ? 'El correo del administrador ya está registrado' : 'No se pudo crear la cuenta del administrador'
      )
    }
    usuarioId = cuenta.user.id

    // A database trigger may have inserted a default profile for this new user.
    const { error: perfilError } = await supabaseAdmin.from('perfilusuario').upsert({
      id: usuarioId,
      rol: 'admin',
      id_veterinaria: veterinariaId,
    }, { onConflict: 'id' })

    if (perfilError) {
      throw errorOperacion(502, 'No se pudo vincular el administrador con la veterinaria')
    }

    return res.status(201).json({
      message: 'Veterinaria y administrador creados correctamente',
      tenant: representarTenant(veterinaria, cuenta.user.email || datos.adminEmail),
    })
  } catch (error) {
    const revertido = await revertirAlta(veterinariaId, usuarioId)
    if (!revertido) {
      return res.status(502).json({
        error: 'No se pudo completar el alta. La reversión requiere revisión del servidor',
        cleanupPending: true,
      })
    }

    const status = error instanceof ErrorSolicitud ? error.status : 500
    if (status === 500) console.error('No se pudo completar el alta de la veterinaria')

    return res.status(status).json({
      error: status === 500 ? 'Error interno al crear la veterinaria' : error.message,
    })
  }
}

module.exports = { obtenerTenants, crearTenant }
