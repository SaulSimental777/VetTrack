const { createUserClient } = require('../config/supabase')

// Clinic authorization always comes from the database, never editable JWT data.
// Global Superadmin routes continue to use their existing middleware.
const loadClinicAccess = async (req, res, next) => {
  try {
    if (req.user?.app_metadata?.super_admin === true) {
      return res.status(403).json({ error: 'Esta operación requiere una cuenta de clínica.' })
    }
    const client = createUserClient(req.accessToken)
    const { data: profile, error } = await client.from('perfilusuario')
      .select('id, nombre, telefono, rol, activo, id_veterinaria')
      .eq('id', req.user.id).maybeSingle()
    if (error) {
      return res.status(503).json({ error: 'No se pudo verificar el acceso de la clínica. Comprueba que la migración de usuarios esté habilitada.' })
    }
    if (!profile?.id_veterinaria || !['admin', 'recepcionista', 'medico'].includes(profile.rol)) {
      return res.status(403).json({ error: 'La cuenta no tiene un perfil de clínica válido.' })
    }
    if (profile.activo !== true) {
      return res.status(403).json({ error: 'Tu cuenta está inactiva. Contacta al administrador de la clínica.' })
    }
    const { data: permissions, error: permissionsError } = await client.rpc('get_my_permissions')
    if (permissionsError || !Array.isArray(permissions) || permissions.some(value => typeof value !== 'string')) {
      return res.status(503).json({ error: 'No se pudieron verificar los permisos de la cuenta.' })
    }
    req.supabase = client
    req.clinicAccess = { ...profile, permisos: permissions }
    return next()
  } catch {
    return res.status(503).json({ error: 'No se pudo verificar el acceso a la clínica.' })
  }
}

const requireAnyPermission = (...keys) => (req, res, next) => {
  const authorize = () => {
    if (!keys.some(key => req.clinicAccess.permisos.includes(key))) {
      return res.status(403).json({ error: 'No tienes permiso para realizar esta operación.' })
    }
    return next()
  }
  return req.clinicAccess ? authorize() : loadClinicAccess(req, res, authorize)
}

const requirePermission = key => requireAnyPermission(key)

module.exports = { loadClinicAccess, requirePermission, requireAnyPermission }
