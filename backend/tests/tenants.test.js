const assert = require('node:assert/strict')
const { beforeEach, test } = require('node:test')
const Module = require('node:module')

// Replace the config module before importing the handlers. These tests never
// load .env, instantiate a Supabase client, or contact an external service.
const state = { queries: [], events: [], calls: [], auth: {} }
const supabaseAdmin = {
  from(table) {
    const expected = state.queries.shift()
    assert.ok(expected, `Unexpected query to ${table}`)
    assert.equal(table, expected.table)
    const call = { table, methods: [] }
    state.calls.push(call)
    let executed = false
    const builder = {}

    for (const method of ['select', 'order', 'eq', 'in', 'insert', 'upsert', 'delete', 'single']) {
      builder[method] = (...args) => {
        call.methods.push({ method, args })
        return builder
      }
    }

    builder.then = (resolve, reject) => Promise.resolve().then(() => {
      assert.equal(executed, false, 'Query must execute once')
      executed = true
      const operation = call.methods.find(({ method }) => ['insert', 'upsert', 'delete'].includes(method))?.method || 'select'
      state.events.push(`${table}:${operation}`)
      return typeof expected.result === 'function' ? expected.result(call) : expected.result
    }).then(resolve, reject)

    return builder
  },
  auth: {
    async getUser(...args) {
      state.events.push('auth:getUser')
      assert.ok(state.auth.getUser, 'Unexpected token validation')
      return state.auth.getUser(...args)
    },
    admin: Object.fromEntries(['createUser', 'deleteUser', 'getUserById'].map((method) => [method, async (...args) => {
      state.events.push(`auth:${method}`)
      assert.ok(state.auth[method], `Unexpected auth.${method}`)
      return state.auth[method](...args)
    }])),
  },
}

const configPath = require.resolve('../config/supabase')
const configModule = new Module(configPath)
configModule.filename = configPath
configModule.loaded = true
configModule.exports = { supabaseAdmin }
require.cache[configPath] = configModule

const autenticarUsuario = require('../middleware/auth')
const exigirSuperAdmin = require('../middleware/superAdmin')
const { obtenerTenants, crearTenant } = require('../controllers/tenants.controller')

beforeEach(() => {
  state.queries = []
  state.events = []
  state.calls = []
  state.auth = {}
})

const response = () => ({
  statusCode: 200,
  status(status) { this.statusCode = status; return this },
  json(body) { this.body = body; return this },
})

const validBody = (changes = {}) => ({
  nombre: ' Clínica Nueva ',
  adminEmail: ' ADMIN@example.com ',
  adminPassword: ' password with spaces ',
  ...changes,
})

const insertVeterinaria = () => {
  state.queries.push({
    table: 'veterinaria',
    result(call) {
      const inserted = call.methods.find(({ method }) => method === 'insert').args[0]
      return { data: inserted, error: null }
    },
  })
}

test('authentication requires a bearer token and validates it through auth.getUser', async () => {
  const missing = response()
  let nextCalls = 0
  await autenticarUsuario({ headers: {} }, missing, () => nextCalls++)
  assert.equal(missing.statusCode, 401)
  assert.equal(nextCalls, 0)
  assert.deepEqual(state.events, [])

  state.auth.getUser = async (token) => {
    assert.equal(token, 'invalid-token')
    return { data: { user: null }, error: { message: 'expired' } }
  }
  const invalid = response()
  await autenticarUsuario({ headers: { authorization: 'Bearer invalid-token' } }, invalid, () => nextCalls++)
  assert.equal(invalid.statusCode, 401)
  assert.equal(nextCalls, 0)
})

test('only the verified app_metadata.super_admin boolean grants access', async () => {
  for (const user of [
    { id: 'user', user_metadata: { super_admin: true } },
    { id: 'user', app_metadata: { super_admin: 'true' } },
    { id: 'user', app_metadata: { super_admin: false }, rol: 'admin' },
    { id: 'user' },
  ]) {
    state.auth.getUser = async () => ({ data: { user }, error: null })
    const req = { headers: { authorization: 'Bearer checked-token' } }
    const res = response()
    let granted = false
    await autenticarUsuario(req, res, () => exigirSuperAdmin(req, res, () => { granted = true }))
    assert.equal(granted, false)
    assert.equal(res.statusCode, 403)
  }

  state.auth.getUser = async () => ({ data: { user: { id: 'superadmin', app_metadata: { super_admin: true } } }, error: null })
  const req = { headers: { authorization: 'Bearer checked-token' } }
  let granted = false
  await autenticarUsuario(req, response(), () => exigirSuperAdmin(req, response(), () => { granted = true }))
  assert.equal(granted, true)
  assert.equal(req.accessToken, 'checked-token')
  assert.equal(state.calls.length, 0)
})

test('the tenants router applies authentication and Superadmin authorization before both endpoints', () => {
  const router = require('../routes/tenants.routes')
  const middleware = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle)
  assert.deepEqual(middleware, [autenticarUsuario, exigirSuperAdmin])
  assert.equal(router.stack.find((layer) => layer.route?.methods.get).route.stack[0].handle, obtenerTenants)
  assert.equal(router.stack.find((layer) => layer.route?.methods.post).route.stack[0].handle, crearTenant)
})

test('GET resolves existing administrator emails from Auth and uses null without an assigned admin', async () => {
  state.queries.push(
    { table: 'veterinaria', result: { data: [
      { id_veterinaria: 'vet-1', nombre: 'A', telefono: '123', direccion: null, correo: 'old-contact@example.com' },
      { id_veterinaria: 'vet-2', nombre: 'B', correo: 'contact-is-not-admin@example.com' },
    ], error: null } },
    { table: 'perfilusuario', result: { data: [{ id: 'admin-1', id_veterinaria: 'vet-1' }], error: null } },
  )
  state.auth.getUserById = async (id) => {
    assert.equal(id, 'admin-1')
    return { data: { user: { email: 'real-admin@example.com' } }, error: null }
  }
  const res = response()
  await obtenerTenants({}, res)
  assert.deepEqual(res.body, [
    { id_veterinaria: 'vet-1', nombre: 'A', telefono: '123', direccion: null, adminEmail: 'real-admin@example.com' },
    { id_veterinaria: 'vet-2', nombre: 'B', telefono: null, direccion: null, adminEmail: null },
  ])
  assert.ok(state.calls[1].methods.some(({ method, args }) => method === 'eq' && args[0] === 'rol' && args[1] === 'admin'))
})

test('GET returns an empty array without looking up profiles when there are no tenants', async () => {
  state.queries.push({ table: 'veterinaria', result: { data: [], error: null } })
  const res = response()
  await obtenerTenants({}, res)
  assert.deepEqual(res.body, [])
  assert.equal(state.calls.length, 1)
})

test('GET sanitizes upstream errors', async () => {
  state.queries.push({ table: 'veterinaria', result: { data: null, error: { message: 'upstream secret' } } })
  const res = response()
  await obtenerTenants({}, res)
  assert.equal(res.statusCode, 502)
  assert.doesNotMatch(JSON.stringify(res.body), /secret/)
})

test('POST validates malformed types and schema limits before any writes', async () => {
  const invalidBodies = [
    undefined, null, [], 'text',
    validBody({ nombre: 1 }), validBody({ nombre: ' ' }), validBody({ nombre: 'x'.repeat(151) }),
    validBody({ adminEmail: null }), validBody({ adminEmail: 'invalid' }), validBody({ adminEmail: `${'x'.repeat(95)}@test.com` }),
    validBody({ adminPassword: 12345678 }), validBody({ adminPassword: 'short' }),
    validBody({ telefono: 123 }), validBody({ telefono: 'x'.repeat(21) }),
    validBody({ direccion: {} }),
  ]

  for (const body of invalidBodies) {
    const res = response()
    await crearTenant({ body }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(state.calls.length, 0)
    assert.deepEqual(state.events, [])
  }
})

test('POST creates the clinic, confirmed Auth account and admin profile without accepting client membership', async () => {
  insertVeterinaria()
  let userInput
  state.auth.createUser = async (input) => {
    userInput = input
    return { data: { user: { id: 'new-user', email: input.email } }, error: null }
  }
  state.queries.push({ table: 'perfilusuario', result: { error: null } })
  const body = validBody({ telefono: ' ', direccion: null, id_veterinaria: 'victim', rol: 'superadmin', user_metadata: { super_admin: true } })
  const res = response()
  await crearTenant({ body }, res)

  assert.equal(res.statusCode, 201)
  assert.deepEqual(userInput, { email: 'admin@example.com', password: body.adminPassword, email_confirm: true })
  const inserted = state.calls[0].methods.find(({ method }) => method === 'insert').args[0]
  assert.match(inserted.id_veterinaria, /^[0-9a-f-]{36}$/)
  assert.notEqual(inserted.id_veterinaria, 'victim')
  assert.equal(inserted.correo, 'admin@example.com')
  assert.equal(inserted.telefono, null)
  assert.equal(inserted.direccion, null)
  const upsert = state.calls[1].methods.find(({ method }) => method === 'upsert')
  assert.deepEqual(upsert.args, [{ id: 'new-user', rol: 'admin', id_veterinaria: inserted.id_veterinaria }, { onConflict: 'id' }])
  assert.deepEqual(res.body.tenant, { id_veterinaria: inserted.id_veterinaria, nombre: 'Clínica Nueva', telefono: null, direccion: null, adminEmail: 'admin@example.com' })
  assert.doesNotMatch(JSON.stringify(res.body), /password|user_metadata|super_admin/)
})

test('POST accepts the schema boundary lengths and preserves a password of eight spaces', async () => {
  insertVeterinaria()
  state.auth.createUser = async (input) => {
    assert.equal(input.password, '        ')
    return { data: { user: { id: 'new-user' } }, error: null }
  }
  state.queries.push({ table: 'perfilusuario', result: { error: null } })
  const res = response()
  await crearTenant({ body: validBody({ nombre: 'x'.repeat(150), telefono: '1'.repeat(20), adminEmail: `${'x'.repeat(91)}@test.com`, adminPassword: '        ' }) }, res)
  assert.equal(res.statusCode, 201)
})

test('a duplicate email returns 409 and deletes only the newly generated clinic', async () => {
  insertVeterinaria()
  state.auth.createUser = async () => ({ data: null, error: { code: 'email_exists', message: 'private details' } })
  state.queries.push({ table: 'veterinaria', result: { error: null } })
  const res = response()
  await crearTenant({ body: validBody() }, res)

  assert.equal(res.statusCode, 409)
  const insertedId = state.calls[0].methods.find(({ method }) => method === 'insert').args[0].id_veterinaria
  assert.deepEqual(state.calls[1].methods.find(({ method }) => method === 'eq').args, ['id_veterinaria', insertedId])
  assert.deepEqual(state.events, ['veterinaria:insert', 'auth:createUser', 'veterinaria:delete'])
  assert.doesNotMatch(JSON.stringify(res.body), /private details/)
})

test('a profile failure deletes the new Auth account before deleting its clinic', async () => {
  insertVeterinaria()
  state.auth.createUser = async () => ({ data: { user: { id: 'new-user' } }, error: null })
  state.queries.push({ table: 'perfilusuario', result: { error: { message: 'private constraint details' } } })
  state.auth.deleteUser = async (id) => {
    assert.equal(id, 'new-user')
    return { error: null }
  }
  state.queries.push({ table: 'veterinaria', result: { error: null } })
  const res = response()
  await crearTenant({ body: validBody() }, res)

  assert.equal(res.statusCode, 502)
  assert.deepEqual(state.events, ['veterinaria:insert', 'auth:createUser', 'perfilusuario:upsert', 'auth:deleteUser', 'veterinaria:delete'])
  assert.doesNotMatch(JSON.stringify(res.body), /private constraint details|password/)
})

test('an interrupted clinic insert is compensated using only the ID generated for that insert', async () => {
  state.queries.push({ table: 'veterinaria', result: { data: null, error: { message: 'private insert error' } } })
  state.queries.push({ table: 'veterinaria', result: { error: null } })
  const res = response()
  await crearTenant({ body: validBody() }, res)

  assert.equal(res.statusCode, 502)
  const newId = state.calls[0].methods.find(({ method }) => method === 'insert').args[0].id_veterinaria
  assert.deepEqual(state.calls[1].methods.find(({ method }) => method === 'eq').args, ['id_veterinaria', newId])
  assert.deepEqual(state.events, ['veterinaria:insert', 'veterinaria:delete'])
  assert.doesNotMatch(JSON.stringify(res.body), /private insert error/)
})

test('a failed clinic cleanup reports that manual review is required', async () => {
  insertVeterinaria()
  state.auth.createUser = async () => ({ data: null, error: { code: 'email_exists' } })
  state.queries.push({ table: 'veterinaria', result: { error: { message: 'private cleanup details' } } })
  const originalConsoleError = console.error
  const messages = []
  console.error = (...args) => messages.push(args.join(' '))
  const res = response()
  try {
    await crearTenant({ body: validBody() }, res)
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(res.statusCode, 502)
  assert.equal(res.body.cleanupPending, true)
  assert.ok(messages.length > 0)
  assert.doesNotMatch(JSON.stringify({ body: res.body, messages }), /private cleanup details/)
})

test('a failed user cleanup retains the clinic and reports the pending cleanup without leaking secrets', async () => {
  insertVeterinaria()
  state.auth.createUser = async () => ({ data: { user: { id: 'new-user' } }, error: null })
  state.queries.push({ table: 'perfilusuario', result: { error: { message: 'sensitive' } } })
  state.auth.deleteUser = async () => ({ error: { message: 'secret token password' } })
  const originalConsoleError = console.error
  const messages = []
  console.error = (...args) => messages.push(args.join(' '))
  const res = response()
  try {
    await crearTenant({ body: validBody() }, res)
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(res.statusCode, 502)
  assert.equal(res.body.cleanupPending, true)
  assert.deepEqual(state.events, ['veterinaria:insert', 'auth:createUser', 'perfilusuario:upsert', 'auth:deleteUser'])
  assert.doesNotMatch(JSON.stringify({ body: res.body, messages }), /sensitive|secret token|password/)
})

test('unexpected upstream exceptions cannot supply their own response text', async () => {
  insertVeterinaria()
  state.auth.createUser = async () => { throw Object.assign(new Error('secret password and token'), { status: 502 }) }
  state.queries.push({ table: 'veterinaria', result: { error: null } })
  const originalConsoleError = console.error
  const messages = []
  console.error = (...args) => messages.push(args.join(' '))
  const res = response()
  try {
    await crearTenant({ body: validBody() }, res)
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(res.statusCode, 500)
  assert.doesNotMatch(JSON.stringify({ body: res.body, messages }), /secret password|token/)
  assert.deepEqual(state.events, ['veterinaria:insert', 'auth:createUser', 'veterinaria:delete'])
})
