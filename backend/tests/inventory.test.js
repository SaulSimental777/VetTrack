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
const app = express(); app.use(express.json()); app.use('/api/inventario', require('../routes/inventory.routes'))
let server, base
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}` })
after(async () => { await new Promise(resolve => server.close(resolve)) })
beforeEach(() => {
  state.calls = []; state.plans = []; state.metadata = {}
  state.profile = { id: id(1), id_veterinaria: id(2), rol: 'medico', activo: true }
  state.permissions = ['inventario.ver','inventario.crear','inventario.editar','inventario.ajustar','inventario.movimientos','inventario.uso_clinico','inventario.entregar','medicamentos.ver','venta_libre.ver','venta_libre.preparar','proveedores.ver','proveedores.crear','proveedores.editar','compras.ver','compras.crear','compras.recibir','orden_recepcion.ver']
})
const plan = (name, data, check, error = null) => state.plans.push({ name, data, check, error })
const request = async (route, method = 'GET', body, token = 'valid') => {
  const r = await fetch(base + '/api/inventario' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, body: r.headers.get('content-type')?.includes('application/pdf') ? Buffer.from(await r.arrayBuffer()) : await r.json(), headers: r.headers }
}

test('inventory authenticates and rejects inactive accounts and global Superadmin', async () => {
  assert.equal((await request('/productos', 'GET', undefined, null)).status, 401)
  state.profile.activo = false; assert.equal((await request('/productos')).status, 403)
  state.profile.activo = true; state.metadata = { super_admin: true }; assert.equal((await request('/productos')).status, 403)
  assert.deepEqual(state.calls, [])
})
test('inventory and procurement operations enforce each functional permission before RPC', async () => {
  state.permissions = []
  for (const op of ['productos','medicamentos','venta_catalogo','movimientos','proveedores','compras','ventas','entregas_receta']) assert.equal((await request('/'+op)).status,403)
  for (const op of ['producto_guardar','proveedor_guardar','mover','uso_clinico','compra_crear','compra_recibir','venta_preparar','venta_entregar','receta_entregar']) assert.equal((await request('/'+op,'POST',{})).status,403)
  assert.deepEqual(state.calls, [])
})
test('catalog projection comes only from user JWT RPC and tenant injection is rejected', async () => {
  plan('vettrack_inventario',[{ nombre: 'Medicina', stock_actual: 5 }],args=>assert.deepEqual(args,{p_operacion:'productos',p_datos:{}}))
  assert.equal((await request('/productos')).status,200)
  assert.equal((await request('/productos?id_veterinaria='+id(2))).status,400)
  assert.equal((await request('/producto_guardar','POST',{nombre:'Producto',stock_actual:99})).status,400)
})
test('stock movement validates sign precision and idempotency and handles insufficient stock safely', async () => {
  const data={id_producto:id(10),tipo:'salida',cantidad:2,idempotencia:id(20),motivo:'Entrega'}
  for(const changed of [{cantidad:-2},{cantidad:0},{cantidad:1.0001},{cantidad:'2'},{idempotencia:'bad'},{motivo:''},{tipo:'compra'}]) assert.equal((await request('/mover','POST',{...data,...changed})).status,400)
  plan('vettrack_inventario',null,args=>assert.deepEqual(args.p_datos,data),{code:'23514',message:'Existencias insuficientes'})
  const r=await request('/mover','POST',data);assert.equal(r.status,409);assert.match(r.body.error,/Existencias insuficientes/)
})
test('purchase details reject duplicate and foreign fields and receipt keeps same id', async () => {
  const item={id_producto:id(10),cantidad:2,precio_unitario:25.5}
  assert.equal((await request('/compra_crear','POST',{id_proveedor:id(15),detalles:[item,item]})).status,400)
  assert.equal((await request('/compra_crear','POST',{id_proveedor:id(15),detalles:[{...item,id_veterinaria:id(2)}]})).status,400)
  plan('vettrack_inventario',{id:id(17)},args=>assert.deepEqual(args.p_datos,{id_proveedor:id(15),detalles:[item]}))
  assert.equal((await request('/compra_crear','POST',{id_proveedor:id(15),detalles:[item]})).status,200)
  plan('vettrack_inventario',{estado:'recibida'},args=>assert.deepEqual(args,{p_operacion:'compra_recibir',p_datos:{id:id(17)}}))
  assert.equal((await request('/compra_recibir','POST',{id:id(17)})).status,200)
})
test('free sale uses server price, physical delivery and clinical usage use distinct RPC operations', async () => {
  assert.equal((await request('/venta_preparar','POST',{detalles:[{id_producto:id(10),cantidad:1,precio_unitario:0}]})).status,400)
  for(const [op,data] of [['venta_preparar',{detalles:[{id_producto:id(10),cantidad:1}]}],['venta_entregar',{id:id(12)}],['uso_clinico',{id_producto:id(10),id_consulta:id(14),cantidad:1,idempotencia:id(15),motivo:'Aplicación'}],['receta_entregar',{id_orden:id(16),id_detalle:id(17)}]]){
    plan('vettrack_inventario',{},args=>assert.equal(args.p_operacion,op));assert.equal((await request('/'+op,'POST',data)).status,200)
  }
})
test('catalog edit requires editar instead of crear and suppliers validate real email', async () => {
  state.permissions=['inventario.crear','proveedores.crear']
  assert.equal((await request('/producto_guardar','POST',{id:id(10)})).status,403)
  assert.equal((await request('/proveedor_guardar','POST',{nombre:'Proveedor',correo:'lupe@veterinaria'})).status,400)
  plan('vettrack_inventario',{id_proveedor:id(12)})
  assert.equal((await request('/proveedor_guardar','POST',{nombre:'Proveedor',correo:'lupe@veterinaria.com'})).status,200)
})
test('cross tenant failures return safe errors and stock mutation cannot use GET', async () => {
  plan('vettrack_inventario',null,undefined,{code:'P0002',message:'Private production detail'})
  const r=await request('/compra_recibir','POST',{id:id(12)});assert.equal(r.status,404);assert.doesNotMatch(r.body.error,/Private/)
  assert.equal((await request('/compra_recibir?id='+id(12))).status,405)
  assert.equal((await request('/not_real')).status,404)
})

test('lot and recent receipt filters validate expiry windows and reuse existing permissions', async () => {
  for (const route of ['/lotes?dias=7','/lotes?estado=unknown','/recepciones?dias=8','/lotes?id_veterinaria='+id(2)]) assert.equal((await request(route)).status,400)
  plan('vettrack_inventario',[],args=>assert.deepEqual(args,{p_operacion:'lotes',p_datos:{id_producto:id(10),dias:60,estado:'proximos'}}))
  assert.equal((await request('/lotes?id_producto='+id(10)+'&dias=60&estado=proximos')).status,200)
  state.permissions=['inventario.ver']
  assert.equal((await request('/recepciones?dias=7')).status,403)
  plan('vettrack_inventario',[])
  assert.equal((await request('/lotes')).status,200)
})
test('purchase receipt accepts split lots and supplier document without modifying requested quantities', async () => {
  const data={id:id(17),fecha_documento:'2026-11-06',folio_documento:'REM-1',documento_url:'https://example.com/remision.pdf',observaciones:'Dos lotes',recepciones:[{id_compra_detalle:id(18),cantidad:3,precio_unitario:20,numero_lote:'A',fecha_caducidad:'2027-01-20'},{id_compra_detalle:id(18),cantidad:2,precio_unitario:21,numero_lote:'B',fecha_caducidad:'2027-06-15'}]}
  plan('vettrack_inventario',{estado:'recibida'},args=>assert.deepEqual(args.p_datos,data))
  assert.equal((await request('/compra_recibir','POST',data)).status,200)
  for (const change of [{fecha_documento:'2026-02-30'},{documento_url:'http://example.com/a'},{documento_url:'https://user:secret@example.com/a'},{recepciones:[]},{recepciones:[{...data.recepciones[0],cantidad:0}]},{recepciones:[{...data.recepciones[0],numero_lote:null}]},{recepciones:[{...data.recepciones[0],id_veterinaria:id(2)}]}]) assert.equal((await request('/compra_recibir','POST',{...data,...change})).status,400)
})
test('manual lot entry validates date and lot number; exits rely on server FEFO', async () => {
  const data={id_producto:id(10),tipo:'entrada',cantidad:2,idempotencia:id(20),motivo:'Entrada de lote',numero_lote:'ABC',fecha_caducidad:'2027-01-20'}
  plan('vettrack_inventario',{},args=>assert.deepEqual(args.p_datos,data))
  assert.equal((await request('/mover','POST',data)).status,200)
  for(const change of [{tipo:'salida'},{numero_lote:'a'.repeat(101)},{fecha_caducidad:'2027-02-30'},{numero_lote:null}])assert.equal((await request('/mover','POST',{...data,...change})).status,400)
  plan('vettrack_inventario',null,undefined,{code:'23514',message:'Existencias vigentes insuficientes; hay lotes caducados o inactivos'})
  const r=await request('/mover','POST',{id_producto:id(10),tipo:'salida',cantidad:2,idempotencia:id(21),motivo:'Entrega'});assert.equal(r.status,409);assert.match(r.body.error,/lotes caducados/)
})
test('new purchase preserves supplier document metadata using the JWT RPC', async () => {
  const data={id_proveedor:id(15),detalles:[{id_producto:id(10),cantidad:2,precio_unitario:20}],fecha_solicitud:'2026-11-06',fecha_documento:null,folio_documento:'SOL-1',documento_url:null,observaciones:'Solicitud'}
  plan('vettrack_inventario',{id:id(17)},args=>assert.deepEqual(args.p_datos,data))
  assert.equal((await request('/compra_crear','POST',data)).status,200)
})
