const assert = require('node:assert/strict')
const { beforeEach, test } = require('node:test')
const Module = require('node:module')

// No credentials or network. No administrative client is available to handlers.
const state = { queries: [], calls: [], tokens: [] }
const configPath = require.resolve('../config/supabase')
const configModule = new Module(configPath)
configModule.loaded = true
configModule.exports = {
  createUserClient(token) {
    state.tokens.push(token)
    return { from(table) {
      const expected = state.queries.shift()
      assert.ok(expected, `Unexpected query: ${table}`)
      assert.equal(table, expected.table)
      const call = { table, methods: [] }
      state.calls.push(call)
      const builder = {}
      for (const method of ['select', 'order', 'eq', 'insert', 'update', 'delete', 'maybeSingle']) {
        builder[method] = (...args) => { call.methods.push({ method, args }); return builder }
      }
      builder.then = (resolve, reject) => Promise.resolve().then(() => {
        if (expected.throws) throw new Error('private provider details')
        return expected.result
      }).then(resolve, reject)
      return builder
    } }
  },
}
require.cache[configPath] = configModule
const handlers = require('../controllers/pacientes.controller')
const ownerId = '11111111-1111-4111-8111-111111111111'
const patientId = '22222222-2222-4222-8222-222222222222'
const patient = { id_mascota: patientId, nombre: 'Luna', propietario: { id_dueno: ownerId, nombre: 'Ana' } }
const request = (changes = {}) => ({ body: { nombre: ' Luna ', id_dueno: ownerId, ...changes }, params: { id: patientId }, accessToken: 'user-jwt' })
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } })
const query = (table, data, error = null) => state.queries.push({ table, result: { data, error } })
const payload = (method) => state.calls.at(-1).methods.find(item => item.method === method).args[0]
const privateError = { code: 'XX000', message: 'SQL internal secret', details: 'private constraint' }

beforeEach(() => { state.queries = []; state.calls = []; state.tokens = [] })

test('GET returns patients with owner relationship through JWT client', async () => {
  query('mascota', [patient])
  const res = response()
  await handlers.obtenerPacientes(request(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, [patient])
  assert.match(state.calls[0].methods.find(item => item.method === 'select').args[0], /propietario:dueno\(id_dueno, nombre\)/)
  assert.deepEqual(state.tokens, ['user-jwt'])
})

test('POST trims basic data, ignores client tenant/identity/legacy fields and returns 201', async () => {
  query('dueno', { id_dueno: ownerId })
  query('mascota', patient)
  const res = response()
  await handlers.crearPaciente(request({ especie: ' Gato ', raza: ' Mestizo ', sexo: ' Hembra ',
    fecha_nacimiento: '2020-02-29', peso_actual: 3.5, observaciones: ' Tranquila ',
    id_veterinaria: 'foreign', tenant_id: 'foreign', user_id: 'foreign', rol: 'admin', edad: 999, foto_mascota: 'untrusted',
  }), res)
  assert.equal(res.statusCode, 201)
  assert.deepEqual(payload('insert'), { nombre: 'Luna', id_dueno: ownerId, especie: 'Gato', raza: 'Mestizo', sexo: 'Hembra',
    fecha_nacimiento: '2020-02-29', peso_actual: 3.5, observaciones: 'Tranquila' })
  assert.deepEqual(state.calls[0].methods.find(item => item.method === 'eq').args, ['id_dueno', ownerId])
  assert.deepEqual(state.tokens, ['user-jwt'])
})

for (const handler of ['crearPaciente', 'actualizarPaciente']) {
  for (const [label, changes] of [
    ['missing name', { nombre: undefined }], ['non-string name', { nombre: 3 }], ['blank name', { nombre: ' ' }],
    ['long name', { nombre: 'x'.repeat(101) }], ['missing owner', { id_dueno: undefined }],
    ['invalid owner UUID', { id_dueno: 'foreign-owner' }], ['non-string owner', { id_dueno: {} }],
    ['invalid species', { especie: 3 }], ['invalid breed', { raza: [] }], ['invalid sex', { sexo: {} }],
    ['invalid notes', { observaciones: true }], ['long breed', { raza: 'x'.repeat(101) }],
    ['invalid date type', { fecha_nacimiento: 2020 }], ['impossible date', { fecha_nacimiento: '2023-02-29' }],
    ['future date', { fecha_nacimiento: '9999-12-31' }], ['wrong date format', { fecha_nacimiento: '01/01/2020' }],
    ['negative weight', { peso_actual: -1 }], ['zero weight', { peso_actual: 0 }],
    ['string weight', { peso_actual: '3.5' }], ['infinite weight', { peso_actual: Infinity }],
    ['tiny weight', { peso_actual: 0.0001 }], ['out-of-range weight', { peso_actual: 100000 }],
    ['weight rounding overflow', { peso_actual: 99999.9999 }],
  ]) {
    test(`${handler}: rejects ${label} without a database request`, async () => {
      const res = response()
      await handlers[handler](request(changes), res)
      assert.equal(res.statusCode, 400)
      assert.deepEqual(state.calls, [])
      assert.deepEqual(state.tokens, [])
    })
  }
  test(`${handler}: rejects null body`, async () => {
    const req = request(); req.body = null
    const res = response()
    await handlers[handler](req, res)
    assert.equal(res.statusCode, 400)
  })
}

test('POST permits missing and empty optional fields without inventing patient data', async () => {
  query('dueno', { id_dueno: ownerId }); query('mascota', patient)
  const res = response()
  await handlers.crearPaciente(request({ raza: '  ', sexo: null }), res)
  assert.equal(res.statusCode, 201)
  assert.deepEqual(payload('insert'), { nombre: 'Luna', id_dueno: ownerId, especie: null, raza: null,
    sexo: null, fecha_nacimiento: null, peso_actual: null, observaciones: null })
})

test('PUT allows assigning a different visible owner and keeps the patient filter', async () => {
  const newOwner = '33333333-3333-4333-8333-333333333333'
  query('mascota', { id_mascota: patientId }); query('dueno', { id_dueno: newOwner }); query('mascota', patient)
  const res = response()
  await handlers.actualizarPaciente(request({ id_dueno: newOwner }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(payload('update').id_dueno, newOwner)
  assert.deepEqual(state.calls.at(-1).methods.find(item => item.method === 'eq').args, ['id_mascota', patientId])
})

for (const handler of ['crearPaciente', 'actualizarPaciente']) {
  test(`${handler}: unavailable foreign owner cannot be written`, async () => {
    if (handler === 'actualizarPaciente') query('mascota', { id_mascota: patientId })
    query('dueno', null)
    const res = response()
    await handlers[handler](request(), res)
    assert.equal(res.statusCode, 400)
    assert.deepEqual(res.body, { error: 'El propietario seleccionado no está disponible.' })
    assert.equal(state.calls.some(call => call.methods.some(item => ['insert', 'update'].includes(item.method))), false)
  })
  test(`${handler}: RLS write rejection remains controlled after owner lookup`, async () => {
    if (handler === 'actualizarPaciente') query('mascota', { id_mascota: patientId })
    query('dueno', { id_dueno: ownerId }); query('mascota', null, { ...privateError, code: '42501' })
    const res = response()
    await handlers[handler](request(), res)
    assert.equal(res.statusCode, 400)
    assert.deepEqual(res.body, { error: 'El propietario seleccionado no está disponible.' })
  })
}

for (const handler of ['actualizarPaciente', 'eliminarPaciente']) {
  test(`${handler}: invisible or nonexistent patient returns 404`, async () => {
    query('mascota', null)
    const res = response()
    await handlers[handler](request(), res)
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.body, { error: 'Paciente no encontrado.' })
    assert.equal(state.calls.length, 1)
  })
  test(`${handler}: malformed patient id is rejected`, async () => {
    const req = request(); req.params.id = 'invalid'
    const res = response()
    await handlers[handler](req, res)
    assert.equal(res.statusCode, 400)
    assert.deepEqual(state.calls, [])
  })
}

test('DELETE succeeds without querying closed clinical modules', async () => {
  query('mascota', { id_mascota: patientId })
  const res = response()
  await handlers.eliminarPaciente(request(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { mensaje: 'Paciente eliminado correctamente.' })
  assert.deepEqual(state.calls[0].methods.find(item => item.method === 'eq').args, ['id_mascota', patientId])
  assert.deepEqual(state.tokens, ['user-jwt'])
})

test('DELETE with incoming dependencies returns 409 without leaking constraint details', async () => {
  query('mascota', null, { ...privateError, code: '23503' })
  const res = response()
  await handlers.eliminarPaciente(request(), res)
  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.body, { error: 'No se puede eliminar el paciente porque tiene información relacionada.' })
})

for (const [handler, message] of [
  ['obtenerPacientes', 'No se pudieron cargar los pacientes.'], ['crearPaciente', 'No se pudo registrar el paciente.'],
  ['actualizarPaciente', 'No se pudo actualizar el paciente.'], ['eliminarPaciente', 'No se pudo eliminar el paciente.'],
]) {
  for (const thrown of [false, true]) {
    test(`${handler}: sanitizes ${thrown ? 'thrown' : 'returned'} provider error`, async () => {
      if (handler === 'crearPaciente') query('dueno', { id_dueno: ownerId })
      if (handler === 'actualizarPaciente') { query('mascota', { id_mascota: patientId }); query('dueno', { id_dueno: ownerId }) }
      if (thrown) state.queries.push({ table: 'mascota', throws: true })
      else query('mascota', null, privateError)
      const res = response()
      await handlers[handler](request(), res)
      assert.equal(res.statusCode, 500)
      assert.deepEqual(res.body, { error: message })
    })
  }
}

test('patient router requires the existing auth middleware for all four endpoints', () => {
  // Router inspection uses a stub, leaving auth.js and its implementation intact.
  const authPath = require.resolve('../middleware/auth')
  const authModule = new Module(authPath)
  const auth = () => {}
  authModule.loaded = true; authModule.exports = auth; require.cache[authPath] = authModule
  const router = require('../routes/pacientes.routes')
  assert.equal(router.stack[0].handle, auth)
  for (const [method, path, handler] of [['get', '/', 'obtenerPacientes'], ['post', '/', 'crearPaciente'],
    ['put', '/:id', 'actualizarPaciente'], ['delete', '/:id', 'eliminarPaciente']]) {
    const route = router.stack.find(layer => layer.route?.methods[method] && layer.route.path === path).route
    assert.equal(route.stack.at(-1).handle, handlers[handler])
    assert.equal(route.stack.length, 2, 'Every patient endpoint also requires its functional permission')
  }
})
