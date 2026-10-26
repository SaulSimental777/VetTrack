const path = require('node:path')
const { Writable } = require('node:stream')
const { createInterface } = require('node:readline/promises')

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { supabaseAdmin } = require('../config/supabase')

// La contraseña se introduce en la terminal sin eco y nunca se escribe a disco.
async function leerEntrada(pregunta, oculta = false) {
  const output = oculta
    ? new Writable({ write(_chunk, _encoding, callback) { callback() } })
    : process.stdout
  const interfaz = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  })

  try {
    if (oculta) process.stdout.write(pregunta)
    return await interfaz.question(oculta ? '' : pregunta)
  } finally {
    interfaz.close()
    if (oculta) process.stdout.write('\n')
  }
}

async function crearSuperadmin() {
  if (!process.stdin.isTTY) {
    throw new Error('Ejecuta este comando en una terminal interactiva; no acepta contraseñas por argumentos ni archivos.')
  }

  const email = (process.argv[2] || await leerEntrada('Correo del Superadmin: '))
    .trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    throw new Error('Indica un correo válido de hasta 100 caracteres.')
  }

  let existente
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw new Error('No se pudieron consultar las cuentas de Supabase. Revisa la conexión y la clave administrativa.')
    existente = data.users.find(user => user.email?.toLowerCase() === email)
    if (existente || data.users.length < 100) break
  }

  if (existente) {
    const { data: perfil, error } = await supabaseAdmin
      .from('perfilusuario')
      .select('id_veterinaria')
      .eq('id', existente.id)
      .maybeSingle()
    if (error) throw new Error('No se pudo comprobar la membresía de la cuenta; no se cambiaron sus permisos.')
    if (perfil?.id_veterinaria) {
      throw new Error('Esta cuenta pertenece a una clínica. Usa un correo independiente para el Superadmin.')
    }
    if (existente.app_metadata?.super_admin === true) {
      console.log('La cuenta ya es Superadmin. Inicia sesión desde el login habitual.')
      return
    }
    throw new Error('El correo ya está registrado sin permiso Superadmin. Usa un correo nuevo; este comando conserva los permisos de cuentas existentes.')
  }

  const password = await leerEntrada('Contraseña (mínimo 8 caracteres): ', true)
  const confirmacion = await leerEntrada('Repite la contraseña: ', true)
  if (password.length < 8 || password !== confirmacion) {
    throw new Error('Las contraseñas deben coincidir y tener al menos 8 caracteres.')
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { super_admin: true },
  })
  if (error || !data.user) {
    throw new Error('No se pudo crear el Superadmin. Comprueba los requisitos de contraseña de Supabase y que el correo esté disponible.')
  }

  console.log(`Superadmin creado: ${email}. Usa el mismo login de VetTrack para abrir el panel global.`)
}

crearSuperadmin().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
