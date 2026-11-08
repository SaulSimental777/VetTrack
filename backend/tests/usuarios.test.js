const assert = require('node:assert/strict')
const { beforeEach, test } = require('node:test')
const Module = require('node:module')

// No .env, network, real Auth clients or remote database are used here.
const state = { planned: [], calls: [] }
const plan = (kind, name, result = { data: null, error: null }, check) => state.planned.push({ kind, name, result, check })
const execute = async (kind, name, args) => {
  state.calls.push({ kind, name, args })
  const expected = state.planned.shift()
  assert.ok(expected, `Unexpected ${kind} ${name}`)
  assert.equal(kind, expected.kind)
  assert.equal(name, expected.name)
  expected.check?.(args)
  if (expected.result instanceof Error) throw expected.result
  return expected.result
}

const client = {
  rpc(name, args) { return execute('rpc', name, args) },
  from(table) {
    const methods = []
    const builder = {}
    for (const method of ['select', 'eq', 'in', 'order']) {
      builder[method] = (...args) => { methods.push({ method, args }); return builder }
    }
    builder.then = (resolve, reject) => execute('table', table, methods).then(resolve, reject)
    return builder
  },
}
const supabaseAdmin = { auth: { admin: Object.fromEntries(
  ['getUserById', 'createUser', 'updateUserById', 'deleteUser'].map(name => [name, (...args) => execute('auth', name, args)])
) } }
const configPath = require.resolve('../config/supabase')
const mocked = new Module(configPath)
mocked.loaded = true
mocked.filename = configPath
mocked.exports = { supabaseAdmin, createUserClient: () => { throw new Error('Unexpected client creation in controller unit test') } }
require.cache[configPath] = mocked

const actor = '10000000-0000-4000-8000-000000000001'
const tenant = '20000000-0000-4000-8000-000000000001'
const otherTenant = '20000000-0000-4000-8000-000000000002'
const target = '30000000-0000-4000-8000-000000000001'
const specialty = '40000000-0000-4000-8000-000000000001'
const stateNonce = '50000000-0000-4000-8000-000000000001'
let nextRandomUUID = target
let uuidQueue = []
const crypto = require('node:crypto')
const originalUUID = crypto.randomUUID
crypto.randomUUID = () => uuidQueue.length ? uuidQueue.shift() : nextRandomUUID
const handlers = require('../controllers/usuarios.controller')
crypto.randomUUID = originalUUID
const specialties = require('../controllers/especialidades.controller')
const profile = (changes = {}) => ({ id: target, nombre: 'Persona', telefono: null, rol: 'recepcionista', activo: true, id_veterinaria: tenant, ...changes })
const authUser = (changes = {}) => ({ id: target, email: 'persona@example.com', app_metadata: {}, ...changes })
const body = (changes = {}) => ({ nombre: ' Persona ', correo: ' Persona@example.com ', telefono: '', rol: 'recepcionista', especialidades: [], ...changes })
const request = (data, changes = {}) => ({
  body: data, params: { id: target }, supabase: client,
  clinicAccess: { id: actor, id_veterinaria: tenant, activo: true, rol: 'admin', permisos: ['usuarios.ver', 'usuarios.crear', 'usuarios.editar', 'usuarios.desactivar', 'usuarios.permisos'] },
  ...changes,
})
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this },
  json(value) { this.body = value; return this },
})
const guard = (permission, perfil = profile(), cuenta = authUser()) => {
  plan('rpc', 'vettrack_autorizar_usuario', { data: perfil, error: null }, args => {
    assert.equal(args.p_id, target)
    assert.equal(args.p_permiso, permission)
  })
  plan('auth', 'getUserById', { data: { user: cuenta }, error: null }, args => assert.deepEqual(args, [target]))
}
const catalog = [
  { clave: 'pacientes.ver', modulo: 'pacientes', accion: 'ver', descripcion: 'Ver pacientes' },
  { clave: 'pacientes.eliminar', modulo: 'pacientes', accion: 'eliminar', descripcion: 'Eliminar pacientes' },
  { clave: 'usuarios.permisos', modulo: 'usuarios', accion: 'permisos', descripcion: 'Administrar permisos' },
]
const permisos = { rol: 'recepcionista', permisos_rol: ['pacientes.ver'], overrides: { 'pacientes.eliminar': true }, permisos_efectivos: ['pacientes.ver', 'pacientes.eliminar'] }
const planCatalog = () => plan('table', 'permiso', { data: catalog, error: null })
const noSecrets = value => assert.doesNotMatch(JSON.stringify(value), /private upstream|supersecret|service_role|access_token|refresh_token|password_hash/)

beforeEach(() => { state.planned = []; state.calls = []; nextRandomUUID = target; uuidQueue = [] })

const issueCapability = (activo, result = { error: null }) => {
  nextRandomUUID = stateNonce
  plan('auth', 'updateUserById', result, ([id, input]) => {
    assert.equal(id, target)
    assert.deepEqual(Object.keys(input), ['app_metadata'])
    assert.deepEqual(Object.keys(input.app_metadata), ['vettrack_state_change'])
    const capability = input.app_metadata.vettrack_state_change
    assert.equal(capability.actor_id, actor)
    assert.equal(capability.activo, activo)
    assert.equal(capability.nonce, stateNonce)
    const remaining = Date.parse(capability.expires_at) - Date.now()
    assert.ok(remaining > 59000 && remaining <= 60000)
  })
}
const clearCapability = (result = { error: null }) => plan('auth', 'updateUserById', result, args => {
  assert.deepEqual(args, [target, { app_metadata: { vettrack_state_change: null } }])
})

test('create rejects unexpected tenant/global fields, invalid types, limits, IDs and weak passwords before Auth', async () => {
  const invalid = [
    null, [], body({ id_veterinaria: otherTenant }), body({ app_metadata: { super_admin: true } }),
    body({ nombre: 'x'.repeat(101) }), body({ nombre: 123 }), body({ correo: 'bad' }),
    body({ telefono: 'x'.repeat(21) }), body({ telefono: [] }), body({ rol: 'user' }), body({ rol: 'experto' }),
    body({ especialidades: ['not-uuid'] }), body({ especialidades: [specialty], rol: 'admin' }),
    body({ especialidades: [specialty, specialty], rol: 'medico' }),
  ].map(value => value && !Array.isArray(value) ? { ...value, passwordTemporal: 'StrongPassword12!' } : value)
  invalid.push(...['Short1!', 'lowercasepassword12!', 'UPPERCASEPASSWORD12!', 'NoDigitsPassword!', 123456789012].map(passwordTemporal => body({ passwordTemporal })))
  for (const invalidBody of invalid) {
    const res = response()
    await handlers.crearUsuario(request(invalidBody), res)
    assert.equal(res.statusCode, 400)
    assert.equal(state.calls.length, 0)
  }
})

test('create derives trusted metadata from clinic access, preserves Unicode password and uses one JWT RPC for profile assignments', async () => {
  const passwordTemporal = '  Áa١!contraseñaSegura  '
  plan('auth', 'createUser', { data: { user: authUser() }, error: null }, ([input]) => {
    assert.deepEqual(input, {
      id: target, email: 'persona@example.com', password: passwordTemporal, email_confirm: true,
      app_metadata: { vettrack_tenant_id: tenant, vettrack_created_by: actor },
    })
  })
  plan('rpc', 'vettrack_crear_usuario', { data: profile(), error: null }, args => assert.deepEqual(args, {
    p_id: target, p_nombre: 'Persona', p_telefono: null, p_rol: 'recepcionista', p_especialidades: [], p_overrides: {},
  }))
  const res = response()
  await handlers.crearUsuario(request(body({ passwordTemporal })), res)
  assert.equal(res.statusCode, 201)
  assert.deepEqual(res.body.usuario, { id: target, nombre: 'Persona', correo: 'persona@example.com', telefono: null, rol: 'recepcionista', activo: true, especialidades: [], creado_en: null, ultimo_acceso: null, cedula_profesional: null })
  assert.ok(!JSON.stringify(res.body).includes(passwordTemporal))
  assert.ok(!JSON.stringify(res.body).includes('app_metadata'))
  assert.equal(state.planned.length, 0)
})

test('admin can register a doctor license without exposing Auth data', async () => {
 plan('auth','createUser',{data:{user:authUser()},error:null})
 plan('rpc','vettrack_crear_usuario',{data:profile({rol:'medico'}),error:null})
 plan('rpc','vettrack_usuario_cedula',{data:{id:target,cedula_profesional:'12345678'},error:null},args=>assert.deepEqual(args,{p_id:target,p_cedula:'12345678'}))
 const res=response();await handlers.crearUsuario(request(body({rol:'medico',passwordTemporal:'Vettrack123',cedula_profesional:'12345678'})),res)
 assert.equal(res.statusCode,201);assert.equal(res.body.usuario.cedula_profesional,'12345678');noSecrets(res.body)
})
test('doctor license rejects invalid values and delegated actors before Auth mutation', async () => {
 for(const value of ['ABC','1234','1'.repeat(21)]){
  const res=response();await handlers.crearUsuario(request(body({rol:'medico',passwordTemporal:'Vettrack123',cedula_profesional:value})),res);assert.equal(res.statusCode,400)
 }
 const res=response();const req=request(body({rol:'medico',cedula_profesional:'12345678'}));req.clinicAccess.rol='recepcionista';await handlers.editarUsuario(req,res);assert.equal(res.statusCode,403);assert.deepEqual(state.calls,[])
})
test('license failure after profile edit reports partial synchronization safely', async () => {
 guard('usuarios.editar',profile({rol:'medico'}));plan('rpc','vettrack_editar_usuario',{data:profile({rol:'medico'}),error:null});plan('rpc','vettrack_usuario_cedula',{data:null,error:{code:'42501',message:'private upstream'}})
 const res=response();await handlers.editarUsuario(request(body({rol:'medico',cedula_profesional:'12345678'})),res);assert.equal(res.statusCode,502);assert.equal(res.body.syncPending,true);noSecrets(res.body)
})

test('delegated creators cannot create admins or grant overrides before an Auth account is made', async () => {
  const delegated = { id: actor, id_veterinaria: tenant, activo: true, rol: 'recepcionista', permisos: ['usuarios.crear'] }
  for (const changes of [{ rol: 'admin' }, { permisos: { 'pacientes.ver': true } }]) {
    const res = response()
    await handlers.crearUsuario(request(body({ passwordTemporal: 'StrongPassword12!', ...changes }), { clinicAccess: delegated }), res)
    assert.equal(res.statusCode, 403)
    assert.equal(state.calls.length, 0)
  }
})

test('create rejects unknown permissions and cross-tenant specialties before Auth', async () => {
  planCatalog()
  const permissionsRes = response()
  await handlers.crearUsuario(request(body({ passwordTemporal: 'StrongPassword12!', permisos: { 'global.superadmin': true } })), permissionsRes)
  assert.equal(permissionsRes.statusCode, 400)
  assert.ok(state.calls.every(call => call.kind !== 'auth'))

  plan('table', 'especialidad', { data: [], error: null }, methods => {
    assert.ok(methods.some(call => call.method === 'eq' && call.args[0] === 'id_veterinaria' && call.args[1] === tenant))
  })
  const specialtiesRes = response()
  await handlers.crearUsuario(request(body({ passwordTemporal: 'StrongPassword12!', rol: 'medico', especialidades: [specialty] })), specialtiesRes)
  assert.equal(specialtiesRes.statusCode, 400)
  assert.ok(state.calls.every(call => call.kind !== 'auth'))
})

test('failed profile RPC compensates only the newly created Auth user', async () => {
  plan('auth', 'createUser', { data: { user: authUser() }, error: null })
  plan('rpc', 'vettrack_crear_usuario', { data: null, error: { code: '42501', message: 'private upstream' } })
  plan('auth', 'deleteUser', { error: null }, args => assert.deepEqual(args, [target]))
  const res = response()
  await handlers.crearUsuario(request(body({ passwordTemporal: 'StrongPassword12!' })), res)
  assert.equal(res.statusCode, 403)
  assert.deepEqual(state.calls.map(call => call.name), ['createUser', 'vettrack_crear_usuario', 'deleteUser'])
  noSecrets(res.body)
})

test('an interrupted Auth creation can clean the server-generated ID without knowing the response', async () => {
  plan('auth', 'createUser', new Error('private upstream'), ([attributes]) => assert.equal(attributes.id, target))
  plan('auth', 'deleteUser', { error: { status: 404 } }, args => assert.deepEqual(args, [target]))
  const original = console.error
  const logs = []
  console.error = (...args) => logs.push(args)
  const res = response()
  try { await handlers.crearUsuario(request(body({ passwordTemporal: 'StrongPassword12!' })), res) } finally { console.error = original }
  assert.equal(res.statusCode, 500)
  assert.deepEqual(state.calls.map(call => call.name), ['createUser', 'deleteUser'])
  noSecrets({ response: res.body, logs })
})

test('composite RPC singleton arrays are accepted for authorization and profile creation', async () => {
  plan('auth', 'createUser', { data: { user: authUser() }, error: null })
  plan('rpc', 'vettrack_crear_usuario', { data: [profile()], error: null })
  const creation = response()
  await handlers.crearUsuario(request(body({ passwordTemporal: 'StrongPassword12!' })), creation)
  assert.equal(creation.statusCode, 201)
  assert.equal(creation.body.usuario.id, target)

  plan('rpc', 'vettrack_autorizar_usuario', { data: [profile()], error: null })
  plan('auth', 'getUserById', { data: { user: authUser() }, error: null })
  plan('auth', 'updateUserById', { error: null })
  const change = response()
  await handlers.cambiarPassword(request({ nuevaPassword: 'StrongPassword12!' }), change)
  assert.equal(change.statusCode, 200)
})

test('duplicate Auth email returns 409 and cleanup only targets the unused ID generated by this request', async () => {
  plan('auth', 'createUser', { data: null, error: { code: 'email_exists', message: 'private upstream' } })
  plan('auth', 'deleteUser', { error: { status: 404, code: 'user_not_found' } }, args => assert.deepEqual(args, [target]))
  const res = response()
  await handlers.crearUsuario(request(body({ passwordTemporal: 'StrongPassword12!' })), res)
  assert.equal(res.statusCode, 409)
  assert.deepEqual(state.calls.map(call => call.name), ['createUser', 'deleteUser'])
  noSecrets(res.body)
})

test('failed creation cleanup is reported without exposing passwords or upstream errors', async () => {
  plan('auth', 'createUser', { data: { user: authUser() }, error: null })
  plan('rpc', 'vettrack_crear_usuario', { data: null, error: { code: '23514', message: 'private upstream' } })
  plan('auth', 'deleteUser', { error: { message: 'supersecret' } })
  const original = console.error
  const logs = []
  console.error = (...args) => logs.push(args)
  const res = response()
  try { await handlers.crearUsuario(request(body({ passwordTemporal: 'StrongPassword12!' })), res) } finally { console.error = original }
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.cleanupPending, true)
  noSecrets({ response: res.body, logs })
})

test('list uses JWT tenant rows and exact-target guards before privileged Auth lookups, hiding a global account', async () => {
  plan('table', 'perfilusuario', { data: [profile()], error: null }, methods => {
    assert.ok(methods.some(call => call.method === 'eq' && call.args[0] === 'id_veterinaria' && call.args[1] === tenant))
  })
  guard('usuarios.ver', profile(), authUser({ app_metadata: { super_admin: true } }))
  const res = response()
  await handlers.obtenerUsuarios(request(), res)
  assert.deepEqual(res.body, [])
  assert.deepEqual(state.calls.map(call => call.kind), ['table', 'rpc', 'auth'])
})

test('a target in another tenant is rejected before any Auth lookup or password update', async () => {
  plan('rpc', 'vettrack_autorizar_usuario', { data: null, error: { code: 'P0002', message: 'private upstream' } })
  const res = response()
  await handlers.cambiarPassword(request({ nuevaPassword: 'StrongPassword12!' }), res)
  assert.equal(res.statusCode, 404)
  assert.deepEqual(state.calls.map(call => call.kind), ['rpc'])
  noSecrets(res.body)
})

test('even a mismatched SQL target cannot cause a privileged lookup', async () => {
  plan('rpc', 'vettrack_autorizar_usuario', { data: profile({ id_veterinaria: otherTenant }), error: null })
  const res = response()
  await handlers.cambiarPassword(request({ nuevaPassword: 'StrongPassword12!' }), res)
  assert.equal(res.statusCode, 404)
  assert.deepEqual(state.calls.map(call => call.kind), ['rpc'])
})

test('live Auth Superadmin metadata prevents clinic administration despite a target profile', async () => {
  guard('usuarios.editar', profile(), authUser({ app_metadata: { super_admin: true } }))
  const res = response()
  await handlers.cambiarPassword(request({ nuevaPassword: 'StrongPassword12!' }), res)
  assert.equal(res.statusCode, 404)
  assert.deepEqual(state.calls.map(call => call.name), ['vettrack_autorizar_usuario', 'getUserById'])
})

test('password updates preserve input exactly and return only a message', async () => {
  const nuevaPassword = '  StrongPassword12!  '
  guard('usuarios.editar')
  plan('auth', 'updateUserById', { data: { user: authUser() }, error: null }, args => assert.deepEqual(args, [target, { password: nuevaPassword }]))
  const res = response()
  await handlers.cambiarPassword(request({ nuevaPassword }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(Object.keys(res.body), ['message'])
  assert.ok(!JSON.stringify(res.body).includes(nuevaPassword))
})

test('a failed profile edit restores an already changed Auth email and returns the SQL conflict', async () => {
  guard('usuarios.editar')
  plan('auth', 'updateUserById', { error: null }, args => assert.deepEqual(args, [target, { email: 'new@example.com', email_confirm: true }]))
  plan('rpc', 'vettrack_editar_usuario', { data: null, error: { code: '23514', message: 'private upstream' } })
  plan('auth', 'updateUserById', { error: null }, args => assert.deepEqual(args, [target, { email: 'persona@example.com', email_confirm: true }]))
  const res = response()
  await handlers.editarUsuario(request(body({ correo: 'new@example.com' })), res)
  assert.equal(res.statusCode, 409)
  assert.equal(state.planned.length, 0)
  noSecrets(res.body)
})

test('failed email restoration reports a partial synchronization without leaking Auth errors', async () => {
  guard('usuarios.editar')
  plan('auth', 'updateUserById', { error: null })
  plan('rpc', 'vettrack_editar_usuario', { data: null, error: { code: '42501' } })
  plan('auth', 'updateUserById', { error: { message: 'private upstream' } })
  const original = console.error
  console.error = () => {}
  const res = response()
  try { await handlers.editarUsuario(request(body({ correo: 'new@example.com' })), res) } finally { console.error = original }
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.syncPending, true)
  noSecrets(res.body)
})

test('last-admin and self-deactivation SQL conflicts occur before any Auth ban', async () => {
  guard('usuarios.desactivar', profile({ rol: 'admin' }))
  issueCapability(false)
  plan('rpc', 'vettrack_estado_usuario', { data: null, error: { code: '23514', message: 'private upstream' } })
  clearCapability()
  const res = response()
  await handlers.cambiarEstado(request({ activo: false }), res)
  assert.equal(res.statusCode, 409)
  assert.ok(!state.calls.some(call => call.name === 'updateUserById' && Object.hasOwn(call.args[1], 'ban_duration')))
  assert.equal(state.planned.length, 0)
})

test('deactivation persists SQL inactivity before Auth ban and retains that protection if Auth fails', async () => {
  guard('usuarios.desactivar')
  issueCapability(false)
  plan('rpc', 'vettrack_estado_usuario', { data: profile({ activo: false }), error: null }, args => assert.deepEqual(args, { p_id: target, p_activo: false, p_token: stateNonce }))
  plan('auth', 'updateUserById', { error: { message: 'private upstream' } }, args => assert.deepEqual(args, [target, { ban_duration: '876000h' }]))
  clearCapability()
  const res = response()
  await handlers.cambiarEstado(request({ activo: false }), res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.syncPending, true)
  assert.deepEqual(state.calls.map(call => call.name), ['vettrack_autorizar_usuario', 'getUserById', 'updateUserById', 'vettrack_estado_usuario', 'updateUserById', 'updateUserById'])
  noSecrets(res.body)
  assert.ok(!JSON.stringify(res.body).includes(stateNonce))
})

test('reactivation uses supported Auth unban and restores the ban if the SQL activation fails', async () => {
  guard('usuarios.desactivar', profile({ activo: false }))
  issueCapability(true)
  plan('auth', 'updateUserById', { error: null }, args => assert.deepEqual(args, [target, { ban_duration: 'none' }]))
  plan('rpc', 'vettrack_estado_usuario', { data: null, error: { code: '42501' } })
  plan('auth', 'updateUserById', { error: null }, args => assert.deepEqual(args, [target, { ban_duration: '876000h' }]))
  clearCapability()
  const res = response()
  await handlers.cambiarEstado(request({ activo: true }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(state.planned.length, 0)
})

test('failed capability issuance denies the transition before SQL state or Auth ban/unban', async () => {
  for (const activo of [false, true]) {
    guard('usuarios.desactivar', profile({ activo: !activo }))
    issueCapability(activo, { error: { message: 'private upstream' } })
    clearCapability()
    const res = response()
    await handlers.cambiarEstado(request({ activo }), res)
    assert.equal(res.statusCode, 502)
    assert.ok(!state.calls.some(call => call.name === 'vettrack_estado_usuario'))
    assert.ok(!state.calls.some(call => call.name === 'updateUserById' && Object.hasOwn(call.args[1], 'ban_duration')))
    assert.equal(state.planned.length, 0)
    noSecrets(res.body)
  }
})

test('capability cleanup failure cannot mask a successful state change or expose metadata', async () => {
  guard('usuarios.desactivar')
  issueCapability(false)
  plan('rpc', 'vettrack_estado_usuario', { data: profile({ activo: false }), error: null })
  plan('auth', 'updateUserById', { error: null }, args => assert.deepEqual(args, [target, { ban_duration: '876000h' }]))
  clearCapability({ error: { message: 'private upstream' } })
  const original = console.error
  const logs = []
  console.error = (...args) => logs.push(args)
  const res = response()
  try { await handlers.cambiarEstado(request({ activo: false }), res) } finally { console.error = original }
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.usuario.activo, false)
  assert.equal(state.planned.length, 0)
  noSecrets({ response: res.body, logs })
  assert.ok(!JSON.stringify({ response: res.body, logs }).includes(stateNonce))
  assert.ok(!JSON.stringify(res.body).includes('app_metadata'))
})

test('state requires a boolean and does not accept a body tenant', async () => {
  for (const data of [{ activo: 'false' }, { activo: false, id_veterinaria: otherTenant }]) {
    const res = response()
    await handlers.cambiarEstado(request(data), res)
    assert.equal(res.statusCode, 400)
    assert.equal(state.calls.length, 0)
  }
})

test('permission GET returns complete inherited, overridden and effective boolean maps', async () => {
  guard('usuarios.permisos')
  plan('rpc', 'vettrack_ver_permisos_usuario', { data: permisos, error: null })
  planCatalog()
  const res = response()
  await handlers.obtenerPermisos(request(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    catalogo: catalog,
    porRol: { 'pacientes.ver': true, 'pacientes.eliminar': false, 'usuarios.permisos': false },
    overrides: { 'pacientes.eliminar': true },
    efectivos: { 'pacientes.ver': true, 'pacientes.eliminar': true, 'usuarios.permisos': false },
  })
})

test('permission PUT supports null removal and an empty mapping restores the role defaults', async () => {
  for (const overrides of [{ 'pacientes.eliminar': null }, {}]) {
    guard('usuarios.permisos')
    planCatalog()
    plan('rpc', 'vettrack_permisos_usuario', { data: permisos, error: null }, args => assert.deepEqual(args, {
      p_id: target, p_overrides: overrides, p_restaurar: Object.keys(overrides).length === 0,
    }))
    const res = response()
    await handlers.actualizarPermisos(request(overrides), res)
    assert.equal(res.statusCode, 200)
    assert.equal(state.planned.length, 0)
  }
})

test('permission PUT rejects unknown keys, nonboolean overrides, reserved permission and admin overrides', async () => {
  for (const overrides of [{ 'invented.permission': true }, { 'pacientes.ver': 'true' }, { 'usuarios.permisos': true }]) {
    guard('usuarios.permisos')
    planCatalog()
    const res = response()
    await handlers.actualizarPermisos(request(overrides), res)
    assert.equal(res.statusCode, 400)
    assert.equal(state.planned.length, 0)
  }
  guard('usuarios.permisos', profile({ rol: 'admin' }))
  const res = response()
  await handlers.actualizarPermisos(request({}), res)
  assert.equal(res.statusCode, 409)
})

test('specialty listing is tenant-scoped and mutations use only the JWT RPC', async () => {
  const fila = { id_especialidad: specialty, nombre: 'Medicina general', descripcion: null, id_veterinaria: tenant }
  plan('table', 'especialidad', { data: [fila], error: null }, methods => assert.ok(methods.some(call => call.method === 'eq' && call.args[0] === 'id_veterinaria' && call.args[1] === tenant)))
  const listing = response()
  await specialties.obtenerEspecialidades(request(), listing)
  assert.deepEqual(listing.body, [{ id_especialidad: specialty, nombre: 'Medicina general', descripcion: null }])
  plan('rpc', 'vettrack_guardar_especialidad', { data: fila, error: null }, args => assert.deepEqual(args, { p_nombre: 'Medicina general', p_descripcion: null, p_id: null }))
  const creation = response()
  await specialties.guardarEspecialidad(request({ nombre: ' Medicina general ' }, { params: {} }), creation)
  assert.equal(creation.statusCode, 201)
  assert.ok(state.calls.every(call => call.kind !== 'auth'))
})

test('all seven user routes authenticate, load active clinic access and enforce their own permission', () => {
  const router = require('../routes/usuarios.routes')
  const autenticarUsuario = require('../middleware/auth')
  const { loadClinicAccess } = require('../middleware/permissions')
  assert.deepEqual(router.stack.filter(layer => !layer.route).map(layer => layer.handle), [autenticarUsuario, loadClinicAccess])
  const expected = [
    ['get', '/', 'usuarios.ver'], ['post', '/', 'usuarios.crear'], ['put', '/:id', 'usuarios.editar'],
    ['patch', '/:id/estado', 'usuarios.desactivar'], ['put', '/:id/password', 'usuarios.editar'],
    ['get', '/:id/permisos', 'usuarios.permisos'], ['put', '/:id/permisos', 'usuarios.permisos'],
  ]
  for (const [method, route, permission] of expected) {
    const handler = router.stack.find(layer => layer.route?.path === route && layer.route.methods[method]).route.stack[0].handle
    const denied = response()
    let called = false
    handler(request(null, { clinicAccess: { permisos: [] } }), denied, () => { called = true })
    assert.equal(called, false)
    assert.equal(denied.statusCode, 403)
    handler(request(null, { clinicAccess: { permisos: [permission] } }), response(), () => { called = true })
    assert.equal(called, true)
  }
})

test('specialty routes permit delegated selectors while enforcing create and edit separately', () => {
  const router = require('../routes/especialidades.routes')
  const selectors = router.stack.find(layer => layer.route?.methods.get).route.stack[0].handle
  for (const permission of ['usuarios.ver', 'usuarios.crear', 'usuarios.editar']) {
    let allowed = false
    selectors(request(null, { clinicAccess: { permisos: [permission] } }), response(), () => { allowed = true })
    assert.equal(allowed, true)
  }
  const denied = response()
  selectors(request(null, { clinicAccess: { permisos: [] } }), denied, () => assert.fail('No permission must not allow specialty selectors'))
  assert.equal(denied.statusCode, 403)
  for (const [method, permission] of [['post', 'usuarios.crear'], ['put', 'usuarios.editar']]) {
    const middleware = router.stack.find(layer => layer.route?.methods[method]).route.stack[0].handle
    let allowed = false
    middleware(request(null, { clinicAccess: { permisos: [permission] } }), response(), () => { allowed = true })
    assert.equal(allowed, true)
  }
})

for (const [description, password] of [
  ['seven characters', 'Vettra1'],
  ['missing uppercase', 'vettrack1'],
  ['missing lowercase', 'VETTRACK1'],
  ['missing number', 'Vettrack'],
]) {
  test(`new password policy rejects ${description} for creation and password changes`, async () => {
    for (const [handler, input] of [
      ['crearUsuario', body({ passwordTemporal: password })], ['cambiarPassword', { nuevaPassword: password }],
    ]) {
      const res = response()
      await handlers[handler](request(input), res)
      assert.equal(res.statusCode, 400)
      assert.equal(res.body.error, 'Mínimo 8 caracteres, con mayúscula, minúscula y número.')
      assert.equal(state.calls.length, 0)
    }
  })
}

for (const password of ['Vettrak1', 'Vettrack1', 'Vettrak1!', 'Ábcdefg١']) {
  test(`eight-plus character password is accepted with optional symbols: ${password}`, async () => {
    plan('auth', 'createUser', { data: { user: authUser() }, error: null }, ([input]) => {
      assert.equal(input.password, password)
      assert.equal(Object.hasOwn(input, 'ban_duration'), false)
    })
    plan('rpc', 'vettrack_crear_usuario', { data: profile(), error: null })
    const creation = response()
    await handlers.crearUsuario(request(body({ passwordTemporal: password })), creation)
    assert.equal(creation.statusCode, 201)
    guard('usuarios.editar')
    plan('auth', 'updateUserById', { error: null }, ([id, input]) => {
      assert.equal(id, target)
      assert.deepEqual(input, { password })
    })
    const change = response()
    await handlers.cambiarPassword(request({ nuevaPassword: password }), change)
    assert.equal(change.statusCode, 200)
    assert.equal(state.planned.length, 0)
  })
}

test('creation and editing reject incomplete or malformed email domains before Auth', async () => {
  for (const correo of ['lupe@veterinaria', 'lupe@veterinaria.', 'lupe@.com', 'lupe@vet..com', 'lupe@-vet.com', 'lupe@vet-.com', 'lupe@vet_com.mx', 'lupe..martinez@vet.com', 'lu pe@vet.com']) {
    for (const handler of ['crearUsuario', 'editarUsuario']) {
      const res = response()
      await handlers[handler](request(body({ correo, ...(handler === 'crearUsuario' ? { passwordTemporal: 'Vettrack1' } : {}) })), res)
      assert.equal(res.statusCode, 400, `${handler}: ${correo}`)
      assert.match(res.body.error, /correo válido/)
      assert.equal(state.calls.length, 0)
    }
  }
})

test('a complete veterinary email and explicit active state are accepted', async () => {
  plan('auth', 'createUser', { data: { user: authUser({ email: 'lupe@veterinaria.com' }) }, error: null }, ([input]) => {
    assert.equal(input.email, 'lupe@veterinaria.com')
    assert.equal(Object.hasOwn(input, 'ban_duration'), false)
  })
  plan('rpc', 'vettrack_crear_usuario', { data: profile(), error: null })
  const res = response()
  await handlers.crearUsuario(request(body({ correo: 'lupe@veterinaria.com', passwordTemporal: 'Vettrack1', activo: true })), res)
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.usuario.activo, true)
})

test('creation and editing require boolean state values', async () => {
  for (const activo of ['false', null, 0, [], {}]) {
    for (const handler of ['crearUsuario', 'editarUsuario']) {
      const input = body({ activo, ...(handler === 'crearUsuario' ? { passwordTemporal: 'Vettrack1' } : {}) })
      const res = response()
      await handlers[handler](request(input), res)
      assert.equal(res.statusCode, 400)
      assert.equal(state.calls.length, 0)
    }
  }
})

test('creating inactive accounts requires the existing state permission before any writes', async () => {
  const req = request(body({ activo: false, passwordTemporal: 'Vettrack1' }))
  req.clinicAccess.permisos = ['usuarios.crear']
  const res = response()
  await handlers.crearUsuario(req, res)
  assert.equal(res.statusCode, 403)
  assert.deepEqual(state.calls, [])
})

function planInactiveCreation(stateError = null, cleanupError = null) {
  uuidQueue = [target, stateNonce]
  plan('auth', 'createUser', { data: { user: authUser() }, error: null }, ([input]) => {
    assert.equal(input.id, target)
    assert.equal(input.ban_duration, '876000h', 'Auth is blocked before the profile is created')
  })
  plan('rpc', 'vettrack_crear_usuario', { data: profile(), error: null })
  guard('usuarios.desactivar')
  issueCapability(false)
  plan('rpc', 'vettrack_estado_usuario', { data: stateError ? null : profile({ activo: false }), error: stateError }, args => {
    assert.deepEqual(args, { p_id: target, p_activo: false, p_token: stateNonce })
  })
  if (!stateError) plan('auth', 'updateUserById', { error: null }, args => assert.deepEqual(args, [target, { ban_duration: '876000h' }]))
  clearCapability()
  if (stateError) plan('auth', 'deleteUser', { error: cleanupError }, args => assert.deepEqual(args, [target]))
}

test('inactive creation blocks Auth from the start and reuses the protected state transition', async () => {
  planInactiveCreation()
  const res = response()
  await handlers.crearUsuario(request(body({ activo: false, passwordTemporal: 'Vettrack1' })), res)
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.usuario.activo, false)
  assert.equal(state.calls.filter(call => call.name === 'vettrack_estado_usuario').length, 1)
  assert.equal(state.planned.length, 0)
  noSecrets(res.body)
})

test('a failed inactive creation removes its new Auth user and profile through cascade', async () => {
  planInactiveCreation({ code: '23514' })
  const res = response()
  await handlers.crearUsuario(request(body({ activo: false, passwordTemporal: 'Vettrack1' })), res)
  assert.equal(res.statusCode, 409)
  assert.equal(state.calls.at(-1).name, 'deleteUser')
  assert.equal(state.planned.length, 0)
})

test('failed inactive-creation cleanup reports a controlled pending result', async () => {
  planInactiveCreation({ code: '42501' }, { message: 'private upstream' })
  const original = console.error
  console.error = () => {}
  const res = response()
  try { await handlers.crearUsuario(request(body({ activo: false, passwordTemporal: 'Vettrack1' })), res) } finally { console.error = original }
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.cleanupPending, true)
  assert.equal(state.planned.length, 0)
  noSecrets(res.body)
})

test('the editor reuses the protected deactivation flow after saving profile data', async () => {
  guard('usuarios.editar')
  guard('usuarios.desactivar')
  plan('rpc', 'vettrack_editar_usuario', { data: profile({ nombre: 'Editada' }), error: null })
  guard('usuarios.desactivar', profile({ nombre: 'Editada' }))
  issueCapability(false)
  plan('rpc', 'vettrack_estado_usuario', { data: profile({ nombre: 'Editada', activo: false }), error: null })
  plan('auth', 'updateUserById', { error: null })
  clearCapability()
  const res = response()
  await handlers.editarUsuario(request(body({ nombre: 'Editada', activo: false })), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.usuario.nombre, 'Editada')
  assert.equal(res.body.usuario.activo, false)
  assert.equal(state.calls.filter(call => call.name === 'vettrack_estado_usuario').length, 1)
  assert.equal(state.planned.length, 0)
})

test('the editor cannot bypass the state permission or self-deactivation protection', async () => {
  guard('usuarios.editar')
  const restricted = request(body({ activo: false }))
  restricted.clinicAccess.permisos = ['usuarios.editar']
  const denied = response()
  await handlers.editarUsuario(restricted, denied)
  assert.equal(denied.statusCode, 403)
  assert.equal(state.calls.some(call => call.name === 'vettrack_editar_usuario'), false)

  guard('usuarios.editar', profile({ rol: 'admin' }))
  const self = request(body({ rol: 'admin', activo: false }))
  self.clinicAccess.id = target
  const conflict = response()
  await handlers.editarUsuario(self, conflict)
  assert.equal(conflict.statusCode, 409)
  assert.equal(state.calls.some(call => call.name === 'vettrack_editar_usuario'), false)
})

test('editing an inactive account reactivates Auth and profile through the same state flow', async () => {
  guard('usuarios.editar', profile({ activo: false }))
  guard('usuarios.desactivar', profile({ activo: false }))
  plan('rpc', 'vettrack_editar_usuario', { data: profile({ activo: false }), error: null })
  guard('usuarios.desactivar', profile({ activo: false }))
  issueCapability(true)
  plan('auth', 'updateUserById', { error: null }, args => assert.deepEqual(args, [target, { ban_duration: 'none' }]))
  plan('rpc', 'vettrack_estado_usuario', { data: profile({ activo: true }), error: null }, args => assert.deepEqual(args, { p_id: target, p_activo: true, p_token: stateNonce }))
  clearCapability()
  const res = response()
  await handlers.editarUsuario(request(body({ activo: true })), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.usuario.activo, true)
  assert.equal(state.planned.length, 0)
})

test('the contextual reactivation action uses Auth unban before profile activation', async () => {
  guard('usuarios.desactivar', profile({ activo: false }))
  issueCapability(true)
  plan('auth', 'updateUserById', { error: null }, args => assert.deepEqual(args, [target, { ban_duration: 'none' }]))
  plan('rpc', 'vettrack_estado_usuario', { data: profile({ activo: true }), error: null })
  clearCapability()
  const res = response()
  await handlers.cambiarEstado(request({ activo: true }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.usuario.activo, true)
  assert.equal(state.planned.length, 0)
  noSecrets(res.body)
})

test('a partial editor state failure is explicit and never retries profile changes', async () => {
  guard('usuarios.editar')
  guard('usuarios.desactivar')
  plan('rpc', 'vettrack_editar_usuario', { data: profile(), error: null })
  guard('usuarios.desactivar')
  issueCapability(false)
  plan('rpc', 'vettrack_estado_usuario', { data: null, error: { code: '23514' } })
  clearCapability()
  const res = response()
  await handlers.editarUsuario(request(body({ activo: false })), res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.syncPending, true)
  assert.equal(state.calls.filter(call => call.name === 'vettrack_editar_usuario').length, 1)
  assert.equal(state.planned.length, 0)
})

test('last access is an allowlisted Auth field returned only after view and tenant authorization', async () => {
  const created = '2026-11-07T01:00:00'
  const signedIn = '2026-11-07T01:35:00Z'
  const sensitive = authUser({ last_sign_in_at: signedIn, identities: [{ secret: 'supersecret' }], refresh_token: 'supersecret', providers: ['internal'], app_metadata: { internal: 'supersecret' } })
  plan('table', 'perfilusuario', { data: [profile({ creado_en: created })], error: null })
  guard('usuarios.ver', profile({ creado_en: created }), sensitive)
  const res = response()
  await handlers.obtenerUsuarios(request(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body[0].creado_en, created)
  assert.equal(res.body[0].ultimo_acceso, signedIn)
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['id', 'nombre', 'correo', 'telefono', 'rol', 'activo', 'especialidades', 'creado_en', 'ultimo_acceso', 'cedula_profesional'].sort())
  noSecrets(res.body)
  assert.doesNotMatch(JSON.stringify(res.body), /identities|providers|app_metadata/)
})

test('user listing without usuarios.ver never reads Auth last access', async () => {
  const req = request()
  req.clinicAccess.permisos = ['usuarios.editar']
  const res = response()
  await handlers.obtenerUsuarios(req, res)
  assert.equal(res.statusCode, 403)
  assert.deepEqual(state.calls, [])
})

test('a foreign-tenant row cannot cause a privileged last-access lookup', async () => {
  plan('table', 'perfilusuario', { data: [profile({ id_veterinaria: otherTenant })], error: null })
  plan('rpc', 'vettrack_autorizar_usuario', { data: profile({ id_veterinaria: otherTenant }), error: null })
  const res = response()
  await handlers.obtenerUsuarios(request(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, [])
  assert.ok(state.calls.every(call => call.kind !== 'auth'))
})

test('editing without usuarios.ver never exposes last access', async () => {
  guard('usuarios.editar', profile(), authUser({ last_sign_in_at: '2026-11-07T01:35:00Z' }))
  plan('rpc', 'vettrack_editar_usuario', { data: profile(), error: null })
  const req = request(body())
  req.clinicAccess.permisos = ['usuarios.editar']
  const res = response()
  await handlers.editarUsuario(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.usuario.ultimo_acceso, null)
})
