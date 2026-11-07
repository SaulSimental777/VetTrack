// Local browser smoke: fake Auth/API environment overrides, no Supabase traffic.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
async function freePort() { const listener=net.createServer(); await new Promise((resolve,reject)=>listener.once('error',reject).listen(0,'127.0.0.1',resolve)); const port=listener.address().port; await new Promise(resolve=>listener.close(resolve)); return port; }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vettrack-clinic-ui-'));
const children = [];
let ws; let diagnose;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(task, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { const result = await task(); if (result) return result; } catch {} await wait(60); }
  if(diagnose) console.error(JSON.stringify(await diagnose()));
  throw new Error('Timeout: ' + label);
}
const deadline = setTimeout(() => { console.error('Smoke deadline exceeded'); for (const child of children) child.kill(); process.exit(1); }, 180000);
deadline.unref();
(async () => {
  const frontend = path.resolve(__dirname, '..');
  const vitePort=await freePort(), chromePort=await freePort();
  const base='http://127.0.0.1:'+vitePort, debug='http://127.0.0.1:'+chromePort;
  const vite = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: frontend, windowsHide: true, env: { ...process.env, VITE_SUPABASE_URL: 'https://vettrack-smoke.invalid', VITE_SUPABASE_ANON_KEY: 'fake-anon-key', VITE_API_URL: base }, stdio: 'ignore' });
  children.push(vite);
  await until(async () => (await fetch(base, { signal: AbortSignal.timeout(1500) })).ok, 'Vite');
  const chrome = spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--in-process-gpu', '--no-sandbox', '--disable-gpu-sandbox', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync', '--metrics-recording-only', '--remote-debugging-port='+chromePort, '--user-data-dir=' + path.join(temp, 'chrome'), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  children.push(chrome);
  await until(async () => (await fetch(debug+'/json/version', { signal: AbortSignal.timeout(1500) })).ok, 'Chrome');
  const target = await (await fetch(debug+'/json/new?about:blank', { method: 'PUT', signal: AbortSignal.timeout(3000) })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('WS timeout')), 5000); ws.onopen = () => { clearTimeout(timer); resolve(); }; ws.onerror = reject; });
  let nextId = 0;
  const requests = new Map();
  const exceptions = [];
  ws.onmessage = event => { const item = JSON.parse(event.data); if (item.id) { const request = requests.get(item.id); requests.delete(item.id); item.error ? request.reject(new Error(item.error.message)) : request.resolve(item.result); } else if (item.method === 'Runtime.exceptionThrown') exceptions.push(item.params.exceptionDetails.exception?.description || item.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => reject(new Error('CDP timeout ' + method)), 15000); requests.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  diagnose=async()=>({state:await evaluate('({body:document.body.innerText,requests:window.__clinicSmoke?.requests})'),exceptions});
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: String.raw`(() => {
    const nativeFetch = window.fetch.bind(window);
    const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
    const specialties = [{ id_especialidad: id(10), nombre: 'Equinos', descripcion: null }, { id_especialidad: id(11), nombre: 'Cirugía', descripcion: null }];
    const doctors = [{ id: id(20), nombre: 'Dra. Equinos', activo: true, especialidades: specialties, horario_hoy: [], proxima_cita: null }, { id: id(21), nombre: 'Dr. General', activo: true, especialidades: [], horario_hoy: [], proxima_cita: null }];
    const services = [{ id_servicio: id(30), nombre: 'Radiografía', descripcion: 'Imagen', costo: 650, duracion_minutos: 30, activo: true, especialidades: [specialties[0]] }, { id_servicio: id(31), nombre: 'Curación', descripcion: null, costo: 150, duracion_minutos: 15, activo: true, especialidades: [] }];
    const selectors = { propietarios: [{ id_dueno: id(40), nombre: 'Lupe Martínez' }], pacientes: [{ id_mascota: id(50), nombre: 'Tornado', id_dueno: id(40) }] };
    let appointments = [];
    let schedules = [{ dia_semana: 1, hora_inicio: '09:00:00', hora_fin: '13:00:00', activo: true }];
    let blocks = [];
    let current = null;
    const admin = ['dashboard.ver','medicos.ver','medicos.administrar','horarios.ver','horarios.administrar','servicios.ver','servicios.crear','servicios.editar','servicios.eliminar','servicios.editar_precio','citas.ver','citas.crear','citas.editar','citas.cancelar','citas.asignar_medico','citas.forzar_horario'];
    const reception = ['dashboard.ver','medicos.ver','horarios.ver','servicios.ver','citas.ver','citas.crear','citas.editar','citas.cancelar','citas.asignar_medico'];
    const doctor = ['dashboard.ver','medicos.ver','horarios.ver','servicios.ver','citas.ver'];
    const state = window.__clinicSmoke = { role: 'admin', priceDelegated: false, requests: [], writes: [], failures: [] };
    const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const makeSession = user => { const b64 = value => btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); return { user, access_token: b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})+'.fake', refresh_token:'fake-refresh', expires_in:3600, token_type:'bearer' }; };
    window.fetch = async (input, init={}) => {
      const url = new URL(typeof input==='string'?input:input.url,location.href);
      const method = (init.method||input.method||'GET').toUpperCase();
      if(url.hostname!=='vettrack-smoke.invalid'&&!url.pathname.startsWith('/api/')) {
        if(!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Unexpected external request');
        return nativeFetch(input,init);
      }
      const body = init.body?JSON.parse(init.body):{};
      state.requests.push({path:url.pathname,method,query:url.search,body});
      if(url.pathname==='/auth/v1/token') { current={id:id(1),email:'admin@example.test',app_metadata:{},user_metadata:{},aud:'authenticated',role:'authenticated',created_at:new Date().toISOString()}; return json(makeSession(current)); }
      if(url.pathname==='/auth/v1/user') return json(current);
      if(url.pathname==='/auth/v1/logout') {current=null;return json({});}
      if(url.pathname==='/api/sesion') return json({id:id(1),id_veterinaria:id(2),nombre:'Usuario de prueba',telefono:null,rol:state.role,activo:true,nombre_veterinaria:'Clínica Demo',permisos:[...(state.role==='admin'?admin:state.role==='medico'?doctor:reception),...(state.priceDelegated?['servicios.editar_precio']:[])]});
      if(url.pathname.startsWith('/rest/v1/')&&method==='HEAD') return new Response(null,{status:200,headers:{'content-range':'0-0/1'}});
      if(url.pathname==='/api/especialidades'&&method==='GET') return json(specialties);
      if(url.pathname==='/api/medicos') return json(doctors.filter(d=>(!url.searchParams.get('especialidad')||d.especialidades.some(e=>e.id_especialidad===url.searchParams.get('especialidad')))&&(!url.searchParams.get('q')||d.nombre.toLowerCase().includes(url.searchParams.get('q').toLowerCase()))));
      if(url.pathname.endsWith('/horarios')) {if(method==='GET')return json(schedules);schedules=body.bloques;state.writes.push({kind:'schedule',body});return json({message:'Horario guardado',horarios:schedules});}
      if(url.pathname.endsWith('/bloqueos')) {if(method==='GET')return json(blocks);const block={id_bloqueo:id(70),...body};blocks.push(block);state.writes.push({kind:'block',body});return json({message:'Bloqueo creado',bloqueo:block},201);}
      if(url.pathname.includes('/bloqueos/')&&method==='DELETE') {blocks=[];return json({message:'Eliminado'});}
      if(url.pathname.endsWith('/disponibilidad')) {const minutes=Number(url.searchParams.get('duracion_minutos')||45);const date=url.searchParams.get('fecha');const starts=[date+'T09:00:00-08:00',date+'T10:00:00-08:00',date+'T15:00:00-08:00'];return json({fecha:date,duracion_minutos:minutes,zona_horaria:'America/Tijuana',slots:starts.map(start=>({fecha_inicio:start,fecha_fin:new Date(Date.parse(start)+minutes*60000).toISOString()}))});}
      if(url.pathname==='/api/servicios'&&method==='GET')return json(services);
      if(url.pathname==='/api/servicios'&&method==='POST'){const service={id_servicio:id(32),...body,especialidades:specialties.filter(s=>body.especialidades.includes(s.id_especialidad))};services.push(service);state.writes.push({kind:'service',body});return json({message:'Creado',servicio:service},201);}
      if(url.pathname.startsWith('/api/servicios/')&&method==='PUT'){const service=services.find(s=>s.id_servicio===url.pathname.split('/')[3]);Object.assign(service,body);state.writes.push({kind:'price',body});return json({message:'Actualizado',servicio:service});}
      if(url.pathname==='/api/citas/selectores')return json(selectors);
      if(url.pathname==='/api/citas'&&method==='GET')return json(appointments.filter(c=>(!url.searchParams.get('inicio')||Date.parse(c.fecha_fin)>Date.parse(url.searchParams.get('inicio')))&&(!url.searchParams.get('fin')||Date.parse(c.fecha_inicio)<Date.parse(url.searchParams.get('fin')))));
      if(url.pathname==='/api/citas'&&method==='POST'){
        const selected=services.filter(s=>body.servicios.includes(s.id_servicio)).map(s=>({id_servicio:s.id_servicio,nombre:s.nombre,precio_aplicado:s.costo,duracion_aplicada:s.duracion_minutos,estado:'pendiente'}));
        const appointment={id_cita:id(60),...body,fecha_fin:new Date(Date.parse(body.fecha_inicio)+selected.reduce((sum,s)=>sum+s.duracion_aplicada,0)*60000).toISOString(),paciente:'Tornado',propietario:'Lupe Martínez',medico:doctors.find(d=>d.id===body.id_medico).nombre,servicios:selected,subtotal:selected.reduce((sum,s)=>sum+s.precio_aplicado,0)};
        appointments.push(appointment);state.writes.push({kind:'appointment',body});return json({message:'Creada',cita:appointment},201);
      }
      if(url.pathname.endsWith('/cancelar')) {appointments[0].estado='cancelada';state.writes.push({kind:'cancel',body});return json({message:'Cancelada',cita:appointments[0]});}
      state.failures.push(method+' '+url.pathname);throw new Error('Missing mock '+method+' '+url.pathname);
    };
  })();` });
  const text = value => evaluate('document.body.innerText.includes('+JSON.stringify(value)+')');
  let click = value => evaluate(`(() => { const scope=document.querySelector('dialog[open]')||document; const button=[...scope.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(value)})&&!b.disabled);if(!button)throw new Error('Missing enabled button '+${JSON.stringify(value)});button.click();})()`);
  const clickOriginal = click; const acceptSummary = async () => { await wait(70); await evaluate("(()=>{const ds=[...document.querySelectorAll('dialog[open]')];const d=ds.at(-1);if(d?.innerText.includes('Revisa el resumen antes de continuar.'))d.querySelector('.primary-button').click()})()"); };
  click = async value => { await clickOriginal(value); await acceptSummary() };
  const fill = (selector,value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing field '+${JSON.stringify(selector)});const type=el instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const select = (selector,value) => evaluate(`(async()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing selector');if(el.getAttribute('role')==='combobox'){for(let i=0;i<30&&el.matches(':disabled');i++)await new Promise(r=>setTimeout(r,50));el.focus();el.click();await new Promise(r=>setTimeout(r,80));const option=[...el.closest('.searchable-select').querySelectorAll('[role=option]')].find(o=>o.getAttribute('data-option-value')===${JSON.stringify(value)});if(!option)throw Error('Missing option '+${JSON.stringify(value)}+' active='+document.activeElement.id+' html='+el.closest('.searchable-select').outerHTML);option.click()}else{el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))}})()`);
  const rowAction = (name,action) => evaluate(`(() => {const row=[...document.querySelectorAll('.users-table tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(name)}));const button=[...row.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(action)})&&!b.disabled);if(!button)throw new Error('Missing row action');button.click();})()`);
  const checkLabel = label => evaluate(`(() => {const el=[...document.querySelectorAll('dialog label')].find(e=>e.textContent.includes(${JSON.stringify(label)}));if(!el)throw new Error('Missing checkbox');el.querySelector('input[type=checkbox]').click();})()`);
  const route = async path => {const title={'/medicos':'Médicos','/servicios':'Servicios','/citas':'Citas'}[path];await evaluate('location.hash='+JSON.stringify(path));await until(()=>evaluate(`document.querySelector('.users-page-header h3')?.textContent===${JSON.stringify(title)}&&!document.querySelector('.users-loading')`),'route data');};
  const role = async (value,price=false) => {await evaluate(`window.__clinicSmoke.role=${JSON.stringify(value)};window.__clinicSmoke.priceDelegated=${price};window.dispatchEvent(new Event('vettrack:access-changed'));`);await until(()=>evaluate(`document.querySelector('.user-info span')?.textContent?.includes(${JSON.stringify(value==='medico'?'Médico':value==='admin'?'Administrador':'Recepcionista')})`),'role refresh');};
  await cdp('Page.navigate',{url:base+'/#/citas'});
  await until(()=>text('Iniciar sesión'),'login');
  await fill('input[type=email]','admin@example.test');await fill('input[type=password]','Ficticia12345!');await click('Iniciar sesión');
  await until(()=>text('+ Nueva cita'),'appointments page');
  await role('recepcionista');
  await click('Nueva cita');await until(()=>evaluate('document.querySelector("#appointment-owner")?.getAttribute("role")==="combobox"'),'appointment selectors');
  assert.equal(await evaluate('document.querySelector("#appointment-state")===null'),true);
  await select('#appointment-owner','00000000-0000-4000-8000-000000000040');
  await select('#appointment-patient','00000000-0000-4000-8000-000000000050');
  await fill('#appointment-reason','Se lastimó una pata.');
  await click('Siguiente');await select('#appointment-service','00000000-0000-4000-8000-000000000030');await select('#appointment-service','00000000-0000-4000-8000-000000000031');
  assert.equal(await evaluate('document.querySelector(".operations-subtotal").innerText.includes("800.00")'),true);
  await click('Siguiente');
  await select('#appointment-specialty','00000000-0000-4000-8000-000000000010');
  await evaluate('document.querySelector("#appointment-doctor").click()');await wait(60);assert.equal(await evaluate('document.querySelector("#appointment-doctor-options").innerText.includes("General")'),false);
  await click('Ver todos los médicos');
  assert.equal(await evaluate('document.querySelector("#appointment-doctor-options").innerText.includes("General")'),true);
  await select('#appointment-doctor','00000000-0000-4000-8000-000000000021');
  await fill('#appointment-date','2030-01-07');
  await until(()=>evaluate('document.querySelectorAll(".operations-slot").length===3'),'availability');
  assert.equal(await text('Usar una hora fuera del horario semanal'),false);
  await evaluate('document.querySelector(".operations-slot").click()');await click('Revisar cita');await click('Guardar cita');
  await until(()=>text('Cita creada.'),'appointment saved');
  await until(()=>text('Tornado'),'appointment reload');
  assert.equal(await evaluate('document.querySelector("#appointments-date").value'),'2030-01-07');
  assert.equal(await text('Tornado'),true);assert.equal(await text('Lupe Martínez'),true);assert.equal(await text('Dr. General'),true);
  assert.deepEqual(await evaluate('window.__clinicSmoke.writes.find(w=>w.kind==="appointment").body.servicios'),['00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000031']);
  assert.equal(await evaluate('Object.hasOwn(window.__clinicSmoke.writes.find(w=>w.kind==="appointment").body,"id_veterinaria")'),false);
  await route('/servicios');await until(()=>text('Radiografía'),'services list');
  assert.equal(await text('+ Nuevo servicio'),false);assert.equal(await evaluate('[...document.querySelectorAll(".users-table button")].some(b=>/Editar|precio|Desactivar/.test(b.textContent))'),false);
  await role('recepcionista',true);await until(()=>text('Cambiar precio'),'delegated price');await rowAction('Radiografía','Cambiar precio');
  assert.equal(await evaluate('document.querySelector("#service-name")===null'),true);
  await fill('#service-price','700');await click('Guardar cambios');await until(()=>text('Servicio actualizado.'),'price saved');
  assert.deepEqual(await evaluate('window.__clinicSmoke.writes.find(w=>w.kind==="price").body'),{costo:700});
  await route('/citas');await fill('#appointments-date','2030-01-07');await until(()=>text('Radiografía'),'historic appointment');
  assert.equal(await evaluate('document.querySelector(".users-table tbody").innerText.includes("650.00")'),true);
  await role('medico');assert.equal(await text('+ Nueva cita'),false);assert.equal(await evaluate('document.querySelectorAll(".operations-table-actions button").length'),0);
  await route('/medicos');await until(()=>text('Dr. General'),'doctor list');assert.equal(await text('Editar horario'),false);assert.equal(await text('Sin especialidades'),true);
  await role('admin');await until(()=>text('Editar horario'),'admin schedule action');await rowAction('Dr. General','Editar horario');
  await until(()=>evaluate('document.querySelectorAll("dialog input[type=time]").length===2'),'weekly schedule');
  await evaluate('[...document.querySelectorAll(".operations-day button")].find(button=>button.textContent.includes("Agregar")).click()');
  await click('Guardar cambios');assert.equal(await text('no pueden solaparse'),true);
  await fill('input[aria-label="Inicio Lunes bloque 2"]','15:00');await fill('input[aria-label="Fin Lunes bloque 2"]','18:00');
  await click('Guardar cambios');await until(()=>text('Horario guardado.'),'weekly schedule saved');
  assert.equal(await evaluate('window.__clinicSmoke.writes.find(w=>w.kind==="schedule").body.bloques.length'),2);
  await rowAction('Dr. General','Bloqueos');await until(()=>text('Nuevo bloqueo'),'blocks dialog');
  await fill('#block-start','2030-01-07T11:00');await fill('#block-end','2030-01-07T12:00');await select('#block-type','comida');await fill('#block-reason','Comida');
  await click('Agregar bloqueo');await until(()=>text('Bloqueo creado.'),'block saved');assert.equal(await evaluate('window.__clinicSmoke.writes.find(w=>w.kind==="block").body.fecha_inicio'),'2030-01-07T19:00:00.000Z');
  await click('Cerrar');await route('/servicios');await until(()=>text('+ Nuevo servicio'),'admin services');await click('Nuevo servicio');
  await fill('#service-name','Consulta general');await fill('#service-price','450');await fill('#service-duration','30');await checkLabel('Equinos');await checkLabel('Cirugía');
  await click('Crear servicio');await until(()=>text('Servicio creado.'),'service created');
  assert.equal(await evaluate('window.__clinicSmoke.writes.find(w=>w.kind==="service").body.especialidades.length'),2);
  const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(temp,'servicios.png'),Buffer.from(screenshot.data,'base64'));
  await role('medico');await evaluate('window.__clinicSmoke.role="medico";location.hash="/configuracion/usuarios"');await until(()=>text('403'),'unauthorized route');
  assert.deepEqual(await evaluate('window.__clinicSmoke.failures'),[]);assert.deepEqual(exceptions,[]);
  console.log('PASS browser: reception books multiple services with unmatched specialty; filters/all, prices, role controls, weekly overlaps, blocks/timezone, admin service creation and route guard.');
  console.log('Screenshot: '+path.join(temp,'servicios.png'));
})().catch(async error=>{if(diagnose)console.error(JSON.stringify(await diagnose()));console.error(error.stack||error);process.exitCode=1;}).finally(()=>{clearTimeout(deadline);ws?.close();for(const child of children)child.kill();});
