const assert = require('node:assert/strict')
const { before, after, beforeEach, test } = require('node:test')
const Module = require('node:module')
const express = require('express')

const state = {}
const userId = '10000000-0000-4000-8000-000000000001'
const tenantId = '20000000-0000-4000-8000-000000000001'
const userClient = {
  from(table) {
    state.tables.push(table)
    const builder = {}
    for (const method of ['select', 'eq']) builder[method] = () => builder
    builder.maybeSingle = async () => table === 'veterinaria'
      ? { data: { nombre: 'Clínica de prueba' }, error: null }
      : { data: state.profile, error: state.profileError }
    return builder
  },
  async rpc(name) {
    if (name === 'vettrack_plataforma') return { data: { nombre_veterinaria: 'Clínica de prueba', estado: state.clinicState || 'activo', logo_archivo: null }, error: null }
    assert.equal(name, 'get_my_permissions')
    return { data: state.permissions, error: state.permissionsError }
  },
}

function replaceModule(relativePath, exports) {
  const resolved = require.resolve(relativePath)
  const stub = new Module(resolved)
  stub.loaded = true
  stub.exports = exports
  require.cache[resolved] = stub
}

replaceModule('../config/supabase', {
  createUserClient: token => { assert.equal(token, 'valid-jwt'); return userClient },
  supabaseAdmin: { auth: { getUser: async token => token === 'valid-jwt'
    ? { data: { user: { id: userId, app_metadata: state.appMetadata } }, error: null }
    : { data: { user: null }, error: new Error('invalid') } } },
})
const handler = name => (_req, res) => res.json({ handler: name })
replaceModule('../controllers/duenos.controller', Object.fromEntries(
  ['obtenerDuenos', 'crearDueno', 'actualizarDueno', 'eliminarDueno'].map(name => [name, handler(name)])
))
replaceModule('../controllers/pacientes.controller', Object.fromEntries(
  ['obtenerPacientes', 'obtenerPropietariosPacientes', 'crearPaciente', 'actualizarPaciente', 'eliminarPaciente'].map(name => [name, handler(name)])
))

const app = express()
app.use('/api/duenos', require('../routes/duenos.routes'))
app.use('/api/pacientes', require('../routes/pacientes.routes'))
app.use('/api/sesion', require('../routes/sesion.routes'))
let server
let baseUrl
before(async () => {
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise(resolve => server.close(resolve)) })
beforeEach(() => {
  state.tables = []
  state.profile = { id: userId, id_veterinaria: tenantId, nombre: 'Prueba', telefono: null, activo: true, rol: 'recepcionista' }
  state.profileError = null
  state.permissions = []
  state.permissionsError = null
  state.appMetadata = {}
  state.clinicState = 'activo'
})
const call = (path, method = 'GET', token = 'valid-jwt') => fetch(`${baseUrl}${path}`, {
  method,
  headers: token ? { Authorization: `Bearer ${token}` } : {},
})

test('HTTP clinic routes require a verified JWT before reading a profile', async () => {
  assert.equal((await call('/api/duenos', 'GET', '')).status, 401)
  assert.equal((await call('/api/duenos', 'GET', 'invalid')).status, 401)
  assert.deepEqual(state.tables, [])
})

for (const [method, path, permission] of [
  ['GET', '/api/duenos', 'propietarios.ver'], ['POST', '/api/duenos', 'propietarios.crear'],
  ['PUT', '/api/duenos/id', 'propietarios.editar'], ['DELETE', '/api/duenos/id', 'propietarios.eliminar'],
  ['GET', '/api/pacientes', 'pacientes.ver'], ['POST', '/api/pacientes', 'pacientes.crear'],
  ['PUT', '/api/pacientes/id', 'pacientes.editar'], ['DELETE', '/api/pacientes/id', 'pacientes.eliminar'],
]) {
  test(`HTTP ${method} ${path} enforces ${permission} independently`, async () => {
    state.permissions = ['dashboard.ver']
    assert.equal((await call(path, method)).status, 403)
    state.permissions = [permission]
    assert.equal((await call(path, method)).status, 200)
  })
}

test('a stale JWT cannot authorize an inactive profile or a missing clinic', async () => {
  state.permissions = ['propietarios.ver']
  state.profile.activo = false
  assert.equal((await call('/api/duenos')).status, 403)
  state.profile.activo = true
  state.profile.id_veterinaria = null
  assert.equal((await call('/api/duenos')).status, 403)
})

test('a clinic role in user metadata cannot replace a compatible database profile', async () => {
  state.permissions = ['propietarios.ver']
  state.profile.rol = 'user'
  assert.equal((await call('/api/duenos')).status, 403)
})

test('global Superadmin remains separate from clinic permissions', async () => {
  state.appMetadata = { super_admin: true }
  state.permissions = ['propietarios.ver']
  assert.equal((await call('/api/duenos')).status, 403)
  assert.deepEqual(state.tables, [])
})

test('database and permission failures deny access instead of falling back to admin', async () => {
  state.profileError = { message: 'private schema details' }
  let response = await call('/api/duenos')
  assert.equal(response.status, 503)
  assert.doesNotMatch(JSON.stringify(await response.json()), /private/)
  state.profileError = null
  state.permissionsError = { message: 'private schema details' }
  response = await call('/api/duenos')
  assert.equal(response.status, 503)
  state.permissionsError = null
  state.permissions = [{ permission: 'propietarios.ver' }]
  assert.equal((await call('/api/duenos')).status, 503)
})

test('patient selectors can be used without exposing the owners module', async () => {
  state.permissions = ['pacientes.crear']
  assert.equal((await call('/api/pacientes/propietarios')).status, 200)
  assert.equal((await call('/api/duenos')).status, 403)
})

test('session API returns only current clinic access without requiring dashboard permission', async () => {
  const response = await call('/api/sesion')
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.id, userId)
  assert.equal(data.id_veterinaria, tenantId)
  assert.equal(data.nombre_veterinaria, 'Clínica de prueba')
  assert.deepEqual(data.permisos, [])
  assert.doesNotMatch(JSON.stringify(data), /token|password|app_metadata/)
})

test('suspended clinic session retains only identity and support context with no functional permissions', async () => {
  state.clinicState = 'suspendido'
  const response = await call('/api/sesion')
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.estado, 'suspendido')
  assert.deepEqual(data.permisos, [])
  assert.equal(data.nombre_veterinaria, 'Clínica de prueba')
})
