const assert = require('node:assert/strict')
const { before, after, beforeEach, test } = require('node:test')
const Module = require('node:module')
const express = require('express')
const { generateClinicalPDF, validatePrescription, titles } = require('../services/clinical-pdf')

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const state = { calls: [], plans: [] }
const client = {
  from(table) { assert.equal(table, 'perfilusuario'); return { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: state.profile, error: null }) } },
  async rpc(name, args) {
    if (name === 'get_my_permissions') return { data: state.permissions, error: null }
    state.calls.push({ name, args }); const expected = state.plans.shift(); assert.ok(expected, `Unexpected clinical RPC ${name}`)
    assert.equal(name, expected.name); expected.check?.(args)
    return { data: expected.data, error: expected.error }
  },
}
const configPath = require.resolve('../config/supabase')
const fake = new Module(configPath); fake.loaded = true
fake.exports = { createUserClient: token => { assert.equal(token, 'valid'); return client }, supabaseAdmin: { auth: {
  getUser: async token => token === 'valid' ? { data: { user: { id: id(1), app_metadata: state.metadata || {} } }, error: null } : { data: { user: null }, error: { message: 'invalid' } },
  admin: new Proxy({}, { get() { throw Error('Clinical CRUD never uses Auth Admin') } }),
} } }
require.cache[configPath] = fake
const app = express(); app.use(express.json()); app.use('/api/clinica', require('../routes/clinical.routes'))
let server, base
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}` })
after(async () => { await new Promise(resolve => server.close(resolve)) })
beforeEach(() => {
  state.calls = []; state.plans = []; state.metadata = {}
  state.profile = { id: id(1), id_veterinaria: id(2), rol: 'medico', activo: true }
  state.permissions = ['consultas.ver', 'consultas.crear', 'consultas.editar', 'consultas.finalizar', 'consultas.reabrir', 'diagnosticos.ver', 'diagnosticos.crear', 'diagnosticos.editar', 'tratamientos.ver', 'tratamientos.crear', 'tratamientos.editar', 'recetas.ver', 'recetas.crear', 'recetas.editar', 'vacunas.ver', 'vacunas.crear', 'vacunas.editar', 'desparasitacion.ver', 'desparasitacion.crear', 'desparasitacion.editar', 'estudios.ver', 'estudios.crear', 'estudios.editar', 'expediente.ver', 'orden_recepcion.ver', 'orden_recepcion.procesar', 'configuracion.editar']
})
const plan = (name, data, check, error = null) => state.plans.push({ name, data, check, error })
const request = async (route, method = 'GET', body, token = 'valid') => {
  const r = await fetch(base + '/api/clinica' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: r.headers.get('content-type')?.includes('application/pdf') ? Buffer.from(await r.arrayBuffer()) : await r.json(), headers: r.headers }
}
const medication = (group = 'II') => ({ nombre_medicamento: 'Medicamento de prueba', principio_activo: 'Registrado por MVZ', concentracion: 'Concentración', presentacion: 'Presentación', dosis: 'Dosis registrada', frecuencia: 'Frecuencia registrada', duracion: 'Duración registrada', via_administracion: 'Vía registrada', cantidad: 1, grupo_prescripcion: group, indicaciones: 'Uso según MVZ', tiempo_retiro: 'No aplica', entregar: false })
const document = (kind = 'receta_simple', group = 'II') => ({
  id_documento: id(10), id_consulta: id(3), revision: 1, tipo: kind, creado_en: '2026-11-07T00:00:00Z',
  contenido: { consulta: { motivo_consulta: 'Motivo', anamnesis: 'Texto clínico', peso: 12, fecha_fin: '2026-11-07T00:00:00Z', indicaciones: 'Seguimiento', proxima_cita: '2026-12-01' },
    contexto: { clinica: { nombre: 'Clínica prueba', direccion: 'Domicilio profesional', telefono: '6641234567' }, propietario: { nombre: 'Propietario' }, paciente: { nombre: 'Paciente', especie: 'Perro', raza: 'Mestizo' }, medico: { nombre: 'MVZ Prueba', cedula_profesional: '12345678' } },
    receta: { indicaciones: 'Indicaciones', detalles: [medication(group), medication('III')] }, diagnosticos: [{ tipo: 'definitivo', descripcion: 'Diagnóstico' }], tratamientos: [{ descripcion: 'Tratamiento', duracion: 'Periodo registrado' }], servicios: [{ nombre: 'Consulta', precio_aplicado: 450 }],
  },
})

test('clinical endpoints authenticate, reject inactive users and keep Superadmin separate', async () => {
  assert.equal((await request('/consultas', 'GET', undefined, null)).status, 401)
  assert.equal((await request('/consultas', 'GET', undefined, 'bad')).status, 401)
  state.profile.activo = false; assert.equal((await request('/consultas')).status, 403)
  state.profile.activo = true; state.metadata = { super_admin: true }; assert.equal((await request('/consultas')).status, 403)
  assert.deepEqual(state.calls, [])
})
test('all clinical HTTP actions enforce functional permissions before RPCs', async () => {
  state.permissions = []
  const routes = [['GET', '/consultas'], ['POST', `/citas/${id(3)}/iniciar`], ['GET', `/consultas/${id(3)}`], ['PUT', `/consultas/${id(3)}`], ['POST', `/consultas/${id(3)}/registros/diagnostico`], ['POST', `/consultas/${id(3)}/servicios`], ['POST', `/consultas/${id(3)}/finalizar`], ['POST', `/consultas/${id(3)}/reabrir`], ['PUT', `/medicos/${id(1)}/cedula`], ['GET', `/pacientes/${id(4)}/expediente`], ['GET', '/ordenes'], ['POST', `/ordenes/${id(5)}/procesar`], ['GET', `/documentos/${id(10)}`]]
  for (const [method, route] of routes) assert.equal((await request(route, method, method === 'GET' ? undefined : {})).status, 403, route)
  assert.deepEqual(state.calls, [])
})
test('reception cannot edit diagnoses even when mistakenly delegated a clinical permission', async () => {
  state.profile.rol = 'recepcionista'
  assert.equal((await request(`/consultas/${id(3)}/registros/diagnostico`, 'POST', { tipo: 'definitivo', descripcion: 'Not allowed' })).status, 403)
  assert.deepEqual(state.calls, [])
})
test('start and clinical edits derive all ownership from guarded JWT RPCs', async () => {
  plan('vettrack_iniciar_consulta', { consulta: { id_consulta: id(3) } }, args => assert.deepEqual(args, { p_cita: id(4) }))
  assert.equal((await request(`/citas/${id(4)}/iniciar`, 'POST')).status, 200)
  plan('vettrack_guardar_consulta', { consulta: { id_consulta: id(3) } }, args => {
    assert.deepEqual(args, { p_id: id(3), p_datos: { motivo_consulta: 'Revisión', temperatura: 38.5, peso: 12 } })
  })
  assert.equal((await request(`/consultas/${id(3)}`, 'PUT', { motivo_consulta: ' Revisión ', temperatura: 38.5, peso: 12 })).status, 200)
  assert.equal((await request(`/consultas/${id(3)}`, 'PUT', { id_veterinaria: id(8) })).status, 400)
  assert.equal((await request(`/consultas/${id(3)}`, 'PUT', { temperatura: 80 })).status, 400)
})
test('clinical records validate their own type, required fields, dates and HTTPS files', async () => {
  for (const [kind, body] of [['diagnostico', { tipo: 'unknown', descripcion: 'X' }], ['vacuna', { nombre: 'Vacuna', fecha_aplicacion: '2030-02-30' }], ['estudio', { nombre: 'Estudio', tipo: 'otro', fecha: '2030-01-01', archivo_url: 'javascript:alert(1)' }], ['desparasitacion', { producto: 'Producto', dosis: 'Dosis', fecha: '2030-01-01', id_mascota: id(8) }]]) {
    assert.equal((await request(`/consultas/${id(3)}/registros/${kind}`, 'POST', body)).status, 400)
  }
  plan('vettrack_guardar_registro_clinico', {}, args => assert.equal(args.p_datos.tipo, 'definitivo'))
  assert.equal((await request(`/consultas/${id(3)}/registros/diagnostico`, 'POST', { descripcion: 'Hallazgo', tipo: 'definitivo' })).status, 200)
})
test('multi-medication prescriptions are inventory-independent and do not move stock', async () => {
  plan('vettrack_guardar_registro_clinico', {}, args => {
    assert.equal(args.p_tipo, 'receta'); assert.equal(args.p_datos.detalles.length, 2)
    assert.equal(args.p_datos.detalles[0].grupo_prescripcion, 'I')
    assert.equal(Object.hasOwn(args.p_datos.detalles[0], 'id_producto'), false)
  })
  assert.equal((await request(`/consultas/${id(3)}/registros/receta`, 'POST', { detalles: [medication('I'), medication('II')] })).status, 200)
  assert.equal(state.calls.length, 1)
  assert.equal((await request(`/consultas/${id(3)}/registros/receta`, 'POST', { detalles: [medication('unknown')] })).status, 400)
})
test('prescription supports optional product UUID while all stock changes stay separate', async () => {
  plan('vettrack_guardar_registro_clinico', {}, args => assert.equal(args.p_datos.detalles[0].id_producto, id(25)))
  assert.equal((await request(`/consultas/${id(3)}/registros/receta`, 'POST', { detalles: [{ ...medication(), id_producto: id(25) }] })).status, 200)
  assert.equal((await request(`/consultas/${id(3)}/registros/receta`, 'POST', { detalles: [{ ...medication(), id_producto: 'invalid' }] })).status, 400)
  assert.equal(state.calls.length, 1)
})

test('professional license, additional services and reopening are bounded and tenant-free', async () => {
  assert.equal((await request(`/medicos/${id(1)}/cedula`, 'PUT', { cedula_profesional: 'bad' })).status, 400)
  plan('vettrack_cedula_medico', {}, args => assert.deepEqual(args, { p_medico: id(1), p_cedula: '12345678' }))
  assert.equal((await request(`/medicos/${id(1)}/cedula`, 'PUT', { cedula_profesional: '12345678' })).status, 200)
  plan('vettrack_agregar_servicio_consulta', {}, args => assert.deepEqual(args, { p_consulta: id(3), p_servicio: id(4) }))
  assert.equal((await request(`/consultas/${id(3)}/servicios`, 'POST', { id_servicio: id(4) })).status, 200)
  assert.equal((await request(`/consultas/${id(3)}/reabrir`, 'POST', { motivo: ' ' })).status, 400)
})
test('finalizing generates all snapshots automatically and retries remain idempotent', async () => {
  const docs = Object.keys(titles).map((tipo, index) => ({ ...document(tipo), id_documento: id(10 + index) }))
  plan('vettrack_finalizar_consulta', { consulta: { revision: 1 }, documentos: docs.map(({ contenido, ...meta }) => { void contenido; return meta }) })
  for (const doc of docs) {
    if (doc.tipo === 'orden_recepcion') doc.contenido = { ...doc.contenido.contexto, consulta: doc.contenido.consulta, servicios: doc.contenido.servicios, productos: [] }
    plan('vettrack_documento_clinico', doc)
  }
  const result = await request(`/consultas/${id(3)}/finalizar`, 'POST')
  assert.equal(result.status, 200); assert.equal(result.body.documentos_pendientes, false)
})
test('finalization explains missing license without exposing database errors', async () => {
  plan('vettrack_finalizar_consulta', null, null, { code: '22023', message: 'Cédula profesional requerida para emitir receta' })
  const result = await request(`/consultas/${id(3)}/finalizar`, 'POST')
  assert.equal(result.status, 400); assert.match(result.body.error, /cédula/)
  assert.doesNotMatch(JSON.stringify(result.body), /private\.|auth.users|service_role/)
})
test('clinical downloads are authenticated, private and generated from frozen data', async () => {
  plan('vettrack_documento_clinico', document())
  const result = await request(`/documentos/${id(10)}`)
  assert.equal(result.status, 200); assert.equal(result.headers.get('content-type'), 'application/pdf')
  assert.match(result.headers.get('cache-control'), /no-store/)
  assert.ok(result.body.subarray(0, 5).equals(Buffer.from('%PDF-')))
  assert.ok(result.body.includes(Buffer.from('%%EOF')))
})
test('reception may download an administrative order but SQL denies clinical documents', async () => {
  state.profile.rol = 'recepcionista'; state.permissions = ['orden_recepcion.ver']
  plan('vettrack_documento_clinico', null, null, { code: '42501', message: 'secret-token private upstream' })
  const r = await request(`/documentos/${id(10)}`)
  assert.equal(r.status, 403); assert.doesNotMatch(JSON.stringify(r.body), /secret-token|private upstream/)
})
test('PDF generation rejects Group I, unclassified medications and missing professional data', async () => {
  assert.throws(() => validatePrescription(document('receta_simple', 'I').contenido), /cuantificada autorizada/)
  assert.throws(() => validatePrescription(document('receta_simple', 'no_clasificado').contenido), /Clasifica/)
  const missing = document(); missing.contenido.contexto.medico.cedula_profesional = null
  assert.throws(() => validatePrescription(missing.contenido), /cédula/)
  await assert.rejects(generateClinicalPDF(document('receta_simple', 'I')), /cuantificada autorizada/)
})
