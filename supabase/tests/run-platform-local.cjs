// Disposable PostgreSQL 17 only: no .env, Docker, Auth API or remote project.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const executable = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vettrack-platform-'));
const data = path.join(temporary, 'data');
const phase2 = path.join(root, 'supabase/migrations/20261107005545_users_roles_permissions.sql');
const phase4 = path.join(root, 'supabase/migrations/20261107044154_clinical_consultations_records.sql');
const phase3 = path.join(root, 'supabase/migrations/20261107025139_clinic_operations_appointments.sql');
let server;
let port;
let log;

function command(name, args, expectedFailure = false) {
  const result = spawnSync(executable(name), args, { encoding: 'utf8', windowsHide: true });
  if (result.error || (expectedFailure ? result.status === 0 : result.status !== 0)) {
    throw new Error(`${name} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result;
}
function sql(database, args, expectedFailure = false) {
  return command('psql', ['-X', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
    '-d', database, '-v', 'ON_ERROR_STOP=1', ...args], expectedFailure);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const selected = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return selected;
}
async function waitForDatabase() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = spawnSync(executable('pg_isready'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres'], { windowsHide: true });
    if (result.status === 0) return;
    if (server.exitCode !== null) throw new Error(fs.readFileSync(path.join(temporary, 'postgres.log'), 'utf8'));
    await delay(100);
  }
  throw new Error('Temporary PostgreSQL did not become ready');
}

async function main() {
 try {
  port=await freePort();
  command('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8']);
  log=fs.openSync(path.join(temporary,'postgres.log'),'a');
  server=spawn(executable('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','max_connections=12','-c','shared_buffers=16MB'],{windowsHide:true,stdio:['ignore',log,log]});
  await waitForDatabase();
  const database='vettrack_phase2_clinic_phase4';
  sql('postgres',['-c','CREATE DATABASE '+database]);
  for(const file of ['fixtures/users_roles_base.sql',phase2,'fixtures/clinic_operations_base.sql',phase3,
   path.join(root,'supabase/migrations/20261107043338_appointment_flow_corrections.sql'),'fixtures/clinical_base.sql',phase4,'fixtures/inventory_legacy.sql',path.join(root,'supabase/migrations/20261107052705_inventory_suppliers_purchases.sql'),path.join(root,'supabase/migrations/20261107061648_inventory_lots_expiry_receipts.sql'),'fixtures/final_operations_base.sql',path.join(root,'supabase/migrations/20261107182416_final_operations_payments_reports.sql'),'fixtures/platform_storage_base.sql',path.join(root,'supabase/migrations/20261108191709_platform_support_branding_files.sql'),path.join(root,'supabase/migrations/20261108203459_platform_audit_policy_initplan.sql'),path.join(root,'supabase/migrations/20261108203854_platform_audit_auth_uid_initplan.sql')]) {
   const target=path.isAbsolute(file)?file:path.join(__dirname,file);
   sql(database,['-f',target]);
  }
  for(let pass=1;pass<=2;pass++){
   const r=sql(database,['-f',path.join(__dirname,'clinical.sql')]);
   if(!r.stdout.includes('ROLLBACK'))throw Error('Clinical tests must roll back');
   console.log(r.stderr.trim());console.log('PASS clinical suite '+pass);
  }
  for(const suite of ['platform_support_branding.sql','final_operations.sql','inventory_lots.sql','inventory.sql','users_roles_permissions.sql','tenant_isolation.sql','clinic_operations_remote.sql']) {
   const result=sql(database,['-f',path.join(__dirname,suite)]);
   if(!result.stdout.includes('ROLLBACK'))throw Error('Regression suite did not roll back');
   console.log('PASS regression '+suite);
  }
  sql(database,['-c',"DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.consulta) OR (SELECT count(*) FROM public.receta)<>1 OR (SELECT count(*) FROM public.perfilusuario)<>9 THEN RAISE EXCEPTION 'Clinical suite left fixtures'; END IF; IF NOT EXISTS(SELECT 1 FROM public.diagnostico WHERE descripcion='Legacy diagnosis preserved') OR NOT EXISTS(SELECT 1 FROM public.receta WHERE indicaciones='Legacy prescription preserved' AND id_consulta IS NULL) THEN RAISE EXCEPTION 'Migration lost legacy clinical history'; END IF; END $$;"]);
  console.log('PASS preserved legacy and no residual fixtures');
  sql(database,['-c',`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.producto WHERE id_producto='73000000-0000-4000-8000-000000000001' AND nombre='Legacy product preserved' AND descripcion='Original description' AND precio=123.45 AND precio_venta=123.45 AND stock_actual=0) THEN RAISE EXCEPTION 'Lost legacy product';END IF;END $$;`]);
  console.log('PASS legacy product and original price preserved');
  // Committed data exists only in this disposable database. Two connections
  // race for one product: no lost update, overselling or duplicated retry.
  sql(database,['-c',`INSERT INTO public.veterinaria(id_veterinaria,nombre) VALUES('99999999-0000-4000-8000-000000000001','Concurrency fixture');
   INSERT INTO auth.users(id,aud,role,email) VALUES('99999999-0000-4000-8000-000000000002','authenticated','authenticated','concurrency@example.invalid');
   INSERT INTO public.perfilusuario(id,nombre,rol,activo,id_veterinaria) VALUES('99999999-0000-4000-8000-000000000002','Concurrency','admin',true,'99999999-0000-4000-8000-000000000001');
   INSERT INTO public.producto(id_producto,nombre,id_veterinaria,stock_actual) VALUES('99999999-0000-4000-8000-000000000003','Concurrency stock','99999999-0000-4000-8000-000000000001',10);`]);
  sql(database,['-c',`INSERT INTO public.lote_inventario(id_veterinaria,id_producto,numero_lote,fecha_caducidad,cantidad_inicial,cantidad_actual,origen) VALUES('99999999-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000003','Concurrent lot',current_date+30,10,10,'entrada');`]);
  const concurrent = (key, quantity) => new Promise((resolve,reject) => {
   const query=`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"99999999-0000-4000-8000-000000000002","role":"authenticated"}',true);
    SELECT public.vettrack_inventario('mover','{"id_producto":"99999999-0000-4000-8000-000000000003","tipo":"salida","cantidad":${quantity},"idempotencia":"${key}","motivo":"Concurrency"}'); SELECT pg_sleep(0.2); COMMIT;`;
   const child=spawn(executable('psql'),['-X','--no-password','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-c',query],{windowsHide:true,stdio:['ignore','pipe','pipe']});
   let err='';child.stderr.on('data',chunk=>{err+=chunk});child.once('error',reject);child.once('close',code=>resolve({code,err}));
  });
  const racing=await Promise.all([concurrent('99999999-0000-4000-8000-000000000010',7),concurrent('99999999-0000-4000-8000-000000000011',7)]);
  if(racing.filter(r=>r.code===0).length!==1||!racing.some(r=>r.err.includes('Existencias insuficientes')))throw Error('Concurrent stock race failed '+JSON.stringify(racing));
  const repeated=await Promise.all([concurrent('99999999-0000-4000-8000-000000000012',2),concurrent('99999999-0000-4000-8000-000000000012',2)]);
  if(repeated.some(r=>r.code!==0))throw Error('Concurrent retries failed');
  sql(database,['-c',`DO $$ BEGIN IF (SELECT stock_actual FROM public.producto WHERE id_producto='99999999-0000-4000-8000-000000000003')<>1 OR (SELECT count(*) FROM public.movimiento_inventario WHERE id_producto='99999999-0000-4000-8000-000000000003')<>2 THEN RAISE EXCEPTION 'Concurrent ledger failed';END IF;END $$;`]);
  sql(database,['-c',`DO $$ BEGIN IF (SELECT sum(cantidad_actual) FROM public.lote_inventario WHERE id_producto='99999999-0000-4000-8000-000000000003')<>1 OR (SELECT sum(cantidad) FROM public.movimiento_lote WHERE id_producto='99999999-0000-4000-8000-000000000003')<>-9 THEN RAISE EXCEPTION 'Concurrent lot allocation failed';END IF;END $$;`]);
  console.log('PASS concurrent FEFO stock races, identical retries and lot balances');
  // A file can be attached or marked for deletion, never both concurrently.
  const fileId='99999999-0000-4000-8000-000000000020';
  sql(database,['-c',`INSERT INTO public.archivo_clinica(id_archivo,id_veterinaria,categoria,contexto_id,bucket,ruta,nombre,mime,tamano,estado,creado_por) VALUES('${fileId}','99999999-0000-4000-8000-000000000001','logo','99999999-0000-4000-8000-000000000001','clinic-assets','99999999-0000-4000-8000-000000000001/logo/${fileId}.png','race.png','image/png',200,'listo','99999999-0000-4000-8000-000000000002');`]);
  const fileRace=op=>new Promise((resolve,reject)=>{
   const query=`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims','{"sub":"99999999-0000-4000-8000-000000000002","role":"authenticated"}',true);SELECT public.vettrack_plataforma('${op}','{"${op==='logo_guardar'?'id_archivo':'id'}":"${fileId}"}');SELECT pg_sleep(0.2);COMMIT;`;
   const child=spawn(executable('psql'),['-X','--no-password','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-c',query],{windowsHide:true,stdio:['ignore','pipe','pipe']});
   let err='';child.stderr.on('data',c=>{err+=c});child.once('error',reject);child.once('close',code=>resolve({code,err}));
  });
  const fileResults=await Promise.all([fileRace('logo_guardar'),fileRace('archivo_borrar')]);
  if(fileResults.filter(r=>r.code===0).length!==1||!fileResults.some(r=>/referencias hist|Archivo no v/.test(r.err)))throw Error('Concurrent file binding/deletion failed '+JSON.stringify(fileResults));
  sql(database,['-c',`DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.veterinaria v JOIN public.archivo_clinica f ON f.id_archivo=v.logo_archivo WHERE f.id_archivo='${fileId}' AND f.estado<>'listo') THEN RAISE EXCEPTION 'Deleted file remained attached';END IF;END $$;`]);
  console.log('PASS concurrent attachment/deletion: exactly one succeeds, no dangling reference');
  // Reuse rollback-only business fixtures ONLY in this disposable local DB.
  // Stop before registration; then two separate JWT sessions register one order.
  const paymentSetup=fs.readFileSync(path.join(__dirname,'final_operations.sql'),'utf8').replaceAll('\r\n','\n').split("SELECT pg_temp.jwt('rec');SET LOCAL ROLE authenticated;\nDO $$ DECLARE first jsonb")[0];
  if(paymentSetup.includes('DECLARE first jsonb'))throw Error('Payment fixture boundary not found');
  const paymentFile=path.join(temporary,'concurrent-payment.sql');
  fs.writeFileSync(paymentFile,paymentSetup+"RESET ROLE;SELECT 'PAY_FIXTURE:'||json_build_object('rec',pg_temp.id('rec'),'order',pg_temp.id('payment_order'),'method',pg_temp.id('payment_method'))::text;COMMIT;");
  const seeded=sql(database,['-f',paymentFile]);
  const fixture=JSON.parse(seeded.stdout.match(/PAY_FIXTURE:(\{[^\r\n]+\})/)[1]);
  const register=()=>new Promise((resolve,reject)=>{
   const query=`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims','{"sub":"${fixture.rec}","role":"authenticated"}',true);SELECT public.vettrack_operacion_final('pago_registrar','{"id_orden":"${fixture.order}","id_metodopago":"${fixture.method}"}');SELECT pg_sleep(0.2);COMMIT;`;
   const child=spawn(executable('psql'),['-X','--no-password','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-c',query],{windowsHide:true,stdio:['ignore','pipe','pipe']});
   let out='',err='';child.stdout.on('data',c=>{out+=c});child.stderr.on('data',c=>{err+=c});child.once('error',reject);child.once('close',code=>resolve({code,out,err}));
  });
  const payments=await Promise.all([register(),register()]);
  if(payments.some(p=>p.code!==0)||payments.filter(p=>p.out.includes('"ya_registrado": true')).length!==1)throw Error('Concurrent payment failed '+JSON.stringify(payments));
  sql(database,['-c',`DO $$ BEGIN IF (SELECT count(*) FROM public.pago WHERE id_orden='${fixture.order}')<>1 OR (SELECT monto FROM public.pago WHERE id_orden='${fixture.order}')<>530 THEN RAISE EXCEPTION 'Duplicated concurrent payment';END IF;END $$;`]);
  console.log('PASS concurrent payment registration: one immutable payment, one retry');
 } finally {
  if(server&&server.exitCode===null)command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  if(log!==undefined)fs.closeSync(log);
  const resolved=fs.realpathSync(temporary), base=fs.realpathSync(os.tmpdir())+path.sep;
  if(!resolved.startsWith(base)||!path.basename(resolved).startsWith('vettrack-platform-'))throw Error('Unexpected temporary directory');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
