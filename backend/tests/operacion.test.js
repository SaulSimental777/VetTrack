const assert = require('node:assert/strict')
const { before, after, beforeEach, test } = require('node:test')
const Module = require('node:module')
const express = require('express')

// This suite uses the real HTTP routes and permission middleware with in-memory
// Auth/RPC doubles. It never reads .env or contacts Supabase.
const actor = '10000000-0000-4000-8000-000000000001'
const tenant = '20000000-0000-4000-8000-000000000001'
const doctor = '30000000-0000-4000-8000-000000000001'
const patient = '40000000-0000-4000-8000-000000000001'
const owner = '50000000-0000-4000-8000-000000000001'
const service = '60000000-0000-4000-8000-000000000001'
const service2 = '60000000-0000-4000-8000-000000000002'
const specialty = '70000000-0000-4000-8000-000000000001'
const appointment = '80000000-0000-4000-8000-000000000001'
const block = '90000000-0000-4000-8000-000000000001'
const permissions = ['medicos.ver', 'medicos.administrar', 'horarios.ver', 'horarios.administrar', 'servicios.ver', 'servicios.crear', 'servicios.editar', 'servicios.eliminar', 'servicios.editar_precio', 'citas.ver', 'citas.crear', 'citas.editar', 'citas.cancelar', 'citas.asignar_medico', 'citas.forzar_horario']
const state = { calls: [], planned: [] }
const plan = (name, data, error = null, check) => state.planned.push({ name, data, error, check })
const client = {
  from(table) {
    assert.equal(table, 'perfilusuario', 'Clinic operations must use protected JWT RPCs')
    return { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: state.profile, error: null }) }
  },
  async rpc(name, args) {
    if (name === 'get_my_permissions') return { data: state.permissions, error: null }
    state.calls.push({ name, args })
    const expected = state.planned.shift()
    assert.ok(expected, `Unexpected RPC ${name}`)
    assert.equal(name, expected.name)
    expected.check?.(args)
    if (expected.error instanceof Error) throw expected.error
    return { data: expected.data, error: expected.error }
  },
}
const configPath = require.resolve('../config/supabase')
const mocked = new Module(configPath)
mocked.loaded = true
mocked.exports = {
  createUserClient: token => { assert.equal(token, 'valid-token'); return client },
  supabaseAdmin: { auth: {
    getUser: async token => token === 'valid-token'
      ? { data: { user: { id: actor, app_metadata: state.metadata || {} } }, error: null }
      : { data: { user: null }, error: { message: 'invalid' } },
    admin: new Proxy({}, { get() { throw new Error('Auth Admin is forbidden for clinic operations') } }),
  } },
}
require.cache[configPath] = mocked

const medicos = require('../controllers/medicos.controller')
const servicios = require('../controllers/servicios.controller')
const citas = require('../controllers/citas.controller')
const app = express()
app.use(express.json())
app.use('/api/medicos', require('../routes/medicos.routes'))
app.use('/api/servicios', require('../routes/servicios.routes'))
app.use('/api/citas', require('../routes/citas.routes'))
app.use('/api/especialidades', require('../routes/especialidades.routes'))
let server
let baseUrl
before(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise(resolve => server.close(resolve)) })
beforeEach(() => {
  state.calls = []; state.planned = []; state.permissions = [...permissions]; state.metadata = {}
  state.profile = { id: actor, id_veterinaria: tenant, nombre: 'Prueba', rol: 'admin', activo: true }
})
const http = async (route, method = 'GET', body, token = 'valid-token') => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}
const req = (body, extra = {}) => ({ body, query: {}, params: {}, supabase: client, clinicAccess: { id: actor, id_veterinaria: tenant, rol: 'admin', activo: true, permisos: state.permissions }, ...extra })
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } })
const schedule = (changes = {}) => ({ dia_semana: 1, hora_inicio: '09:00', hora_fin: '13:00', ...changes })
const appointmentBody = (changes = {}) => ({ id_mascota: patient, id_dueno: owner, id_medico: doctor, fecha_inicio: '2026-11-09T09:00:00-08:00', motivo: ' Revisión ', servicios: [service, service2], ...changes })
const noSecrets = body => assert.doesNotMatch(JSON.stringify(body), /private upstream|secret-token|service_role|password_hash/)

test('new bookings always start programmed and cannot inject a later workflow state', async () => {
  for (const estado of ['confirmada', 'en_espera', 'no_asistio', 'completada']) {
    assert.equal((await http('/api/citas', 'POST', appointmentBody({ estado }))).status, 400)
  }
  assert.deepEqual(state.calls, [])
})

test('editing without a state does not silently downgrade an existing appointment', async () => {
  plan('vettrack_guardar_cita', { id_cita: appointment, estado: 'confirmada' }, null, args => {
    assert.equal(Object.hasOwn(args.p_datos, 'estado'), false)
  })
  assert.equal((await http(`/api/citas/${appointment}`, 'PUT', appointmentBody())).status, 200)
})

test('new clinic HTTP routes reject missing/invalid JWT, inactive users and global Superadmin before operation RPCs', async () => {
  assert.equal((await http('/api/medicos', 'GET', undefined, null)).status, 401)
  assert.equal((await http('/api/medicos', 'GET', undefined, 'invalid')).status, 401)
  state.profile.activo = false
  assert.equal((await http('/api/servicios')).status, 403)
  state.profile.activo = true
  state.metadata = { super_admin: true }
  assert.equal((await http('/api/citas')).status, 403)
  assert.deepEqual(state.calls, [])
})

test('every operation HTTP route enforces its functional permission before controller RPCs', async () => {
  const cases = [
    ['GET', '/api/medicos'], ['GET', `/api/medicos/${doctor}/horarios`], ['PUT', `/api/medicos/${doctor}/horarios`],
    ['GET', `/api/medicos/${doctor}/bloqueos`], ['POST', `/api/medicos/${doctor}/bloqueos`], ['DELETE', `/api/medicos/${doctor}/bloqueos/${block}`],
    ['GET', `/api/medicos/${doctor}/disponibilidad?fecha=2026-11-09`], ['GET', '/api/servicios'], ['POST', '/api/servicios'],
    ['PUT', `/api/servicios/${service}`], ['DELETE', `/api/servicios/${service}`], ['GET', '/api/citas'], ['GET', '/api/citas/selectores'],
    ['POST', '/api/citas'], ['PUT', `/api/citas/${appointment}`], ['PATCH', `/api/citas/${appointment}/cancelar`],
  ]
  state.permissions = []
  for (const [method, path] of cases) assert.equal((await http(path, method, ['POST', 'PUT'].includes(method) ? {} : undefined)).status, 403, `${method} ${path}`)
  assert.deepEqual(state.calls, [])
})

test('doctor search supports specialty labels and explicitly listing all doctors without requiring a specialty', async () => {
  const doctors = [{ id: doctor, nombre: 'Doctora', activo: true, especialidades: [{ id_especialidad: specialty, nombre: 'Equinos' }, { id_especialidad: service2, nombre: 'Cirugía' }], horario_hoy: [], proxima_cita: null }]
  plan('vettrack_medicos', doctors, null, args => assert.deepEqual(args, { p_q: 'Doctora', p_especialidad: specialty, p_activo: true }))
  const filtered = await http(`/api/medicos?q=Doctora&especialidad=${specialty}&activo=true`)
  assert.equal(filtered.status, 200)
  assert.equal(filtered.body[0].especialidades.length, 2)
  plan('vettrack_medicos', [{ ...doctors[0], especialidades: [] }], null, args => assert.deepEqual(args, { p_q: null, p_especialidad: null, p_activo: null }))
  const all = await http('/api/medicos')
  assert.equal(all.status, 200)
  assert.deepEqual(all.body[0].especialidades, [])
})

test('doctor detail reads use their guarded RPCs and retain the selected doctor identifier', async () => {
  plan('vettrack_horarios', [schedule()], null, args => assert.deepEqual(args, { p_medico: doctor }))
  assert.deepEqual((await http(`/api/medicos/${doctor}/horarios`)).body, [schedule()])
  plan('vettrack_bloqueos', [{ id_bloqueo: block }], null, args => assert.deepEqual(args, { p_medico: doctor }))
  assert.deepEqual((await http(`/api/medicos/${doctor}/bloqueos`)).body, [{ id_bloqueo: block }])
  plan('vettrack_horarios', null, { code: 'P0002', message: 'private upstream doctor in another clinic' })
  const denied = await http(`/api/medicos/${doctor}/horarios`)
  assert.equal(denied.status, 404)
  noSecrets(denied.body)
})

test('weekly schedules allow multiple adjacent blocks and are saved atomically through the JWT RPC', async () => {
  const blocks = [schedule(), schedule({ hora_inicio: '13:00', hora_fin: '15:00' }), schedule({ hora_inicio: '15:00', hora_fin: '18:00' })]
  plan('vettrack_guardar_horarios', blocks, null, args => assert.deepEqual(args, { p_medico: doctor, p_bloques: blocks.map(value => ({ ...value, activo: true })) }))
  const result = await http(`/api/medicos/${doctor}/horarios`, 'PUT', { bloques: blocks })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.horarios, blocks)
})

test('overlapping schedule blocks are rejected before writing; inactive blocks do not cause a false overlap', async () => {
  const result = res()
  await medicos.guardarHorarios(req({ bloques: [schedule(), schedule({ hora_inicio: '12:00', hora_fin: '16:00' })] }, { params: { id: doctor } }), result)
  assert.equal(result.statusCode, 409)
  assert.deepEqual(state.calls, [])
  plan('vettrack_guardar_horarios', [])
  const inactive = res()
  await medicos.guardarHorarios(req({ bloques: [schedule(), schedule({ activo: false })] }, { params: { id: doctor } }), inactive)
  assert.equal(inactive.statusCode, 200)
})

test('schedule validation rejects malformed days, clock values, inverted ranges and tenant fields without RPCs', async () => {
  for (const invalid of [schedule({ dia_semana: 7 }), schedule({ dia_semana: '1' }), schedule({ hora_inicio: '25:00' }), schedule({ hora_fin: '08:00' }), schedule({ activo: 'true' }), schedule({ id_veterinaria: tenant })]) {
    const result = res()
    await medicos.guardarHorarios(req({ bloques: [invalid] }, { params: { id: doctor } }), result)
    assert.equal(result.statusCode, 400)
  }
  assert.deepEqual(state.calls, [])
})

test('blocks use explicit instants and the selected doctor without caller tenant or server-timezone assumptions', async () => {
  plan('vettrack_guardar_bloqueo', { id_bloqueo: block }, null, args => assert.deepEqual(args, { p_medico: doctor, p_datos: { fecha_inicio: '2026-11-09T20:00:00.000Z', fecha_fin: '2026-11-09T21:00:00.000Z', motivo: 'Comida', tipo: 'comida' } }))
  const result = await http(`/api/medicos/${doctor}/bloqueos`, 'POST', { fecha_inicio: '2026-11-09T12:00:00-08:00', fecha_fin: '2026-11-09T13:00:00-08:00', motivo: ' Comida ', tipo: 'comida' })
  assert.equal(result.status, 201)
  plan('vettrack_eliminar_bloqueo', true, null, args => assert.deepEqual(args, { p_medico: doctor, p_id: block }))
  assert.equal((await http(`/api/medicos/${doctor}/bloqueos/${block}`, 'DELETE')).status, 200)
})

test('invalid local-only or impossible block timestamps and reversed intervals are rejected without RPCs', async () => {
  for (const body of [
    { fecha_inicio: '2026-11-09T12:00', fecha_fin: '2026-11-09T13:00-08:00' },
    { fecha_inicio: '2026-02-30T12:00:00Z', fecha_fin: '2026-03-01T12:00:00Z' },
    { fecha_inicio: '2026-11-09T12:00:00Z', fecha_fin: '2026-11-09T11:00:00Z' },
  ]) {
    const result = res()
    await medicos.crearBloqueo(req(body, { params: { id: doctor } }), result)
    assert.equal(result.statusCode, 400)
  }
  assert.deepEqual(state.calls, [])
})

test('availability forwards date, requested duration/services and appointment exclusion and returns server-calculated slots', async () => {
  const availability = { fecha: '2026-11-09', duracion_minutos: 60, zona_horaria: 'America/Tijuana', slots: [{ fecha_inicio: '2026-11-09T09:00:00-08:00', fecha_fin: '2026-11-09T10:00:00-08:00' }] }
  plan('vettrack_disponibilidad', availability, null, args => assert.deepEqual(args, { p_medico: doctor, p_fecha: '2026-11-09', p_duracion: 60, p_servicios: [service, service2], p_excluir_cita: appointment }))
  const result = await http(`/api/medicos/${doctor}/disponibilidad?fecha=2026-11-09&duracion_minutos=60&servicios=${service},${service2}&excluir_cita=${appointment}`)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, availability)
})

test('availability rejects invalid dates, IDs, duplicate services and duration before RPCs', async () => {
  for (const query of [
    { fecha: '2026-02-30' }, { fecha: '2026-11-09', duracion_minutos: '0' }, { fecha: '2026-11-09', duracion_minutos: '1.5' },
    { fecha: '2026-11-09', servicios: `${service},${service}` }, { fecha: '2026-11-09', excluir_cita: 'bad' },
    { fecha: '2026-11-09', id_veterinaria: tenant },
  ]) {
    const result = res()
    await medicos.obtenerDisponibilidad(req(undefined, { params: { id: doctor }, query }), result)
    assert.equal(result.statusCode, 400)
  }
  assert.deepEqual(state.calls, [])
})

test('service creation validates and forwards its catalog price, duration and suggested specialties', async () => {
  const body = { nombre: ' Radiografía ', descripcion: ' Imagen ', costo: 650.5, duracion_minutos: 30, activo: true, especialidades: [specialty] }
  plan('vettrack_guardar_servicio', { id_servicio: service, ...body, nombre: 'Radiografía', descripcion: 'Imagen' }, null, args => assert.deepEqual(args, { p_id: null, p_datos: { ...body, nombre: 'Radiografía', descripcion: 'Imagen' } }))
  assert.equal((await http('/api/servicios', 'POST', body)).status, 201)
})

test('a delegated price editor can update only the price without general service edit permission', async () => {
  state.permissions = ['servicios.editar_precio']
  plan('vettrack_guardar_servicio', { id_servicio: service, costo: 700 }, null, args => assert.deepEqual(args, { p_id: service, p_datos: { costo: 700 } }))
  assert.equal((await http(`/api/servicios/${service}`, 'PUT', { costo: 700 })).status, 200)
  assert.equal((await http(`/api/servicios/${service}`, 'PUT', { costo: 700, nombre: 'No autorizado' })).status, 403)
  assert.equal(state.calls.length, 1)
})

test('creator without price permission can create zero-price services, while nonzero price requires its own grant', async () => {
  state.permissions = ['servicios.crear']
  plan('vettrack_guardar_servicio', { id_servicio: service, costo: 0 })
  assert.equal((await http('/api/servicios', 'POST', { nombre: 'Control', costo: 0 })).status, 201)
  assert.equal((await http('/api/servicios', 'POST', { nombre: 'Control', costo: 1 })).status, 403)
  assert.equal(state.calls.length, 1)
})

test('catalog writes reject invalid monetary precision, duration, repeated tags and caller tenant', async () => {
  for (const changes of [{ costo: -1 }, { costo: '650' }, { costo: 0.001 }, { costo: 100000000 }, { duracion_minutos: 0 }, { duracion_minutos: 1441 }, { duracion_minutos: '30' }, { especialidades: [specialty, specialty] }, { id_veterinaria: tenant }]) {
    const result = res()
    await servicios.guardarServicio(req({ nombre: 'Servicio', ...changes }), result)
    assert.equal(result.statusCode, 400)
  }
  assert.deepEqual(state.calls, [])
})

test('service deletion uses the protected soft-deactivation RPC rather than deleting history', async () => {
  plan('vettrack_eliminar_servicio', true, null, args => assert.deepEqual(args, { p_id: service }))
  assert.equal((await http(`/api/servicios/${service}`, 'DELETE')).status, 200)
})

test('an appointment supports several services and a doctor without any specialty constraint', async () => {
  const data = { id_cita: appointment, servicios: [{ id_servicio: service, precio_aplicado: 650 }, { id_servicio: service2, precio_aplicado: 100 }], subtotal: 750 }
  plan('vettrack_guardar_cita', data, null, args => {
    assert.deepEqual(args, { p_id: null, p_datos: { ...appointmentBody(), fecha_inicio: '2026-11-09T17:00:00.000Z', motivo: 'Revisión', forzar_horario: false, estado: 'programada' } })
    assert.ok(!Object.hasOwn(args.p_datos, 'especialidades'))
    assert.ok(!Object.hasOwn(args.p_datos, 'id_veterinaria'))
    assert.ok(!Object.hasOwn(args.p_datos, 'id_servicio'))
  })
  const result = await http('/api/citas', 'POST', appointmentBody())
  assert.equal(result.status, 201)
  assert.equal(result.body.cita.servicios.length, 2)
  assert.equal(result.body.cita.subtotal, 750)
})

test('appointment snapshots come only from SQL; callers cannot set price, duration end or legacy single-service fields', async () => {
  for (const changes of [{ precio_aplicado: 1 }, { fecha_fin: '2026-11-09T18:00:00Z' }, { id_servicio: service }, { id_veterinaria: tenant }, { servicios: [{ id_servicio: service, precio_aplicado: 1 }] }, { servicios: [] }, { estado: 'en_consulta' }, { estado: 'cancelada' }]) {
    const result = res()
    await citas.guardarCita(req(appointmentBody(changes)), result)
    assert.equal(result.statusCode, 400)
  }
  assert.deepEqual(state.calls, [])
})

test('forcing schedule requires its extra grant and still preserves SQL conflict rejection for blocks and overlaps', async () => {
  state.permissions = ['citas.crear']
  assert.equal((await http('/api/citas', 'POST', appointmentBody({ forzar_horario: true }))).status, 403)
  assert.deepEqual(state.calls, [])
  state.permissions.push('citas.forzar_horario')
  plan('vettrack_guardar_cita', { id_cita: appointment })
  assert.equal((await http('/api/citas', 'POST', appointmentBody({ forzar_horario: true }))).status, 201)
  plan('vettrack_guardar_cita', null, { code: '23514', message: 'private upstream overlap' })
  const conflict = await http('/api/citas', 'POST', appointmentBody({ forzar_horario: true }))
  assert.equal(conflict.status, 409)
  noSecrets(conflict.body)
})

test('cross-tenant doctor/service/patient errors are denied by the JWT RPC without leaking provider details', async () => {
  for (const code of ['42501', 'P0002']) {
    plan('vettrack_guardar_cita', null, { code, message: 'private upstream secret-token' })
    const result = await http('/api/citas', 'POST', appointmentBody())
    assert.equal(result.status, code === '42501' ? 403 : 404)
    noSecrets(result.body)
  }
})

test('minimal appointment selectors require appointment creation/edit permission, not access to owner contact data', async () => {
  state.permissions = ['citas.crear']
  const options = { propietarios: [{ id_dueno: owner, nombre: 'Propietaria' }], pacientes: [{ id_mascota: patient, nombre: 'Paciente', id_dueno: owner }] }
  plan('vettrack_selectores_citas', options)
  const result = await http('/api/citas/selectores')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, options)
  assert.doesNotMatch(JSON.stringify(result.body), /correo|telefono|direccion/)
})

test('appointment range filters use explicit instants and cancellation has its own guarded RPC', async () => {
  plan('vettrack_citas', [], null, args => assert.deepEqual(args, { p_inicio: '2026-11-09T08:00:00.000Z', p_fin: '2026-11-10T08:00:00.000Z', p_medico: doctor, p_estado: 'confirmada' }))
  const search = new URLSearchParams({ inicio: '2026-11-09T00:00:00-08:00', fin: '2026-11-10T00:00:00-08:00', medico: doctor, estado: 'confirmada' })
  assert.equal((await http(`/api/citas?${search}`)).status, 200)
  plan('vettrack_cancelar_cita', { id_cita: appointment, estado: 'cancelada' })
  assert.equal((await http(`/api/citas/${appointment}/cancelar`, 'PATCH')).body.cita.estado, 'cancelada')
})

test('editing an appointment passes its target ID and lets SQL preserve applied service snapshots', async () => {
  plan('vettrack_guardar_cita', { id_cita: appointment, servicios: [{ id_servicio: service, precio_aplicado: 650, duracion_aplicada: 30 }] }, null, args => {
    assert.equal(args.p_id, appointment)
    assert.deepEqual(args.p_datos.servicios, [service])
    assert.equal(args.p_datos.estado, 'confirmada')
  })
  const result = await http(`/api/citas/${appointment}`, 'PUT', appointmentBody({ servicios: [service], estado: 'confirmada' }))
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.cita.servicios, [{ id_servicio: service, precio_aplicado: 650, duracion_aplicada: 30 }])
})

test('clinic operations sanitize both returned and thrown unexpected database errors', async () => {
  for (const error of [{ code: 'XX000', message: 'private upstream secret-token' }, new Error('private upstream secret-token')]) {
    plan('vettrack_servicios', null, error)
    const result = await http('/api/servicios')
    assert.equal(result.status, error instanceof Error ? 500 : 502)
    noSecrets(result.body)
  }
})

test('doctor administrators can maintain specialty labels without user-management grants', async () => {
  state.permissions = ['medicos.administrar']
  plan('vettrack_guardar_especialidad', { id_especialidad: specialty, nombre: 'Equinos', descripcion: null })
  const result = await http('/api/especialidades', 'POST', { nombre: 'Equinos' })
  assert.equal(result.status, 201)
  assert.equal(result.body.id_especialidad, specialty)
})
