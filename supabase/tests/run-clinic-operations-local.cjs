// Disposable PostgreSQL 17 only: no .env, Docker, Auth API or remote project.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const executable = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vettrack-phase3-'));
const data = path.join(temporary, 'data');
const phase2 = path.join(root, 'supabase/migrations/20261107005545_users_roles_permissions.sql');
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

async function verifyBookingSerialization(database) {
  const lockFile = path.join(temporary, 'booking-lock.sql');
  const booking = `SELECT public.vettrack_guardar_cita(NULL, '{"id_mascota":"50000000-0000-4000-8000-000000000001","id_dueno":"40000000-0000-4000-8000-000000000001","id_medico":"20000000-0000-4000-8000-000000000006","fecha_inicio":"2030-01-14T09:00:00-08:00","motivo":"Concurrent booking","servicios":["60000000-0000-4000-8000-000000000001"],"forzar_horario":true}'::jsonb);`;
  fs.writeFileSync(lockFile, `BEGIN;
SET LOCAL application_name = 'vettrack_phase3_booking_holder';
SET LOCAL request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
${booking}
SELECT pg_sleep(3);
COMMIT;
`);
  const child = spawn(executable('psql'), ['-X', '--no-password', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
    '-d', database, '-v', 'ON_ERROR_STOP=1', '-f', lockFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let childError = '';
  child.stderr.on('data', chunk => { childError += chunk; });
  const complete = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(childError)));
  });
  let locked = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const probe = sql(database, ['-Atc', "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='vettrack_phase3_booking_holder' AND query LIKE '%pg_sleep%')"]);
    if (probe.stdout.trim() === 't') { locked = true; break; }
    await delay(50);
  }
  if (!locked) { await complete; throw new Error('Concurrent booking holder did not reach its locked transaction'); }
  const collision = sql(database, ['-c', `BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    ${booking.replace(/^SELECT /, 'PERFORM ')}
  EXCEPTION WHEN check_violation OR exclusion_violation THEN
    RAISE NOTICE 'Overlapping concurrent booking correctly rejected after the first committed';
    RETURN;
  END;
  RAISE EXCEPTION 'Concurrent overlapping appointment was accepted after the first committed';
END; $$;
ROLLBACK;`]);
  await complete;
  if (!collision.stdout.includes('ROLLBACK')) throw new Error('Concurrent booking test did not roll back');
  if (!collision.stderr.includes('correctly rejected after the first committed')) throw new Error('Concurrent conflict rejection was not observed');
  // Only this disposable concurrency fixture commits, to prove visibility after
  // waiting for another transaction. Remove it before checking suite residue.
  sql(database, ['-c', `BEGIN;
DELETE FROM public.cita_servicio WHERE id_cita IN (SELECT id_cita FROM public.cita
 WHERE motivo='Concurrent booking' AND id_medico='20000000-0000-4000-8000-000000000006');
DELETE FROM public.cita WHERE motivo='Concurrent booking' AND id_medico='20000000-0000-4000-8000-000000000006';
COMMIT;`]);
  console.log('PASS concurrent double-booking: first commits, waiting second rejects overlap, disposable fixture cleaned');
}

function prepareClinicDatabase(database) {
  sql('postgres', ['-c', `CREATE DATABASE ${database}`]);
  sql(database, ['-f', path.join(__dirname, 'fixtures/users_roles_base.sql')]);
  sql(database, ['-f', phase2]);
  sql(database, ['-f', path.join(__dirname, 'fixtures/clinic_operations_base.sql')]);
}

function assertPhase3Absent(database) {
  sql(database, ['-c', `DO $$ BEGIN
    IF to_regclass('public.horario_medico') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute
      WHERE attrelid='public.servicio'::regclass AND attname='duracion_minutos')
      OR EXISTS(SELECT 1 FROM public.permiso WHERE clave='medicos.ver') THEN
      RAISE EXCEPTION 'Failed migration left partial schema or permissions'; END IF;
  END; $$;`]);
}

function verifyLegacyOwnerHistory(database) {
  prepareClinicDatabase(database);
  // Committed setup belongs only to this disposable pre-migration fixture.
  // The original appointment keeps Owner A; its patient moved to Other Owner A.
  sql(database, ['-c', `UPDATE public.mascota SET id_dueno='40000000-0000-4000-8000-000000000003'
    WHERE id_mascota='50000000-0000-4000-8000-000000000001'`]);
  sql(database, ['-f', phase3]);
  sql(database, ['-c', `BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.cita c JOIN public.cita_servicio cs USING(id_cita)
    WHERE c.id_cita='70000000-0000-4000-8000-000000000001'
      AND c.id_dueno='40000000-0000-4000-8000-000000000001'
      AND c.id_mascota='50000000-0000-4000-8000-000000000001'
      AND c.id_servicio='60000000-0000-4000-8000-000000000001'
      AND c.id_veterinaria='10000000-0000-4000-8000-000000000001'
      AND c.fecha='2025-01-06 10:00:00'::timestamp
      AND c.fecha_inicio='2025-01-06T10:00:00-08:00'::timestamptz
      AND c.fecha_fin-c.fecha_inicio=interval '30 minutes'
      AND c.id_medico IS NULL AND c.estado='confirmada' AND c.estado_legacy='Confirmada'
      AND cs.id_servicio='60000000-0000-4000-8000-000000000001'
      AND cs.precio_aplicado=450 AND cs.duracion_aplicada=30)
      OR NOT EXISTS(SELECT 1 FROM public.mascota WHERE id_mascota='50000000-0000-4000-8000-000000000001'
        AND id_dueno='40000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'Migration changed the historic owner, current owner, IDs, date, duration, price or unassigned doctor'; END IF;
END; $$;
SET LOCAL request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE historical jsonb; snapshot jsonb; affected integer; appointment jsonb; BEGIN
  SELECT to_jsonb(c) INTO historical FROM public.cita c WHERE id_cita='70000000-0000-4000-8000-000000000001';
  SELECT to_jsonb(cs) INTO snapshot FROM public.cita_servicio cs WHERE id_cita='70000000-0000-4000-8000-000000000001';
  SELECT item INTO appointment FROM jsonb_array_elements(public.vettrack_citas()) item
    WHERE item->>'id_cita'='70000000-0000-4000-8000-000000000001';
  IF appointment IS NULL OR appointment->>'propietario' IS DISTINCT FROM 'Owner A'
    OR appointment->>'paciente' IS DISTINCT FROM 'Tornado' THEN
    RAISE EXCEPTION 'Historical appointment no longer displays its recorded owner and patient'; END IF;
  UPDATE public.mascota SET id_dueno='40000000-0000-4000-8000-000000000001'
    WHERE id_mascota='50000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Same-clinic owner transfer did not update the patient'; END IF;
  UPDATE public.mascota SET id_dueno='40000000-0000-4000-8000-000000000003'
    WHERE id_mascota='50000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Historic appointment froze the current patient owner'; END IF;
  BEGIN
    UPDATE public.mascota SET id_dueno='40000000-0000-4000-8000-000000000002'
      WHERE id_mascota='50000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Cross-clinic owner transfer was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  appointment:='{"id_mascota":"50000000-0000-4000-8000-000000000001","id_dueno":"40000000-0000-4000-8000-000000000001","id_medico":"20000000-0000-4000-8000-000000000006","fecha_inicio":"2030-01-07T09:00:00-08:00","motivo":"New appointment must use current owner","servicios":["60000000-0000-4000-8000-000000000001"],"forzar_horario":true}'::jsonb;
  BEGIN
    PERFORM public.vettrack_guardar_cita(NULL,appointment);
    RAISE EXCEPTION 'New appointment accepted the historic owner instead of the current owner';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.vettrack_guardar_cita(NULL,appointment||'{"id_dueno":"40000000-0000-4000-8000-000000000003"}'::jsonb);
  IF historical IS DISTINCT FROM (SELECT to_jsonb(c) FROM public.cita c WHERE id_cita='70000000-0000-4000-8000-000000000001')
    OR snapshot IS DISTINCT FROM (SELECT to_jsonb(cs) FROM public.cita_servicio cs WHERE id_cita='70000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Patient owner transfer or new booking rewrote the historic appointment/service'; END IF;
END; $$;
RESET ROLE;
ROLLBACK;`]);
  sql(database, ['-c', `DO $$ BEGIN
    IF (SELECT count(*) FROM public.cita)<>1 OR (SELECT count(*) FROM public.cita_servicio)<>1 THEN
      RAISE EXCEPTION 'Owner-transfer regression left runtime appointment fixtures'; END IF;
  END; $$;`]);
  console.log('PASS legacy historical owner differs from current owner; migration preserves history, same-clinic transfers work, new RPC bookings require current owner');
}

function verifyForeignLegacyReferences(database) {
  prepareClinicDatabase(database);
  const baseline = `id_veterinaria='10000000-0000-4000-8000-000000000001',
    id_dueno='40000000-0000-4000-8000-000000000001',id_mascota='50000000-0000-4000-8000-000000000001',
    id_servicio='60000000-0000-4000-8000-000000000001',estado='Confirmada'`;
  const cases = [
    ['foreign historic owner', "id_dueno='40000000-0000-4000-8000-000000000002'"],
    ['foreign patient', "id_mascota='50000000-0000-4000-8000-000000000002'"],
    ['foreign service', "id_servicio='60000000-0000-4000-8000-000000000002'"],
    ['foreign patient with NULL historic owner', "id_dueno=NULL,id_mascota='50000000-0000-4000-8000-000000000002'"],
    ['NULL appointment tenant', 'id_veterinaria=NULL'],
  ];
  for (const [description, mutation] of cases) {
    sql(database, ['-c', `UPDATE public.cita SET ${baseline}; UPDATE public.cita SET ${mutation}`]);
    const before = sql(database, ['-Atc', 'SELECT to_jsonb(c)::text FROM public.cita c ORDER BY id_cita']).stdout;
    const failure = sql(database, ['-f', phase3], true);
    if (!failure.stderr.includes('Legacy appointment tenant/reference mismatch')) throw new Error(`Unexpected preflight error for ${description}`);
    assertPhase3Absent(database);
    const after = sql(database, ['-Atc', 'SELECT to_jsonb(c)::text FROM public.cita c ORDER BY id_cita']).stdout;
    if (before !== after) throw new Error(`Failed migration modified ${description} data`);
    console.log(`PASS legacy ${description} fails closed without partial schema or changed data`);
  }
  sql(database, ['-c', `UPDATE public.cita SET ${baseline}; UPDATE public.cita SET estado='Unknown historical status'`]);
  const unknownStatus = sql(database, ['-f', phase3], true);
  if (!unknownStatus.stderr.includes('Unknown legacy appointment status')) throw new Error('Unknown legacy status did not fail closed');
  assertPhase3Absent(database);
  sql(database, ['-c', `DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.cita WHERE estado='Unknown historical status') THEN
      RAISE EXCEPTION 'Failed migration lost historical status'; END IF;
  END; $$;`]);
  console.log('PASS unknown legacy status rolls back preceding DDL and preserves data');
}

async function main() {
  try {
    port = await freePort();
    command('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8']);
    log = fs.openSync(path.join(temporary, 'postgres.log'), 'a');
    server = spawn(executable('postgres'), ['-D', data, '-h', '127.0.0.1', '-p', String(port),
      '-c', 'max_connections=12', '-c', 'shared_buffers=16MB'], { windowsHide: true, stdio: ['ignore', log, log] });
    await waitForDatabase();
    const database = 'vettrack_phase2_clinic_tests';
    prepareClinicDatabase(database);
    sql(database, ['-f', phase3]);
    sql(database, ['-f', path.join(root, 'supabase/migrations/20261107043338_appointment_flow_corrections.sql')]);
    const flow = sql(database, ['-f', path.join(__dirname, 'appointment_flow.sql')]);
    if (!flow.stdout.includes('ROLLBACK')) throw new Error('Flow suite did not roll back');
    console.log(flow.stderr.trim());
    for (let pass = 1; pass <= 2; pass += 1) {
      const suite = sql(database, ['-f', path.join(__dirname, 'clinic_operations.sql')]);
      if (!suite.stdout.includes('ROLLBACK')) throw new Error('Clinic operation suite did not roll back');
      console.log(suite.stderr.trim());
      console.log(`PASS clinic RPC/RLS suite (pass ${pass}${pass === 2 ? ', fixtures fully rolled back after pass 1' : ''})`);
    }
    await verifyBookingSerialization(database);
    sql(database, ['-c', `DO $$ BEGIN
      IF (SELECT count(*) FROM public.cita) <> 1 OR (SELECT count(*) FROM public.servicio) <> 2
        OR (SELECT count(*) FROM auth.users) <> 9 THEN RAISE EXCEPTION 'Test fixtures did not roll back'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.cita_servicio WHERE id_cita='70000000-0000-4000-8000-000000000001'
        AND id_servicio='60000000-0000-4000-8000-000000000001' AND precio_aplicado=450) THEN
        RAISE EXCEPTION 'Historical service link/price not preserved'; END IF;
    END; $$;`]);
    console.log('PASS legacy appointment/service migration and complete test rollback');
    verifyLegacyOwnerHistory('vettrack_phase2_clinic_historic_owner');
    verifyForeignLegacyReferences('vettrack_phase2_clinic_legacy');
  } finally {
    if (server && server.exitCode === null) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    if (log !== undefined) fs.closeSync(log);
    const resolved = fs.realpathSync(temporary);
    const temporaryRoot = fs.realpathSync(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith('vettrack-phase3-')) {
      throw new Error('Refusing to remove an unexpected temporary directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
