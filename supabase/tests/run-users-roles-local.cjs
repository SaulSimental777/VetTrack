// Starts a disposable PostgreSQL 17 cluster. No .env, Docker or remote project.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const suffix = process.platform === 'win32' ? '.exe' : '';
const executable = (name) => path.join(bin, name + suffix);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vettrack-phase2-'));
const data = path.join(temporary, 'data');
const migration = path.join(root, 'supabase/migrations/20261107005545_users_roles_permissions.sql');
const fixture = path.join(__dirname, 'fixtures/users_roles_base.sql');
const test = path.join(__dirname, 'users_roles_permissions.sql');
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const selected = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
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
async function verifySerialization(database) {
  const lockFile = path.join(temporary, 'lock.sql');
  fs.writeFileSync(lockFile, `BEGIN;
SET LOCAL application_name = 'vettrack_phase2_lock_holder';
SET LOCAL request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT public.vettrack_autorizar_usuario('20000000-0000-4000-8000-000000000002','usuarios.editar');
SELECT pg_sleep(3);
ROLLBACK;
`);
  const child = spawn(executable('psql'), ['-X', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
    '-d', database, '-v', 'ON_ERROR_STOP=1', '-f', lockFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let childError = '';
  child.stderr.on('data', (chunk) => { childError += chunk; });
  const complete = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(childError)));
  });
  let locked = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const probe = sql(database, ['-Atc', "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='vettrack_phase2_lock_holder' AND query LIKE '%pg_sleep%')"]);
    if (probe.stdout.trim() === 't') { locked = true; break; }
    await delay(50);
  }
  if (!locked) { await complete; throw new Error('Lock holder did not acquire the clinic lock'); }
  const collision = sql(database, ['-c', `BEGIN;
SET LOCAL lock_timeout = '200ms';
SET LOCAL request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.vettrack_estado_usuario('20000000-0000-4000-8000-000000000001',false);
  EXCEPTION WHEN lock_not_available THEN RETURN;
  END;
  RAISE EXCEPTION 'Clinic membership operations did not serialize';
END; $$;
ROLLBACK;`]);
  await complete;
  if (!collision.stdout.includes('ROLLBACK')) throw new Error('Lock collision test did not roll back');
  console.log('PASS clinic-row lock serializes concurrent membership changes');
}

async function main() {
  try {
    port = await freePort();
    command('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8']);
    log = fs.openSync(path.join(temporary, 'postgres.log'), 'a');
    server = spawn(executable('postgres'), ['-D', data, '-h', '127.0.0.1', '-p', String(port),
      '-c', 'max_connections=12', '-c', 'shared_buffers=16MB'], { windowsHide: true, stdio: ['ignore', log, log] });
    await waitForDatabase();
    const database = 'vettrack_phase2_tests';
    sql('postgres', ['-c', `CREATE DATABASE ${database}`]);
    sql(database, ['-f', fixture]);
    for (let pass = 1; pass <= 2; pass += 1) {
      sql(database, ['-f', migration]);
      const suite = sql(database, ['-f', test]);
      if (!suite.stdout.includes('ROLLBACK')) throw new Error('Security suite did not roll back');
      const regression = sql(database, ['-f', path.join(__dirname, 'tenant_isolation.sql')]);
      if (!regression.stdout.includes('ROLLBACK')) throw new Error('Phase 1 regression did not roll back');
      console.log(`PASS migration and RLS/RPC suite (pass ${pass}, idempotent on pass 2)`);
    }
    sql(database, ['-c', `DO $$ BEGIN
      IF (SELECT count(*) FROM auth.users) <> 2 OR (SELECT count(*) FROM public.perfilusuario) <> 2 THEN
        RAISE EXCEPTION 'Transactional suite left user fixtures behind'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.perfilusuario WHERE id='20000000-0000-4000-8000-000000000001'
        AND nombre='Preserved administrator' AND telefono='5551234567' AND rol='admin' AND activo) THEN
        RAISE EXCEPTION 'Migration did not preserve the existing administrator'; END IF;
      IF (SELECT count(*) FROM public.permiso) <> 45 THEN RAISE EXCEPTION 'Unexpected permission catalog'; END IF;
    END; $$;`]);
    console.log('PASS preserved administrators, 45 permissions and complete fixture rollback');
    await verifySerialization(database);

    const legacy = 'vettrack_phase2_legacy';
    sql('postgres', ['-c', `CREATE DATABASE ${legacy}`]);
    sql(legacy, ['-f', fixture]);
    sql(legacy, ['-c', "UPDATE public.perfilusuario SET rol='user' WHERE id='20000000-0000-4000-8000-000000000001'"]);
    const failure = sql(legacy, ['-f', migration], true);
    if (!failure.stderr.includes('Legacy profiles must all be admin')) throw new Error('Unexpected fail-closed error');
    sql(legacy, ['-c', `DO $$ BEGIN
      IF to_regclass('public.permiso') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid='public.perfilusuario'::regclass AND attname='activo') THEN
        RAISE EXCEPTION 'Fail-closed migration left partial schema'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.perfilusuario WHERE rol='user') THEN
        RAISE EXCEPTION 'Fail-closed migration changed an incompatible user'; END IF;
    END; $$;`]);
    console.log('PASS incompatible legacy role fails closed without partial schema or lost users');
  } finally {
    if (server && server.exitCode === null) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    if (log !== undefined) fs.closeSync(log);
    const resolved = fs.realpathSync(temporary);
    const temporaryRoot = fs.realpathSync(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith('vettrack-phase2-')) {
      throw new Error('Refusing to remove an unexpected temporary directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
