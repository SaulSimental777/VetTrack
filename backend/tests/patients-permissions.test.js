const assert = require('node:assert/strict')
const { test } = require('node:test')
const Module = require('node:module')

const configPath = require.resolve('../config/supabase')
const configStub = new Module(configPath)
configStub.loaded = true
configStub.exports = { createUserClient: () => { throw new Error('The request must reuse its JWT client') } }
require.cache[configPath] = configStub
const { obtenerPacientes, obtenerPropietariosPacientes, crearPaciente } = require('../controllers/pacientes.controller')
const ownerId = '10000000-0000-4000-8000-000000000001'
const patientId = '20000000-0000-4000-8000-000000000001'
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this }, json(data) { this.body = data; return this } })

test('patient view uses only the authorized owner selector when full owner visibility is denied', async () => {
  const req = {
    clinicAccess: { permisos: ['pacientes.ver'] },
    supabase: {
      from(table) {
        assert.equal(table, 'mascota')
        return { select() { return this }, order: async () => ({ data: [{ id_mascota: patientId, id_dueno: ownerId, propietario: null }], error: null }) }
      },
      async rpc(name) {
        assert.equal(name, 'vettrack_propietarios_pacientes')
        return { data: [{ id_dueno: ownerId, nombre: 'Nombre autorizado' }], error: null }
      },
    },
  }
  const res = response()
  await obtenerPacientes(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body[0].propietario, { id_dueno: ownerId, nombre: 'Nombre autorizado' })
  assert.doesNotMatch(JSON.stringify(res.body), /correo|telefono|direccion/)
})

test('patient creation validates the owner through the tenant-checked RPC without owner contact privileges', async () => {
  const req = {
    clinicAccess: { permisos: ['pacientes.ver', 'pacientes.crear'] },
    body: { nombre: 'Paciente', id_dueno: ownerId },
    supabase: {
      rpc(name) {
        assert.equal(name, 'vettrack_propietarios_pacientes')
        return { eq(field, value) { assert.equal(field, 'id_dueno'); assert.equal(value, ownerId); return this },
          maybeSingle: async () => ({ data: { id_dueno: ownerId, nombre: 'Propietario' }, error: null }) }
      },
      from(table) {
        assert.equal(table, 'mascota')
        return { insert(data) { assert.equal(data.id_dueno, ownerId); return this }, select() { return this },
          maybeSingle: async () => ({ data: { id_mascota: patientId }, error: null }) }
      },
    },
  }
  const res = response()
  await crearPaciente(req, res)
  assert.equal(res.statusCode, 201)
})

test('the minimal selector returns controlled errors without leaking SQL internals', async () => {
  const res = response()
  await obtenerPropietariosPacientes({ supabase: { rpc: async () => ({ error: { message: 'private SQL details' }, data: null }) } }, res)
  assert.equal(res.statusCode, 500)
  assert.doesNotMatch(JSON.stringify(res.body), /private SQL/)
})
