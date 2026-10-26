// auth.js must validate the token with auth.getUser before this middleware runs.
// app_metadata is managed by the server; user_metadata cannot grant this access.
const exigirSuperAdmin = (req, res, next) => {
  if (req.user?.app_metadata?.super_admin !== true) {
    return res.status(403).json({ error: 'Se requiere acceso de Superadmin' })
  }

  return next()
}

module.exports = exigirSuperAdmin
