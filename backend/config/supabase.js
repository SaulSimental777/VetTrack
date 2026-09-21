const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Faltan las variables de entorno de Supabase')
}

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey
)

module.exports = supabase