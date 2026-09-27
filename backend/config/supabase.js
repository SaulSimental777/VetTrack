const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  throw new Error('Faltan variables de entorno de Supabase')
}

// Cliente administrativo.
// SOLO para operaciones internas específicas.
// Nunca debe usarse directamente para los CRUD normales.
const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

// Crea un cliente de Supabase utilizando el JWT del usuario.
// De esta forma PostgreSQL puede aplicar las políticas RLS.
const createUserClient = (accessToken) => {
  return createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}

module.exports = {
  supabaseAdmin,
  createUserClient,
}