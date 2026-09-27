const { supabaseAdmin } = require('../config/supabase')

const autenticarUsuario = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Token de autenticación requerido',
      })
    }

    const token = authorization.split(' ')[1]

    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({
        error: 'Token inválido o expirado',
      })
    }

    req.user = user
    req.accessToken = token

    next()
  } catch (error) {
    console.error('Error de autenticación:', error)

    return res.status(500).json({
      error: 'Error interno de autenticación',
    })
  }
}

module.exports = autenticarUsuario