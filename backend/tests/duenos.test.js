const assert = require('node:assert/strict')
const { beforeEach, test } = require('node:test')
const Module = require('node:module')

// No .env loading and no network: exercise handlers with a JWT client double.
const state = { queries: [], calls: [], tokens: [] }
const configPath = require.resolve('../config/supabase')
const configModule = new Module(configPath)
configModule.loaded = true
configModule.exports = {
  createUserClient(token) {
    state.tokens.push(token)
    return {
      from(table) {
        const expected = state.queries.shift()
        assert.ok(expected, `Unexpected query: ${table}`)
        assert.equal(table, expected.table)
        const call = { table, methods: [] }
        state.calls.push(call)
        const builder = {}
        for (const method of ['select', 'order', 'eq', 'insert', 'update', 'delete', 'single', 'maybeSingle']) {
          builder[method] = (...args) => {
            call.methods.push({ method, args })
            return builder
          }
        }
        builder.then = (resolve, reject) => Promise.resolve().then(() => {
          if (expected.throws) throw new Error(expected.throws)
          return expected.result
        }).then(resolve, reject)
        return builder
      },
    }
  },
}
require.cache[configPath] = configModule
const handlers = require('../controllers/duenos.controller')
beforeEach(() => { state.queries = []; state.calls = []; state.tokens = [] })
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this },
  json(body) { this.body = body; return this },
})
const request = (body = { nombre: ' Ana ' }) => ({ body, params: { id: 'owner' }, accessToken: 'user-jwt', user: { id: 'user' } })
const query = (table, data, error = null) => state.queries.push({ table, result: { data, error } })
const payload = (method) => state.calls.at(-1).methods.find((item) => item.method === method).args[0]

for (const handler of ['crearDueno', 'actualizarDueno']) {
  for (const [label, body] of [
    ['missing name', {}], ['non-string name', { nombre: 3 }],
    ['blank name', { nombre: '  ' }], ['null body', null], ['array body', []],
    ['invalid telefono', { nombre: 'Ana', telefono: 123 }],
    ['invalid correo type', { nombre: 'Ana', correo: {} }],
    ['invalid correo format', { nombre: 'Ana', correo: 'not-an-email' }],
    ['invalid direccion', { nombre: 'Ana', direccion: [] }],
    ['null optional field', { nombre: 'Ana', telefono: null }],
  ]) {
    test(`${handler}: rejects ${label} before querying`, async () => {
      const res = response()
      await handlers[handler](request(body), res)
      assert.equal(res.statusCode, 400)
      assert.equal(typeof res.body.error, 'string')
      assert.deepEqual(state.calls, [])
      assert.deepEqual(state.tokens, [])
    })
  }
}

test('valid creation trims fields and derives tenant from authenticated profile', async () => {
  query('perfilusuario', { id_veterinaria: 'tenant-a' })
  query('dueno', { id_dueno: 'owner', nombre: 'Ana' })
  const res = response()
  await handlers.crearDueno(request({
    nombre: ' Ana ', telefono: ' 555 ', correo: ' ana@example.com ', direccion: ' Casa ',
    id_veterinaria: 'tenant-b', rol: 'admin', user_id: 'other-user',
  }), res)
  assert.equal(res.statusCode, 201)
  assert.deepEqual(payload('insert'), {
    nombre: 'Ana', telefono: '555', correo: 'ana@example.com', direccion: 'Casa', id_veterinaria: 'tenant-a',
  })
  assert.deepEqual(state.calls[0].methods.find((m) => m.method === 'eq').args, ['id', 'user'])
  assert.deepEqual(state.tokens, ['user-jwt'])
  assert.equal(state.queries.length, 0)
})

test('valid update ignores tenant, role and identity input; optional fields can be omitted', async () => {
  query('dueno', { id_dueno: 'owner', nombre: 'Ana' })
  const res = response()
  await handlers.actualizarDueno(request({ nombre: ' Ana ', id_veterinaria: 'tenant-b', rol: 'admin', user_id: 'other' }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(payload('update'), { nombre: 'Ana', telefono: null, correo: null, direccion: null })
  assert.deepEqual(state.calls[0].methods.find((m) => m.method === 'eq').args, ['id_dueno', 'owner'])
  assert.deepEqual(state.tokens, ['user-jwt'])
})

test('empty optional form strings are stored as null', async () => {
  query('perfilusuario', { id_veterinaria: 'tenant-a' })
  query('dueno', { id_dueno: 'owner', nombre: 'Ana' })
  const res = response()
  await handlers.crearDueno(request({ nombre: 'Ana', telefono: '', correo: '  ', direccion: '' }), res)
  assert.equal(res.statusCode, 201)
  assert.deepEqual(payload('insert'), {
    nombre: 'Ana', telefono: null, correo: null, direccion: null, id_veterinaria: 'tenant-a',
  })
})

test('valid list and deletion continue using the JWT client', async () => {
  query('dueno', [{ id_dueno: 'owner', nombre: 'Ana' }])
  const list = response()
  await handlers.obtenerDuenos(request(), list)
  assert.deepEqual(list.body, [{ id_dueno: 'owner', nombre: 'Ana' }])
  query('dueno', { id_dueno: 'owner' })
  const deleted = response()
  await handlers.eliminarDueno(request(), deleted)
  assert.equal(deleted.statusCode, 200)
  assert.equal(deleted.body.mensaje, 'Propietario eliminado correctamente')
  assert.deepEqual(state.calls[1].methods.find((m) => m.method === 'eq').args, ['id_dueno', 'owner'])
  assert.deepEqual(state.tokens, ['user-jwt', 'user-jwt'])
})

for (const [handler, message] of [
  ['obtenerDuenos', 'No se pudieron consultar los propietarios.'],
  ['crearDueno', 'No se pudo registrar el propietario.'],
  ['actualizarDueno', 'No se pudo actualizar el propietario.'],
  ['eliminarDueno', 'No se pudo eliminar el propietario.'],
]) {
  for (const thrown of [false, true]) {
    test(`${handler}: hides ${thrown ? 'thrown' : 'returned'} provider errors`, async (t) => {
      const secret = 'SQL constraint internal-provider token secret'
      t.mock.method(console, 'error', () => {})
      if (handler === 'crearDueno') query('perfilusuario', { id_veterinaria: 'tenant-a' })
      if (thrown) state.queries.push({ table: 'dueno', throws: secret })
      else query('dueno', null, { message: secret, details: secret, code: '23505' })
      const res = response()
      await handlers[handler](request(), res)
      assert.equal(res.statusCode, thrown ? 500 : 400)
      assert.deepEqual(res.body, { error: message })
      assert.equal(JSON.stringify(res.body).includes(secret), false)
    })
  }
}

test('missing or failing profile prevents insertion without exposing provider details', async () => {
  for (const error of [null, { message: 'internal database details' }]) {
    query('perfilusuario', null, error)
    const res = response()
    await handlers.crearDueno(request(), res)
    assert.equal(res.statusCode, 403)
    assert.deepEqual(res.body, { error: 'El usuario no tiene una veterinaria asignada' })
  }
  assert.equal(state.calls.some((call) => call.table === 'dueno'), false)
})

for (const handler of ['actualizarDueno', 'eliminarDueno']) {
  test(`${handler}: inaccessible or missing owner returns controlled 404`, async () => {
    query('dueno', null)
    const res = response()
    await handlers[handler](request(), res)
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.body, { error: 'Propietario no encontrado' })
  })
}
