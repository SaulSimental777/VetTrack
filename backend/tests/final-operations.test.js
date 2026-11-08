const assert = require('node:assert/strict')
const { before, after, beforeEach, test } = require('node:test')
const Module = require('node:module')
const express = require('express')


const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const state = { calls: [], plans: [] }
const client = {
  from(table) { assert.equal(table, 'perfilusuario'); return { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: state.profile, error: null }) } },
  async rpc(name, args) {
    if (name === 'get_my_permissions') return { data: state.permissions, error: null }
    state.calls.push({ name, args }); const expected = state.plans.shift(); assert.ok(expected, `Unexpected inventory RPC ${name}`)
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
const app = express(); app.use(express.json()); app.use('/api/operacion', require('../routes/final-operations.routes'))
let server, base
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}` })
after(async () => { await new Promise(resolve => server.close(resolve)) })
beforeEach(() => {
  state.calls = []; state.plans = []; state.metadata = {}
  state.profile = { id: id(1), id_veterinaria: id(2), rol: 'admin', activo: true }
  state.permissions = ['dashboard.ver','pagos.ver','pagos.crear','orden_recepcion.procesar','reportes.ver','citas.ver','pacientes.ver','expediente.ver','vacunas.ver','desparasitacion.ver','tratamientos.ver','servicios.ver','inventario.movimientos','inventario.ver','configuracion.ver','configuracion.editar','horarios.ver']
})
const plan = (name, data, check, error = null) => state.plans.push({ name, data, check, error })
const request = async (route, method = 'GET', body, token = 'valid') => {
  const r = await fetch(base + '/api/operacion' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: r.headers.get('content-type')?.includes('application/pdf') ? Buffer.from(await r.arrayBuffer()) : await r.json(), headers: r.headers }
}

test('final operations reject unauthenticated inactive and Superadmin accounts', async () => {
 assert.equal((await request('/dashboard','GET',undefined,null)).status,401)
 state.profile.activo=false;assert.equal((await request('/dashboard')).status,403)
 state.profile.activo=true;state.metadata={super_admin:true};assert.equal((await request('/dashboard')).status,403)
 assert.deepEqual(state.calls,[])
})
test('every final operation requires its own effective permission', async () => {
 state.permissions=[]
 for(const op of ['dashboard','pagos','metodos_pago','orden_pago','reporte','configuracion','horarios_medicos'])assert.equal((await request('/'+op)).status,403)
 for(const op of ['pago_registrar','configuracion_guardar'])assert.equal((await request('/'+op,'POST',{})).status,403)
 assert.deepEqual(state.calls,[])
})
test('payment registration accepts identifiers and received date, never amount price tenant or raw status', async () => {
 const data={id_orden:id(10),id_metodopago:id(11),fecha_pago:'2026-11-07T10:00:00-08:00'}
 for(const extra of [{monto:1},{id_veterinaria:id(2)},{estado:'procesada'},{productos:[]}])assert.equal((await request('/pago_registrar','POST',{...data,...extra})).status,400)
 plan('vettrack_operacion_final',{id_pago:id(12),monto:530},args=>assert.deepEqual(args,{p_operacion:'pago_registrar',p_datos:{...data,fecha_pago:'2026-11-07T18:00:00.000Z'}}))
 assert.equal((await request('/pago_registrar','POST',data)).status,200)
 state.permissions=state.permissions.filter(p=>p!=='orden_recepcion.procesar');assert.equal((await request('/pago_registrar','POST',data)).status,403)
})
test('payment preview id validation and pending delivery errors remain safe and actionable', async () => {
 assert.equal((await request('/orden_pago?id_orden=bad')).status,400)
 assert.equal((await request('/pago_registrar','POST',{id_orden:id(10)})).status,400)
 for(const message of ['Confirma las entregas antes de registrar el pago','Entrega histórica sin precio guardado; requiere revisión']){
  plan('vettrack_operacion_final',null,undefined,{code:'23514',message});const r=await request('/pago_registrar','POST',{id_orden:id(10),id_metodopago:id(11)});assert.equal(r.status,409);assert.ok(r.body.error.length>20)
 }
})
test('all ten reports validate their module permissions and bounded dates', async () => {
 for(const tipo of ['agenda','pacientes','historial','vacunas','desparasitaciones','tratamientos','servicios','uso_inventario','stock_bajo','caducidades']){
  plan('vettrack_operacion_final',{filas:[]},args=>assert.equal(args.p_datos.tipo,tipo));assert.equal((await request('/reporte','POST',{tipo,desde:'2026-11-01',hasta:'2026-11-07',...(tipo==='historial'?{id_mascota:id(20)}:{})})).status,200)
 }
 assert.equal((await request('/reporte?tipo=unknown')).status,400)
 assert.equal((await request('/reporte?tipo=agenda&desde=2000-01-01&hasta=2030-01-01')).status,400)
 assert.equal((await request('/reporte?tipo=agenda&desde=2026-02-30')).status,400)
 assert.equal((await request('/reporte?tipo=historial')).status,400)
 state.permissions=['reportes.ver'];assert.equal((await request('/reporte?tipo=agenda')).status,403)
 state.profile.rol='recepcionista';state.permissions=['reportes.ver','tratamientos.ver'];assert.equal((await request('/reporte?tipo=tratamientos')).status,403)
})
test('settings use real allowlisted clinic columns and reject incomplete mail and insecure URLs', async () => {
 const data={nombre:'Clínica final',direccion:'Dirección',telefono:'6641234567',correo:'clinica@example.com',horario:'Lunes a viernes',descripcion:'Descripción',foto_veterinaria:'https://example.com/logo.png'}
 for(const extra of [{valoracion:5},{id_veterinaria:id(2)},{correo:'lupe@veterinaria'},{foto_veterinaria:'javascript:alert(1)'},{nombre:''}])assert.equal((await request('/configuracion_guardar','POST',{...data,...extra})).status,400)
 plan('vettrack_operacion_final',{guardado:true},args=>assert.deepEqual(args.p_datos,data));assert.equal((await request('/configuracion_guardar','POST',data)).status,200)
})
test('dashboard and settings only access JWT RPC; mutation GET and foreign resources stay forbidden', async () => {
 for(const op of ['dashboard','configuracion','horarios_medicos']){plan('vettrack_operacion_final',{});assert.equal((await request('/'+op)).status,200)}
 assert.equal((await request('/dashboard?id_veterinaria='+id(2))).status,400)
 assert.equal((await request('/pago_registrar')).status,405)
 plan('vettrack_operacion_final',null,undefined,{code:'P0002',message:'Private resource'});const r=await request('/orden_pago?id_orden='+id(10));assert.equal(r.status,404);assert.doesNotMatch(r.body.error,/Private/)
})
