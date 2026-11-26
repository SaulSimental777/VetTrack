// Local browser smoke: fake Auth/API environment overrides, no Supabase traffic.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
async function freePort() { const listener=net.createServer(); await new Promise((resolve,reject)=>listener.once('error',reject).listen(0,'127.0.0.1',resolve)); const port=listener.address().port; await new Promise(resolve=>listener.close(resolve)); return port; }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vettrack-ui-recovery-'));
const children = [];
let ws; let diagnose;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(task, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { const result = await task(); if (result) return result; } catch {} await wait(60); }
  if(diagnose) console.error(JSON.stringify(await diagnose()));
  throw new Error('Timeout: ' + label);
}
const deadline = setTimeout(() => { console.error('Smoke deadline exceeded'); for (const child of children) child.kill(); process.exit(1); }, 420000);
deadline.unref();
(async () => {
  const permissionFixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/permissions.json'),'utf8'));
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
  diagnose=async()=>({state:await evaluate('({body:document.body.innerText,unknown:window.__finalSmoke?.unknown,activeElement:document.activeElement.className})'),exceptions});
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const source='('+require('./fixtures/platform-browser.cjs').toString()+')('+JSON.stringify(permissionFixture)+');';
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source});
  // Presentation fixtures only: never contact production Auth/API/Storage.
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:'('+function(roles){
    const fetchBefore=window.fetch.bind(window),state=window.__finalSmoke,id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Tijuana',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    state.settings.nombre='TECVETE'
    state.flowCount=5
    const appointment=state.appointments.find(c=>c.fecha_inicio.startsWith(today))
    const cases=n=>Array.from({length:n},(_,i)=>({id_consulta:id(700+i),id_mascota:id(50),paciente:i%2?'Marvin':'Solovino',propietario:'Jaziel',medico:'MVZ Norte',estado:'en_curso',fecha_inicio:today+'T18:00:00Z'}))
    state.products.push({...state.products[0],id_producto:id(101),nombre:'Medicamento de prueba',tipo_producto:'medicamento',sku:'MED-001',grupo_prescripcion:'no_clasificado'})
    state.users=[{id:id(23),nombre:'Administrador TECVETE',correo:'administrador@tecvete.example',rol:'admin',activo:true,especialidades:[],creado_en:null,ultimo_acceso:null},{id:id(21),nombre:'María Fernanda López',correo:'maria.fernanda@tecvete.example',rol:'medico',activo:true,especialidades:[],creado_en:'2026-11-01',ultimo_acceso:null}]
    const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})
    window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href)
      const perms=roles[state.role]||[]
      if(url.pathname==='/api/operacion/dashboard')return json({fecha:today,citas:[],metricas:[
        ...(perms.includes('citas.ver')?[{titulo:'Citas del día',valor:state.flowCount,ruta:'/citas'},{titulo:'Citas pendientes',valor:state.flowCount,ruta:'/citas'}]:[]),
        ...(perms.includes('consultas.ver')&&['admin','medico'].includes(state.role)?[{titulo:'Consultas en curso',valor:state.flowCount,ruta:'/clinica'}]:[]),
        ...(perms.includes('pacientes.ver')?[{titulo:'Pacientes registrados',valor:state.patients.length,ruta:'/pacientes'}]:[]),
        ...(perms.includes('pagos.ver')?[{titulo:'Pagos pendientes',valor:state.flowCount,ruta:'/pagos'}]:[]),
        ...(perms.includes('inventario.ver')?[{titulo:'Stock bajo',valor:0,ruta:'/inventario'},{titulo:'Lotes próximos a caducar',valor:2,ruta:'/inventario'}]:[]),
        ...(perms.includes('orden_recepcion.ver')?[{titulo:'Órdenes pendientes',valor:1,ruta:'/ordenes-recepcion'}]:[]),
        ...(perms.includes('compras.ver')?[{titulo:'Recepciones de los últimos 7 días',valor:0,ruta:'/compras'}]:[])]})
      if(url.pathname==='/api/citas')return json(Array.from({length:state.flowCount},(_,i)=>({...appointment,id_cita:id(800+i),paciente:i%2?'Marvin':'Solovino'})))
      // Simulate a capped clinical list: its total must still come from the aggregate.
      if(url.pathname==='/api/clinica/consultas'&&(init.method||'GET')==='GET')return json(cases(Math.min(state.flowCount,5)))
      if(url.pathname==='/api/operacion/pagos')return json({pagos:[],pendientes:Array.from({length:state.flowCount},(_,i)=>({id_orden:id(900+i),fecha:today+'T18:00:00Z',paciente:{nombre:i%2?'Marvin':'Luna'},propietario:{nombre:'Jaziel'}}))})
      if(/\/api\/usuarios\/[^/]+\/permisos$/.test(url.pathname)){
        const catalogo=roles.admin.map(clave=>({clave,modulo:clave.split('.')[0],accion:clave.split('.')[1],descripcion:clave==='orden_recepcion.procesar'?'Procesar órdenes de recepción':clave==='orden_recepcion.ver'?'Ver órdenes administrativas':clave==='dashboard.ver'?'Ver Dashboard':clave.replaceAll('_',' ').replaceAll('.',' · ')}))
        const porRol=Object.fromEntries(catalogo.map(p=>[p.clave,roles.medico.includes(p.clave)]))
        return json({catalogo,porRol,overrides:{},efectivos:porRol})
      }
      return fetchBefore(input,init)
    }
  }.toString()+')('+JSON.stringify(permissionFixture)+');'});

  const text=s=>evaluate('document.body.innerText.includes('+JSON.stringify(s)+')');
  const click=s=>evaluate(`(()=>{const scope=document.querySelector('dialog[open]')||document;const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(s)})&&!b.disabled);if(!b)throw Error('Missing action '+${JSON.stringify(s)});b.click()})()`);
  const fill=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const route=async p=>{await evaluate('location.hash='+JSON.stringify(p));await wait(90);await until(()=>evaluate('!!document.querySelector(".content h3")&&!document.querySelector(".users-loading")&&!document.querySelector(".content").innerText.includes("Cargando módulo")'),'module '+p);};
  const shot=async name=>{await wait(240);const result=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(temp,name+'.png'),Buffer.from(result.data,'base64'));};
  const login=async role=>{await cdp('Page.navigate',{url:base+'/?as='+role+'#'+(role==='superadmin'?'/superadmin/dashboard':'/dashboard')});await until(()=>text('Iniciar sesión'),'login');await fill('input[type=email]',role+'@example.test');await fill('input[type=password]','MockOnly123!');await click('Iniciar sesión');await until(()=>evaluate('!!document.querySelector(".content h3")'),'workspace');await wait(180);};
  const sizes=[[1920,1080],[1536,864],[1366,768],[1280,720],[1024,768],[820,1180],[768,1024],[390,844]];
  const pages=[['/dashboard','dashboard.ver'],['/propietarios','propietarios.ver'],['/pacientes','pacientes.ver'],['/citas','citas.ver'],['/clinica','consultas.ver'],['/expediente','expediente.ver'],['/ordenes-recepcion','orden_recepcion.ver'],['/medicos','medicos.ver'],['/horarios','horarios.ver'],['/servicios','servicios.ver'],['/inventario','inventario.ver'],['/proveedores','proveedores.ver'],['/compras','compras.ver'],['/pagos','pagos.ver'],['/reportes','reportes.ver'],['/configuracion','configuracion.ver'],['/configuracion/usuarios','usuarios.ver'],['/soporte',null]];
  let checkpoints=0;
  const check=async label=>{
    const data=await evaluate(`(()=>{const s=document.querySelector('.sidebar'),m=document.querySelector('.main-content');return {width:innerWidth,scroll:document.documentElement.scrollWidth,topbar:!!document.querySelector('.topbar'),sidebarWidth:s.getBoundingClientRect().width,footer:!!s.querySelector('.sidebar-bottom .user-info'),logout:!!s.querySelector('.user-logout'),tables:[...document.querySelectorAll('td:has(.users-role,.users-state),th:has(.users-role,.users-state)')].map(e=>({width:e.getBoundingClientRect().width,break:getComputedStyle(e).wordBreak})),dialogs:[...document.querySelectorAll('dialog[open],[role=dialog]')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}),mainWidth:m.getBoundingClientRect().width}})()`);
    assert.equal(data.topbar,false,label+' old global bar');assert.ok(data.footer&&data.logout,label+' sidebar user');assert.ok(data.scroll<=data.width+1,label+' overflow '+JSON.stringify(data));
    assert.ok(data.mainWidth>0,label+' main width');if(data.width>=768&&data.width<1024)assert.equal(data.sidebarWidth,72,label+' compact sidebar');
    for(const c of data.tables){assert.ok(c.width>=110,label+' compressed role');assert.notEqual(c.break,'break-all');}
    for(const d of data.dialogs){assert.ok(d.left>=-1&&d.right<=data.width+1&&d.top>=-1&&d.bottom<=await evaluate('innerHeight')+1,label+' modal outside viewport '+JSON.stringify(d));}
    checkpoints++;
  };
  for(const role of ['admin','recepcionista','medico','superadmin']){
    await login(role);
    const rolePages=role==='superadmin'?['/superadmin/dashboard','/superadmin/veterinarias','/superadmin/soporte','/superadmin/cuenta']:pages.filter(([p,perm])=>(!perm||permissionFixture[role].includes(perm))&&(!['/clinica','/expediente'].includes(p)||['admin','medico'].includes(role))).map(([p])=>p);
    for(const [width,height] of sizes){
      await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      for(const p of rolePages){
        await route(p==='/expediente'?p+'?paciente=00000000-0000-4000-8000-000000000050':p);await check(role+' '+p+' '+width);assert.equal(await text('403 ·'),false,'authorized '+p);
        if(role==='admin'&&[1536,390].includes(width))await shot('admin-'+p.replaceAll('/','-')+'-'+width);
        if(role==='admin'&&p==='/dashboard'&&[1920,1366,1024].includes(width))await shot('inicio-5-cases-'+width);
        if(role==='admin'&&p==='/configuracion/usuarios'&&width===820)await shot('usuarios-tablet-820');
        if(role==='superadmin'&&[1536,390].includes(width)&&p==='/superadmin/dashboard')await shot('superadmin-'+width);
        if(role==='admin'&&p==='/configuracion/usuarios'){
          await evaluate(`document.querySelector('button[aria-label="Permisos de María Fernanda López"]').click()`);
          await until(()=>evaluate('document.querySelectorAll(".users-permission-row").length>0'),'permission rows');await check('permissions '+width);
          assert.equal(await text('Órdenes de recepción'),true);assert.equal(await evaluate('[...document.querySelectorAll(".users-permission-group h4")].some(h=>h.textContent.includes("_"))'),false);
          const select=await evaluate('document.querySelector(".users-permission-row select").value');assert.equal(select,'inherit');
          if([1536,390].includes(width))await shot('permissions-'+width);await click('Cerrar');
        }
      }
      if(role==='admin'){
        const heights=[];
        for(const count of [0,1,2,3,5,10,20,100]){
          await route('/propietarios');await evaluate('window.__finalSmoke.flowCount='+count);await route('/dashboard');
          await until(()=>evaluate('[...document.querySelectorAll(".home-column-heading>span")].length===3&&[...document.querySelectorAll(".home-column-heading>span")].every(e=>e.textContent==='+JSON.stringify(String(count))+')'),'flow totals '+count);
          const flow=await evaluate('({height:document.querySelector(".home-flow").getBoundingClientRect().height,counts:[...document.querySelectorAll(".home-column")].map(c=>c.querySelectorAll(".home-patient-card").length),links:[...document.querySelectorAll(".home-view-all")].map(e=>e.textContent),nestedScroll:[...document.querySelectorAll(".home-flow-records")].some(e=>e.scrollHeight>e.clientHeight+1)})');
          assert.deepEqual(flow.counts,[Math.min(count,2),Math.min(count,2),Math.min(count,2)],'two previews only');assert.ok(flow.links.every(t=>t.includes('('+count+')')),'links use full totals');assert.equal(flow.nestedScroll,false,'no long nested scroll');heights.push(flow.height);await check('flow '+count+' '+width);
          if(count===20&&[1920,1366,1024].includes(width))await shot('inicio-20-cases-'+width);
        }
        assert.ok(Math.max(...heights)-Math.min(...heights)<=4,'stable flow height '+width+' '+JSON.stringify(heights));
        await evaluate('window.__finalSmoke.flowCount=5');await route('/propietarios');await route('/dashboard');
      }
      if(width<768){
        await evaluate('document.querySelector(".mobile-menu").focus();document.querySelector(".mobile-menu").click()');await until(()=>evaluate('document.querySelector(".app").classList.contains("sidebar-open")'),'mobile nav');await check('mobile drawer '+role);await shot(role+'-sidebar-mobile');
        assert.equal(await evaluate('document.activeElement.classList.contains("sidebar-close")'),true,'focus enters drawer: '+await evaluate('JSON.stringify({active:document.activeElement.className,close:document.querySelector(".sidebar-close").getBoundingClientRect().toJSON(),visibility:getComputedStyle(document.querySelector(".sidebar-close")).visibility,display:getComputedStyle(document.querySelector(".sidebar-close")).display})'));
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:8});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
        assert.equal(await evaluate('document.activeElement.classList.contains("user-logout")'),true,'Shift Tab stays in drawer');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
        assert.equal(await evaluate('document.activeElement.classList.contains("sidebar-close")'),true,'Tab stays in drawer');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await until(()=>evaluate('!document.querySelector(".app").classList.contains("sidebar-open")'),'Escape closes navigation');
        assert.equal(await evaluate('document.activeElement.classList.contains("mobile-menu")'),true,'focus returns to navigation button');
      }
    }
    await cdp('Emulation.setDeviceMetricsOverride',{width:1536,height:864,deviceScaleFactor:1,mobile:false});
    if(role!=='superadmin'){
      await route('/dashboard');await until(()=>text('Hola,'),'Inicio greeting');assert.equal(await text('Dashboard'),false,'visible name');
      if(!permissionFixture[role].includes('pagos.ver')){assert.equal(await text('Pagos pendientes'),false);assert.equal(await text('Por cobrar'),false);}
      if(role==='admin'){
        await click('Nueva cita');await until(()=>evaluate('!!document.querySelector("#appointment-owner")'),'Inicio opens existing appointment wizard');await shot('inicio-new-appointment');await click('Cancelar');
        await route('/dashboard');await click('+ Paciente');await until(()=>evaluate('!!document.querySelector("#patient-name")'),'Inicio opens patient form');await click('Cancelar');
      }
      const denied=pages.find(([,perm])=>perm&&!permissionFixture[role].includes(perm));if(denied){await route(denied[0]);await until(()=>text('403'),'role guard');}
    }else{
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".navigation .nav-label")].map(e=>e.textContent)'),['Inicio','Veterinarias','Soporte','Mi cuenta']);assert.equal(await evaluate('!!document.querySelector(".sidebar img")'),false);
    }
    await evaluate('document.querySelector(".sidebar .user-logout").click()');await until(()=>text('Iniciar sesión'),'logout '+role);
  }
  assert.deepEqual(await evaluate('window.__finalSmoke.unknown'),[]);assert.deepEqual(exceptions,[]);
  console.log('PASS selective recovery: '+checkpoints+' checkpoints; eight resolutions, all authorized modules, four roles, no global topbar, sidebar identity/footer, 72px tablet nav, mobile Escape/focus, legible tables, permission inheritance labels, Inicio actions and logout. Flow counts 0/1/2/3/5/10/20/100: at most two previews, accurate totals, stable height and no nested scrolling.');
  console.log('Screenshots: '+temp);
})().catch(async error=>{if(diagnose)console.error(JSON.stringify(await diagnose()));console.error(error.stack||error);process.exitCode=1;}).finally(()=>{clearTimeout(deadline);ws?.close();for(const child of children)child.kill();});
