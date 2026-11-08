// Local browser smoke: fake Auth/API environment overrides, no Supabase traffic.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
async function freePort() { const listener=net.createServer(); await new Promise((resolve,reject)=>listener.once('error',reject).listen(0,'127.0.0.1',resolve)); const port=listener.address().port; await new Promise(resolve=>listener.close(resolve)); return port; }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vettrack-clinical-ui-'));
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
  diagnose=async()=>({state:await evaluate('({body:document.body.innerText,requests:window.__clinicalSmoke?.requests})'),exceptions});
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: String.raw`(() => {
    const nativeFetch=window.fetch.bind(window),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const state=window.__clinicalSmoke={role:'medico',requests:[],downloads:0,unknown:[],started:false,stock:10};
    const clinical=['medicamentos.ver','inventario.uso_clinico','consultas.ver','consultas.crear','consultas.editar','consultas.finalizar','diagnosticos.ver','diagnosticos.crear','diagnosticos.editar','tratamientos.ver','tratamientos.crear','tratamientos.editar','recetas.ver','recetas.crear','recetas.editar','vacunas.ver','vacunas.crear','vacunas.editar','desparasitacion.ver','desparasitacion.crear','desparasitacion.editar','estudios.ver','estudios.crear','estudios.editar','expediente.ver'];
    const appointment={id_cita:id(60),id_mascota:id(50),id_dueno:id(40),id_medico:id(21),fecha_inicio:'2030-01-07T17:00:00Z',fecha_fin:'2030-01-07T17:30:00Z',estado:'programada',paciente:'Tornado',propietario:'Lupe',medico:'MVZ Prueba',motivo:'Revisión',servicios:[],subtotal:450};
    const catalog=[{id_servicio:id(30),nombre:'Consulta',costo:450,duracion_minutos:30,activo:true,especialidades:[]},{id_servicio:id(31),nombre:'Radiografía',costo:650,duracion_minutos:45,activo:true,especialidades:[]}];
    const bundle={consulta:{id_consulta:id(70),id_cita:id(60),id_mascota:id(50),id_dueno:id(40),id_medico:id(21),estado:'en_curso',revision:1,fecha_inicio:'2030-01-07T17:00:00Z',motivo_consulta:'Revisión',peso:12.5},contexto:{clinica:{nombre:'Clínica Prueba',direccion:'Domicilio profesional',telefono:'6641234567'},paciente:{nombre:'Tornado',especie:'Perro',raza:'Mestizo',peso:12.5},propietario:{nombre:'Lupe'},medico:{id:id(21),nombre:'MVZ Prueba',cedula_profesional:'12345678'}},diagnosticos:[],tratamientos:[],vacunas:[],desparasitaciones:[],estudios:[],receta:null,servicios:[{id_servicio:id(30),nombre:'Consulta',precio_aplicado:450,duracion_aplicada:30}],documentos:[]};
    let order=null,current=null;
    const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    const session=user=>{const b=v=>btoa(JSON.stringify(v)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');return{user,access_token:b({alg:'HS256',typ:'JWT'})+'.'+b({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})+'.fake',refresh_token:'fake-refresh',expires_in:3600,token_type:'bearer'}};
    window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href),method=(init.method||input.method||'GET').toUpperCase(),body=init.body?JSON.parse(init.body):{};
      if(url.hostname!=='vettrack-smoke.invalid'&&!url.pathname.startsWith('/api/')){if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('External request blocked');return nativeFetch(input,init)}
      state.requests.push({path:url.pathname,method,body});
      if(url.pathname==='/auth/v1/token'){current={id:id(21),email:'medico@example.test',app_metadata:{},user_metadata:{},aud:'authenticated',role:'authenticated',created_at:new Date().toISOString()};return json(session(current))}
      if(url.pathname==='/auth/v1/user')return json(current);
      if(url.pathname==='/api/sesion')return json({id:id(21),id_veterinaria:id(2),nombre:'MVZ Prueba',telefono:null,rol:state.role,activo:true,nombre_veterinaria:'Clínica Prueba',permisos:['citas.ver','pacientes.ver','servicios.ver','orden_recepcion.ver',...(state.role==='medico'?clinical:['orden_recepcion.procesar','inventario.entregar'])]});
      if(url.pathname==='/api/inventario/medicamentos')return json([{id_producto:id(200),nombre:'Medicina inventario',tipo_producto:'medicamento',unidad:'unidad',stock_actual:state.stock,activo:true,grupo_prescripcion:'II'}]);
      if(url.pathname==='/api/inventario/uso_clinico'){state.stock-=body.cantidad;return json({})}
      if(url.pathname==='/api/inventario/entregas_receta')return json([{id_detalle:id(201),nombre:'Medicina inventario',id_producto:id(200),cantidad:1,stock_actual:state.stock,entregada:!!state.delivered,grupo_prescripcion:'II'}]);
      if(url.pathname==='/api/inventario/receta_entregar'){if(!state.delivered)state.stock--;state.delivered=true;return json({})}
      if(url.pathname==='/api/citas')return json([appointment]);
      if(url.pathname==='/api/servicios')return json(catalog);
      if(url.pathname==='/api/pacientes')return json([{id_mascota:id(50),nombre:'Tornado'}]);
      if(url.pathname==='/api/clinica/consultas')return json(state.started?[{...bundle.consulta,paciente:'Tornado',propietario:'Lupe',medico:'MVZ Prueba'}]:[]);
      if(url.pathname.endsWith('/iniciar')){state.started=true;appointment.estado='en_consulta';return json(bundle)}
      if(url.pathname==='/api/clinica/consultas/'+id(70)&&method==='GET')return json(bundle);
      if(url.pathname==='/api/clinica/consultas/'+id(70)&&method==='PUT'){Object.assign(bundle.consulta,body);return json(bundle)}
      if(url.pathname.includes('/registros/')){const kind=url.pathname.split('/').at(-1);if(kind==='receta')bundle.receta={...body,id_receta:id(80)};else{const key={diagnostico:'diagnosticos',tratamiento:'tratamientos',vacuna:'vacunas',desparasitacion:'desparasitaciones',estudio:'estudios'}[kind];const pk={diagnostico:'id_diagnostico',tratamiento:'id_tratamiento',vacuna:'id_vacuna',desparasitacion:'id_desparasitacion',estudio:'id_estudio'}[kind];bundle[key].push({...body,[pk]:id(81+bundle[key].length)})}return json(bundle)}
      if(url.pathname.endsWith('/servicios')){const service=catalog.find(s=>s.id_servicio===body.id_servicio);bundle.servicios.push({id_servicio:service.id_servicio,nombre:service.nombre,precio_aplicado:service.costo,duracion_aplicada:service.duracion_minutos});return json(bundle)}
      if(url.pathname.endsWith('/finalizar')){bundle.consulta.estado='finalizada';appointment.estado='completada';bundle.documentos=['nota_consulta','plan_tratamiento','orden_recepcion','receta_simple'].map((tipo,i)=>({id_documento:id(100+i),id_consulta:id(70),revision:1,tipo,creado_en:'2030-01-07T18:00:00Z'}));order={id_orden:id(90),id_consulta:id(70),id_documento:id(102),revision:1,estado:'pendiente',creado_en:'2030-01-07T18:00:00Z',contenido:{paciente:{nombre:'Tornado'},propietario:{nombre:'Lupe'},medico:{nombre:'MVZ Prueba'},servicios:bundle.servicios,productos:[],observaciones_administrativas:'Entregar orden',proxima_cita:'2030-01-14'}};return json(bundle)}
      if(url.pathname.includes('/documentos/')){state.downloads++;return new Response('%PDF-1.4\nMock browser download\n%%EOF',{headers:{'Content-Type':'application/pdf'}})}
      if(url.pathname.endsWith('/expediente'))return json({paciente:bundle.contexto.paciente,entradas:[{id:id(70),tipo:'consulta',fecha:'2030-01-07T17:00:00Z',id_consulta:id(70),descripcion:bundle.consulta.motivo_consulta,datos:bundle.consulta},{id:id(81),tipo:'diagnostico',fecha:'2030-01-07T17:00:00Z',id_consulta:id(70),descripcion:'Diagnóstico de prueba',datos:{tipo:'definitivo',descripcion:'Diagnóstico de prueba'}}],hay_mas:false});
      if(url.pathname==='/api/clinica/ordenes')return json(order?[order]:[]);
      if(url.pathname.endsWith('/procesar')){order.estado='procesada';return json(order)}
      state.unknown.push(method+' '+url.pathname);throw Error('Missing clinical mock');
    };
  })();` });
  const text=value=>evaluate('document.body.innerText.includes('+JSON.stringify(value)+')');
  let click = value=>evaluate(`(()=>{const scope=document.querySelector('dialog[open]')||document;const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(value)})&&!b.disabled);if(!b)throw Error('Missing button '+${JSON.stringify(value)});b.click()})()`);
  const clickOriginal = click; const acceptSummary = async () => { await wait(70); await evaluate("(()=>{const ds=[...document.querySelectorAll('dialog[open]')];const d=ds.at(-1);if(d?.innerText.includes('Revisa el resumen antes de continuar.'))d.querySelector('.primary-button').click()})()"); };
  click = async value => { await clickOriginal(value); await acceptSummary() };
  const fill=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const select = (selector,value) => evaluate(`(async()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing selector');if(el.getAttribute('role')==='combobox'){for(let i=0;i<30&&el.matches(':disabled');i++)await new Promise(r=>setTimeout(r,50));el.focus();el.click();await new Promise(r=>setTimeout(r,80));const option=[...el.closest('.searchable-select').querySelectorAll('[role=option]')].find(o=>o.getAttribute('data-option-value')===${JSON.stringify(value)});if(!option)throw Error('Missing option '+${JSON.stringify(value)});option.click()}else{el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))}})()`);
  const section=label=>evaluate(`(()=>{const h=[...document.querySelectorAll('.clinical-card h4')].find(e=>e.textContent===${JSON.stringify(label)});h.closest('section').querySelector('button').click()})()`);
  await cdp('Page.navigate',{url:base+'/#/clinica'});
  await until(()=>text('Iniciar sesión'),'login');await fill('input[type=email]','medico@example.test');await fill('input[type=password]','Ficticia123!');await click('Iniciar sesión');
  await until(()=>text('Iniciar consulta'),'assigned appointments');await click('Iniciar consulta');await until(()=>text('Consulta · Tornado'),'consultation open');
  await fill('#clinical-motivo_consulta','Dolor de pata');await fill('#clinical-anamnesis','Información clínica privada');
  await section('Diagnósticos');await until(()=>evaluate('document.querySelector("#clinical-diagnostico textarea")!==null'),'diagnosis editor');await fill('#clinical-diagnostico textarea','Diagnóstico de prueba');await select('#clinical-diagnostico select','definitivo');await click('Guardar cambios');await until(()=>text('Diagnóstico de prueba'),'diagnosis saved');
  assert.equal(await evaluate('document.querySelector("#clinical-anamnesis").value'),'Información clínica privada');
  await section('Tratamientos');await until(()=>evaluate('document.querySelector("#clinical-tratamiento textarea")!==null'),'treatment editor');await fill('#clinical-tratamiento textarea','Tratamiento de prueba');await click('Guardar cambios');await until(()=>text('Tratamiento de prueba'),'treatment saved');
  await click('Registrar aplicación');await until(()=>evaluate('document.querySelector("#stock-product")?.getAttribute("role")==="combobox"'),'clinical inventory catalog');await select('#stock-product','00000000-0000-4000-8000-000000000200');await fill('#stock-reason','Producto aplicado físicamente');await click('Confirmar movimiento');await until(()=>evaluate('!document.querySelector("dialog[open]")'),'clinical usage saved');assert.equal(await evaluate('window.__clinicalSmoke.stock'),9);
  await click('Registrar receta');await until(()=>evaluate('document.querySelector("#rx-0-nombre_medicamento")!==null'),'prescription editor');
  const medication=async n=>{for(const [field,value] of Object.entries({nombre_medicamento:'Medicamento '+n,dosis:'Dosis del MVZ',frecuencia:'Frecuencia del MVZ',duracion:'Duración del MVZ',via_administracion:'Vía del MVZ'}))await fill('#rx-'+n+'-'+field,value)};
  await until(()=>evaluate('document.querySelector("#rx-product-0")?.getAttribute("role")==="combobox"'),'optional inventory link');await select('#rx-product-0','00000000-0000-4000-8000-000000000200');await evaluate('document.querySelector("#clinical-receta input[type=checkbox]").click()');await medication(0);await select('#rx-0-grupo_prescripcion','I');assert.equal(await text('Este medicamento requiere receta médica cuantificada autorizada.'),true);await select('#rx-0-grupo_prescripcion','II');await click('Agregar medicamento');await medication(1);await select('#rx-1-grupo_prescripcion','III');await click('Guardar receta');await until(()=>text('Medicamento 1'),'prescription saved');assert.equal(await evaluate('window.__clinicalSmoke.stock'),9);assert.equal(await evaluate('window.__clinicalSmoke.requests.find(r=>r.path.endsWith("/registros/receta")).body.detalles[0].id_producto'),'00000000-0000-4000-8000-000000000200');
  await select('#clinical-service','00000000-0000-4000-8000-000000000031');await click('Agregar servicio');await until(()=>text('Radiografía'),'additional service');
  await click('Finalizar consulta');await until(()=>text('Confirmar finalización'),'finish confirmation');await click('Confirmar finalización');await until(()=>text('Finalizada'),'consultation completed');
  assert.equal(await evaluate('document.querySelector("#clinical-anamnesis").matches(":disabled")'),true);
  assert.equal(await evaluate('[...document.querySelectorAll("button")].filter(b=>b.textContent.includes("Descargar PDF")).length'),4);
  await click('Nota de Consulta Veterinaria');await until(()=>evaluate('window.__clinicalSmoke.downloads===1'),'automatic document download');
  await evaluate('location.hash="/expediente?paciente=00000000-0000-4000-8000-000000000050"');await until(()=>text('Historial longitudinal'),'history page');await until(()=>text('Diagnóstico de prueba'),'chronological record');
  await evaluate('window.__clinicalSmoke.role="recepcionista";window.dispatchEvent(new Event("vettrack:access-changed"));location.hash="/ordenes-recepcion"');await until(()=>text('Marcar procesada'),'administrative closure');
  assert.equal(await text('Información clínica privada'),false);assert.equal(await text('Diagnóstico de prueba'),false);
  await click('Revisar entregas');await until(()=>text('Confirmar entrega física'),'prescription delivery dialog');await evaluate('window.confirm=()=>true');await click('Confirmar entrega física');await until(()=>text('Entregada'),'prescription delivered');assert.equal(await evaluate('window.__clinicalSmoke.stock'),8);await evaluate('document.querySelector("dialog .users-close").click()');
  await click('Descargar orden PDF');await until(()=>evaluate('window.__clinicalSmoke.downloads===2'),'administrative PDF download');await click('Marcar procesada');await until(()=>text('Procesada'),'order processed');
  const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(temp,'clinical-reception.png'),Buffer.from(screenshot.data,'base64'));
  await evaluate('location.hash="/clinica"');await until(()=>text('403'),'reception route guard');
  assert.deepEqual(await evaluate('window.__clinicalSmoke.unknown'),[]);assert.deepEqual(exceptions,[]);
  console.log('PASS clinical browser: assigned consultation, preserved unsaved core notes, diagnoses/treatments, multi-medication Group I warning, additional service, finish, four PDFs, longitudinal record, reception privacy/order/PDF and route guard.');
  console.log('Screenshot: '+path.join(temp,'clinical-reception.png'));
})().catch(async error=>{if(diagnose)console.error(JSON.stringify(await diagnose()));console.error(error.stack||error);process.exitCode=1;}).finally(()=>{clearTimeout(deadline);ws?.close();for(const child of children)child.kill();});
