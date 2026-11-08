const assert=require('node:assert/strict')
const {test,before,after,beforeEach}=require('node:test')
const Module=require('node:module'),express=require('express')
const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const state={}
const query=(table)=>{
 const call={table,filters:[]};state.db.push(call)
 const q={then(resolve,reject){return Promise.resolve(state.dbResults.shift()||{data:null,error:null}).then(resolve,reject)}}
 for(const method of ['select','update','upsert','delete','eq','single'])q[method]=(...args)=>{if(method==='eq')call.filters.push(args);else if(['update','upsert','delete'].includes(method)){call.method=method;call.data=args[0]}return q}
 return q
}
const storage=scope=>({from:bucket=>({
 async upload(path,bytes,options){state.storage.push({scope,op:'upload',bucket,path,bytes,options});return {error:state.uploadError||null}},
 async download(path){state.storage.push({scope,op:'download',bucket,path});return {data:state.download?new Blob([state.download]):null,error:state.download?null:{message:'missing'}}},
 async remove(paths){state.storage.push({scope,op:'remove',bucket,paths});return {error:state.removeError||null}},
})})
const client={
 from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:state.profile,error:null})}},
 async rpc(name,args){if(name==='get_my_permissions')return {data:state.permissions,error:null};state.rpc.push({name,args});const next=state.plans.shift();assert.ok(next,'Unexpected RPC '+name);assert.equal(name,next.name||'vettrack_plataforma');next.check?.(args);return {data:next.data,error:next.error||null}},
 storage:storage('jwt'),
}
const admin={from:query,storage:storage('admin'),auth:{getUser:async token=>token==='valid'?{data:{user:{id:id(1),email:'account@example.com',app_metadata:state.metadata,user_metadata:{super_admin:true},sensitive:'not returned'}},error:null}:{data:{user:null},error:{}},admin:{
 async createUser(input){state.auth.push({op:'create',input});if(state.createThrow)throw Error('interrupted');return {data:{user:{id:input.id}},error:state.createError||null}},
 async deleteUser(target){state.auth.push({op:'delete',id:target});return {error:state.cleanupError||null}},
 async getUserById(target){state.auth.push({op:'get',id:target});return {data:{user:{id:target,app_metadata:state.targetMetadata||{}}},error:null}},
 async updateUserById(target,input){state.auth.push({op:'update',id:target,input});return {error:state.authErrors.shift()||null}},
}}}
const configPath=require.resolve('../config/supabase'),fake=new Module(configPath);fake.loaded=true;fake.exports={supabaseAdmin:admin,createUserClient:token=>{assert.equal(token,'valid');return client}};require.cache[configPath]=fake
const app=express();app.use(express.json({limit:'512kb'}));app.use('/api/plataforma',require('../routes/platform.routes'));app.use('/api/archivos',require('../routes/files.routes'));app.use('/api/inventario',require('../routes/inventory.routes'));app.use('/api/clinica',require('../routes/clinical.routes'))
app.use((e,req,res,next)=>{if(e.type==='entity.too.large')return res.status(413).json({error:'Archivo demasiado grande'});next(e)})
let server,base
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`})
after(async()=>new Promise(r=>server.close(r)))
beforeEach(()=>Object.assign(state,{metadata:{},permissions:['compras.administrar','compras.recibir','compras.ver','consultas.ver','consultas.editar','estudios.crear','estudios.ver','propietarios.ver','citas.ver','configuracion.editar'],profile:{id:id(1),id_veterinaria:id(2),rol:'admin',activo:true},plans:[],rpc:[],auth:[],db:[],dbResults:[],storage:[],authErrors:[],uploadError:null,download:null,removeError:null,createError:null,createThrow:false,cleanupError:null,targetMetadata:{}}))
const plan=(data,check,error,name)=>state.plans.push({data,check,error,name})
const request=async(path,method='GET',body,token='valid',mime)=>{
 const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':mime||'application/json'}:{})},...(body!==undefined?{body:mime?body:JSON.stringify(body)}:{})})
 return {status:r.status,body:r.status===204?null:r.headers.get('Content-Type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer()),headers:r.headers}
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=','base64')
const file=changes=>({id_archivo:id(3),id_veterinaria:id(2),creado_por:id(1),nombre:'logo.png',categoria:'logo',contexto_id:id(2),bucket:'clinic-assets',ruta:id(2)+'/logo/'+id(3)+'.png',mime:'image/png',tamano:png.length,estado:'pendiente',...changes})
test('every platform/file endpoint requires verified bearer Auth',async()=>{
 for(const path of ['/api/plataforma/global_dashboard','/api/plataforma/tickets','/api/archivos/'+id(3)])assert.equal((await request(path,'GET',undefined,null)).status,401)
 assert.deepEqual(state.rpc,[]);assert.deepEqual(state.storage,[])
})
test('user_metadata or clinic admin role never authorizes global operations',async()=>{
 for(const op of ['global_dashboard','tenants','tenant'])assert.equal((await request('/api/plataforma/'+op)).status,403)
 assert.equal((await request('/api/plataforma/tenant_estado','POST',{id:id(2),estado:'suspendido',motivo:'Prueba'})).status,403)
 assert.deepEqual(state.rpc,[]);assert.deepEqual(state.auth,[])
})
test('global dashboard and tenant detail use only guarded JWT RPC projections',async()=>{
 state.metadata={super_admin:true};plan({activos:4},args=>assert.equal(args.p_operacion,'global_dashboard'));assert.equal((await request('/api/plataforma/global_dashboard')).body.activos,4)
 plan({usuarios:8,pacientes:4},args=>assert.deepEqual(args.p_datos,{id:id(2)}));assert.equal((await request('/api/plataforma/tenant?id='+id(2))).status,200);assert.deepEqual(state.auth,[])
})
test('tenant suspension requires a reason and cannot mutate over GET',async()=>{
 state.metadata={super_admin:true};assert.equal((await request('/api/plataforma/tenant_estado','POST',{id:id(2),estado:'suspendido'})).status,400);assert.equal((await request('/api/plataforma/tenant_estado?id='+id(2))).status,405)
 plan({estado:'suspendido'},args=>assert.deepEqual(args.p_datos,{id:id(2),estado:'suspendido',motivo:'Incidencia administrativa'}));assert.equal((await request('/api/plataforma/tenant_estado','POST',{id:id(2),estado:'suspendido',motivo:'Incidencia administrativa'})).status,200)
})
test('support derives identity in SQL and rejects forged tenant role and state fields',async()=>{
 const body={asunto:'Ayuda',categoria:'operacion',descripcion:'Descripción'}
 for(const extra of [{id_usuario:id(9)},{id_veterinaria:id(9)},{rol:'admin'},{estado:'cerrado'},{es_superadmin:true}])assert.equal((await request('/api/plataforma/ticket_crear','POST',{...body,...extra})).status,400)
 plan({id_ticket:id(8)},args=>assert.deepEqual(args.p_datos,body));assert.equal((await request('/api/plataforma/ticket_crear','POST',body)).status,200)
})
test('ticket replies and global state changes retain controlled closed and foreign errors',async()=>{
 plan(null,null,{code:'P0002',message:'sensitive foreign row'});const foreign=await request('/api/plataforma/ticket?id='+id(8));assert.equal(foreign.status,404);assert.doesNotMatch(JSON.stringify(foreign.body),/sensitive/)
 assert.equal((await request('/api/plataforma/ticket_estado','POST',{id:id(8),estado:'cerrado'})).status,403)
 plan(null,null,{code:'23514',message:'El ticket está cerrado'});assert.match((await request('/api/plataforma/ticket_responder','POST',{id:id(8),mensaje:'Texto'})).body.error,/cerrado/)
})
test('clinic data endpoints independently enforce effective permissions',async()=>{
 state.permissions=[];for(const [op,data] of [['propietarios_resumen',{}],['propietario',{id:id(5)}],['citas_explorar',{vista:'todas'}],['logo_guardar',{id_archivo:null}]])assert.equal((await request('/api/plataforma/'+op,'POST',data)).status,403)
 assert.deepEqual(state.rpc,[])
})
test('owner summary and appointment pagination bound dates ids and offsets',async()=>{
 for(const url of ['/api/plataforma/propietario?id=bad','/api/plataforma/citas_explorar?vista=todas&offset=-1','/api/plataforma/citas_explorar?vista=todas&fecha=2026-02-30'])assert.equal((await request(url)).status,400)
 plan({filas:[],hay_mas:false},args=>assert.deepEqual(args.p_datos,{vista:'pendientes',offset:50}));assert.equal((await request('/api/plataforma/citas_explorar?vista=pendientes&offset=50')).status,200)
})
test('my account allowlists Auth fields and changes only the verified global account password',async()=>{
 const own=await request('/api/plataforma/mi-cuenta');assert.deepEqual(own.body,{id:id(1),correo:'account@example.com',superadmin:false})
 assert.equal((await request('/api/plataforma/mi-cuenta/password','POST',{password:'Vettrack123'})).status,403)
 state.metadata={super_admin:true};assert.equal((await request('/api/plataforma/mi-cuenta/password','POST',{password:'Vettrack123',id:id(9)})).status,400)
 assert.equal((await request('/api/plataforma/mi-cuenta/password','POST',{password:' Vettrack123 '})).status,200);assert.deepEqual(state.auth[0],{op:'update',id:id(1),input:{password:' Vettrack123 '}})
})
test('global admin creation validates tenant before creating a server-id Auth account',async()=>{
 state.metadata={super_admin:true};plan({veterinaria:{id_veterinaria:id(2)}},args=>assert.equal(args.p_operacion,'tenant'));state.dbResults.push({error:null})
 const r=await request('/api/plataforma/tenants/'+id(2)+'/administradores/crear','POST',{nombre:'MVZ Administrador',correo:'admin@example.com',password:'Vettrack123',telefono:'6641234567'})
 assert.equal(r.status,201);const created=state.auth[0].input;assert.match(created.id,/^[0-9a-f-]{36}$/);assert.equal(state.db[0].data.rol,'admin');assert.equal(state.db[0].data.id_veterinaria,id(2));assert.equal(state.db[0].data.nombre,'MVZ Administrador');assert.doesNotMatch(JSON.stringify(r.body),/password|app_metadata/)
})
test('admin creation never edits an existing account and interrupted creation cleans only its random ID',async()=>{
 state.metadata={super_admin:true};plan({});state.createThrow=true;const r=await request('/api/plataforma/tenants/'+id(2)+'/administradores/crear','POST',{nombre:'Admin',correo:'new@example.com',password:'Vettrack123'})
 assert.equal(r.status,500);assert.equal(state.auth[1].op,'delete');assert.equal(state.auth[1].id,state.auth[0].input.id);assert.deepEqual(state.db,[])
})
test('foreign or non-admin target rejection happens before privileged Auth lookup',async()=>{
 state.metadata={super_admin:true};plan(null,null,{code:'P0002',message:'foreign'});assert.equal((await request('/api/plataforma/tenants/'+id(2)+'/administradores/password','POST',{id:id(9),password:'Vettrack123'})).status,404);assert.deepEqual(state.auth,[])
})
test('live target Superadmin metadata prevents a global admin password reset',async()=>{
 state.metadata={super_admin:true};state.targetMetadata={super_admin:true};plan({id:id(9),activo:true});assert.equal((await request('/api/plataforma/tenants/'+id(2)+'/administradores/password','POST',{id:id(9),password:'Vettrack123'})).status,403);assert.equal(state.auth.length,1)
})
test('deactivation uses SQL protections before Auth ban and leaves an inactive profile on Auth error',async()=>{
 state.metadata={super_admin:true};plan({id:id(9),activo:true});plan({id:id(9),activo:false},args=>assert.equal(args.p_operacion,'admin_estado'));state.authErrors.push({message:'ban failed'})
 const r=await request('/api/plataforma/tenants/'+id(2)+'/administradores/estado','POST',{id:id(9),activo:false});assert.equal(r.status,502);assert.equal(r.body.syncPending,true);assert.deepEqual(state.auth.at(-1).input,{ban_duration:'876000h'})
})
test('last administrator and self protections are not bypassed by global Auth operations',async()=>{
 state.metadata={super_admin:true};plan({id:id(9),activo:true});plan(null,null,{code:'23514',message:'Debe conservarse un administrador activo'})
 const r=await request('/api/plataforma/tenants/'+id(2)+'/administradores/estado','POST',{id:id(9),activo:false});assert.equal(r.status,409);assert.match(r.body.error,/otro administrador/);assert.equal(state.auth.filter(a=>a.op==='update').length,0)
})
test('failed administrator reactivation restores Auth ban when SQL cannot activate',async()=>{
 state.metadata={super_admin:true};plan({id:id(9),activo:false});plan(null,null,{code:'42501',message:'denied'})
 assert.equal((await request('/api/plataforma/tenants/'+id(2)+'/administradores/estado','POST',{id:id(9),activo:true})).status,403);assert.deepEqual(state.auth.filter(a=>a.op==='update').map(a=>a.input),[{ban_duration:'none'},{ban_duration:'876000h'}])
})
test('file reservations validate declared size and types before calling the guarded RPC',async()=>{
 for(const b of [{categoria:'logo',nombre:'x.pdf',mime:'application/pdf',tamano:1},{categoria:'compras',nombre:'x.pdf',mime:'application/pdf',tamano:10485761},{categoria:'logo',nombre:'x.png',mime:'image/png',tamano:5242881},{categoria:'estudios',nombre:'x.exe',mime:'application/x-msdownload',tamano:20}])assert.equal((await request('/api/archivos','POST',b)).status,400)
 assert.deepEqual(state.rpc,[])
})
test('upload reserves no client-supplied path tenant or creator and returns no technical URL',async()=>{
 const body={categoria:'logo',nombre:'logo.png',mime:'image/png',tamano:png.length};assert.equal((await request('/api/archivos','POST',{...body,ruta:'foreign'})).status,400)
 plan(file(),args=>assert.deepEqual(args.p_datos,body));const r=await request('/api/archivos','POST',body);assert.equal(r.status,201);assert.deepEqual(Object.keys(r.body).sort(),['estado','id_archivo','mime','nombre','tamano']);assert.doesNotMatch(JSON.stringify(r.body),/bucket|ruta|creado_por/)
})
test('real PNG bytes are verified then uploaded only from backend and marked ready',async()=>{
 plan(file());state.dbResults.push({data:{...file(),estado:'listo'},error:null});const r=await request('/api/archivos/'+id(3)+'/contenido','POST',png,'valid','image/png')
 assert.equal(r.status,200);assert.equal(state.storage[0].scope,'admin');assert.equal(state.storage[0].options.upsert,false);assert.equal(state.db[0].data.estado,'listo');assert.match(state.db[0].data.huella_sha256,/^[a-f0-9]{64}$/)
})
test('renaming executable content to png or lying about MIME cannot reach Storage',async()=>{
 plan(file({tamano:8}));assert.equal((await request('/api/archivos/'+id(3)+'/contenido','POST',Buffer.from('MZevil!!'),'valid','image/png')).status,400)
 plan(file({mime:'image/jpeg'}));assert.equal((await request('/api/archivos/'+id(3)+'/contenido','POST',png,'valid','image/jpeg')).status,400);assert.deepEqual(state.storage,[])
})
test('foreign file authorization fails before bytes reach privileged Storage',async()=>{
 plan(null,null,{code:'P0002',message:'foreign'});assert.equal((await request('/api/archivos/'+id(3)+'/contenido','POST',png,'valid','image/png')).status,404);assert.deepEqual(state.storage,[])
 plan(file({creado_por:id(9)}));assert.equal((await request('/api/archivos/'+id(3)+'/contenido','POST',png,'valid','image/png')).status,403);assert.deepEqual(state.storage,[])
})
test('private downloads use the caller JWT and safe content headers',async()=>{
 plan(file({estado:'listo'}));state.download=png;const r=await request('/api/archivos/'+id(3));assert.equal(r.status,200);assert.deepEqual(r.body,png);assert.equal(state.storage[0].scope,'jwt');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff')
})
test('referenced historical files cannot be physically deleted',async()=>{
 plan(null,null,{code:'23514',message:'El archivo conserva referencias históricas'});const r=await request('/api/archivos/'+id(3),'DELETE');assert.equal(r.status,409);assert.deepEqual(state.storage,[])
})
test('unreferenced file removal authorizes first and deletes only the reserved object',async()=>{
 plan(file());state.dbResults.push({error:null});assert.equal((await request('/api/archivos/'+id(3),'DELETE')).status,204);assert.deepEqual(state.storage[0].paths,[file().ruta]);assert.equal(state.db[0].method,'delete')
})
test('purchase closing enforces compras.administrar and required reason without stock RPCs',async()=>{
 state.permissions=['compras.ver','compras.recibir'];assert.equal((await request('/api/inventario/compra_cerrar','POST',{id:id(4),estado:'cancelada',motivo:'Prueba'})).status,403)
 state.permissions.push('compras.administrar');assert.equal((await request('/api/inventario/compra_cerrar','POST',{id:id(4),estado:'cancelada',motivo:' '})).status,400)
 plan({estado:'cancelada'},args=>assert.deepEqual(args.p_datos,{id:id(4),estado:'cancelada',motivo:'Pedido cancelado'}),null,'vettrack_inventario');assert.equal((await request('/api/inventario/compra_cerrar','POST',{id:id(4),estado:'cancelada',motivo:'Pedido cancelado'})).status,200)
})
test('next appointment is compared to the canonical consultation date in Tijuana',async()=>{
 plan({consulta:{fecha_inicio:'2026-11-08T01:00:00Z'}},null,null,'vettrack_consulta');const r=await request('/api/clinica/consultas/'+id(5),'PUT',{proxima_cita:'2026-11-06'});assert.equal(r.status,400);assert.match(r.body.error,/anterior/);assert.equal(state.rpc.length,1)
 plan({consulta:{fecha_inicio:'2026-11-08T01:00:00Z'}},null,null,'vettrack_consulta');plan({consulta:{}},null,null,'vettrack_guardar_consulta');assert.equal((await request('/api/clinica/consultas/'+id(5),'PUT',{proxima_cita:'2026-11-07'})).status,200)
})
test('study attachment UUID coexists with legacy HTTPS without accepting another Tenant',async()=>{
 plan({estudios:[]},args=>assert.equal(args.p_datos.archivo_adjunto,id(3)),null,'vettrack_guardar_registro_clinico');assert.equal((await request('/api/clinica/consultas/'+id(5)+'/registros/estudio','POST',{tipo:'laboratorio',nombre:'Estudio',fecha:'2026-11-07',archivo_adjunto:id(3)})).status,200)
 assert.equal((await request('/api/clinica/consultas/'+id(5)+'/registros/estudio','POST',{tipo:'laboratorio',nombre:'Estudio',fecha:'2026-11-07',archivo_adjunto:'bad'})).status,400)
})
test('content validation recognizes PDF and JPEG signatures and limits dimensions',()=>{
 const {validateFile}=require('../services/file-content');const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');assert.equal(validateFile(pdf,{mime:'application/pdf',tamano:pdf.length,categoria:'compras'}).mime,'application/pdf')
 const jpeg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);assert.equal(validateFile(jpeg,{mime:'image/jpeg',tamano:jpeg.length,categoria:'estudios'}).mime,'image/jpeg')
 const large=Buffer.from(png);large.writeUInt32BE(100000,16);assert.throws(()=>validateFile(large,{mime:'image/png',tamano:large.length,categoria:'logo'}),/demasiado grande/)
 assert.throws(()=>validateFile(Buffer.alloc(10485761),{mime:'application/pdf',tamano:10485761,categoria:'soporte'}),/supera 10 MB/)
})
