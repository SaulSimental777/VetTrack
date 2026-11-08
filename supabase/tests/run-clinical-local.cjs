// Disposable PostgreSQL 17 only: no .env, Docker, Auth API or remote project.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const executable = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vettrack-phase4-'));
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
   path.join(root,'supabase/migrations/20261107043338_appointment_flow_corrections.sql'),'fixtures/clinical_base.sql',phase4]) {
   const target=path.isAbsolute(file)?file:path.join(__dirname,file);
   sql(database,['-f',target]);
  }
  for(let pass=1;pass<=2;pass++){
   const r=sql(database,['-f',path.join(__dirname,'clinical.sql')]);
   if(!r.stdout.includes('ROLLBACK'))throw Error('Clinical tests must roll back');
   console.log(r.stderr.trim());console.log('PASS clinical suite '+pass);
  }
  for(const suite of ['users_roles_permissions.sql','tenant_isolation.sql','clinic_operations_remote.sql']) {
   const result=sql(database,['-f',path.join(__dirname,suite)]);
   if(!result.stdout.includes('ROLLBACK'))throw Error('Regression suite did not roll back');
   console.log('PASS regression '+suite);
  }
  sql(database,['-c',"DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.consulta) OR (SELECT count(*) FROM public.receta)<>1 OR (SELECT count(*) FROM public.perfilusuario)<>9 THEN RAISE EXCEPTION 'Clinical suite left fixtures'; END IF; IF NOT EXISTS(SELECT 1 FROM public.diagnostico WHERE descripcion='Legacy diagnosis preserved') OR NOT EXISTS(SELECT 1 FROM public.receta WHERE indicaciones='Legacy prescription preserved' AND id_consulta IS NULL) THEN RAISE EXCEPTION 'Migration lost legacy clinical history'; END IF; END $$;"]);
  console.log('PASS preserved legacy and no residual fixtures');
 } finally {
  if(server&&server.exitCode===null)command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  if(log!==undefined)fs.closeSync(log);
  const resolved=fs.realpathSync(temporary), base=fs.realpathSync(os.tmpdir())+path.sep;
  if(!resolved.startsWith(base)||!path.basename(resolved).startsWith('vettrack-phase4-'))throw Error('Unexpected temporary directory');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
