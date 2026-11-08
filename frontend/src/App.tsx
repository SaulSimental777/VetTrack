import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './pages/login'
import Duenos from './pages/Duenos'
import Pacientes from './pages/Pacientes'
import Dashboard from './pages/Dashboard'
import Usuarios from './pages/Usuarios'
import { apiFetch } from './lib/api'
import { PermissionsContext } from './lib/permissions'
import type { ClinicAccess } from './lib/permissions'
import './App.css'
import './design-system.css'
import { ConfirmProvider } from './components/ConfirmProvider'
import { Icon } from './components/Icon'
import { StoredImage } from './components/FileUpload'

const Support = lazy(() => import('./pages/Support'))
const GlobalDashboard = lazy(() => import('./pages/Platform').then(m => ({ default: m.GlobalDashboard })))
const GlobalTenants = lazy(() => import('./pages/Platform').then(m => ({ default: m.GlobalTenants })))
const GlobalAccount = lazy(() => import('./pages/Platform').then(m => ({ default: m.GlobalAccount })))

const Horarios = lazy(() => import('./pages/Horarios'))
const Medicos = lazy(() => import('./pages/Medicos'))
const Servicios = lazy(() => import('./pages/Servicios'))
const Citas = lazy(() => import('./pages/Citas'))
const Clinica = lazy(() => import('./pages/Clinica'))
const Expediente = lazy(() => import('./pages/Expediente'))
const OrdenesRecepcion = lazy(() => import('./pages/OrdenesRecepcion'))
const Inventario = lazy(() => import('./pages/Inventario'))
const Pagos = lazy(() => import('./pages/FinalOperations').then(m => ({ default: m.Pagos })))
const Reportes = lazy(() => import('./pages/FinalOperations').then(m => ({ default: m.Reportes })))
const Configuracion = lazy(() => import('./pages/FinalOperations').then(m => ({ default: m.Configuracion })))

const clinicRoutes = [
  { path: '/dashboard', title: 'Dashboard', permission: 'dashboard.ver', icon: 'dashboard' },
  { path: '/propietarios', title: 'Propietarios', permission: 'propietarios.ver', icon: 'people' },
  { path: '/pacientes', title: 'Pacientes', permission: 'pacientes.ver', icon: 'patient' },
  { path: '/citas', title: 'Citas', permission: 'citas.ver', icon: 'calendar' },
  { path: '/clinica', title: 'Consultas', permission: 'consultas.ver', icon: 'clinical' },
  { path: '/expediente', title: 'Expediente', permission: 'expediente.ver', icon: 'file' },
  { path: '/ordenes-recepcion', title: 'Órdenes de recepción', permission: 'orden_recepcion.ver', icon: 'file' },
  { path: '/medicos', title: 'Médicos', permission: 'medicos.ver', icon: 'people' },
  { path: '/horarios', title: 'Horarios', permission: 'horarios.ver', icon: 'clock' },
  { path: '/servicios', title: 'Servicios', permission: 'servicios.ver', icon: 'clinical' },
  { path: '/inventario', title: 'Inventario', permission: 'inventario.ver', icon: 'box' },
  { path: '/proveedores', title: 'Proveedores', permission: 'proveedores.ver', icon: 'people' },
  { path: '/compras', title: 'Compras', permission: 'compras.ver', icon: 'box' },
  { path: '/pagos', title: 'Pagos', permission: 'pagos.ver', icon: 'money' },
  { path: '/reportes', title: 'Reportes', permission: 'reportes.ver', icon: 'file' },
  { path: '/configuracion', title: 'Configuración', permission: 'configuracion.ver', icon: 'settings' },
  { path: '/configuracion/usuarios', title: 'Usuarios', permission: 'usuarios.ver', icon: 'settings' },
  { path: '/soporte', title: 'Ayuda y soporte', permission: null, icon: 'file' },
] as const

const currentClinicPath = () => window.location.hash.startsWith('#/')
  ? window.location.hash.slice(1).split('?')[0]
  : (window.location.pathname === '/' ? '/dashboard' : window.location.pathname)

function SessionScreen({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <main className="loading-screen">
      <div className="loading-logo" aria-hidden="true">V</div>
      <h1>VetTrack</h1>
      <p role="status">{message}</p>
      {children}
    </main>
  )
}

function LogoutButton() {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const logout = async () => {
    if (pending) return
    setPending(true)
    setError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch {
      setError('No se pudo cerrar la sesión. Intenta de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button type="button" className="user-logout" aria-label="Cerrar sesión" onClick={logout} disabled={pending}>
        <Icon name="logout" />
        <span className="nav-label">{pending ? 'Cerrando sesión…' : 'Cerrar sesión'}</span>
      </button>
      {error && <p className="logout-error" role="alert">{error}</p>}
    </>
  )
}

function Workspace({ session, clinic, role, userName, title, navigation, children, logoArchivo }: {
  session: Session
  clinic?: string
  role?: string
  userName?: string | null
  title: string
  navigation: ReactNode
  children: ReactNode
  logoArchivo?: string | null
}) {
  const [sidebar, setSidebar] = useState(false)
  const email = session.user.email || 'Sin correo electrónico'

  return (
    <div className={`app ${sidebar ? 'sidebar-open' : ''}`}><button type="button" className="sidebar-backdrop" aria-label="Cerrar navegación" onClick={() => setSidebar(false)} />
      <aside className="sidebar" onClick={event => { if ((event.target as HTMLElement).closest('button')) setSidebar(false) }}>
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">V</div>
          <div><h1>VetTrack</h1><span>{clinic ? 'Gestión veterinaria' : 'Administración global'}</span></div>
        </div>
        <nav className="navigation" aria-label="Navegación principal">{navigation}</nav>
      </aside>
      <main className="main-content">
        <header className={`topbar${clinic ? ' topbar-clinic' : ''}`}><button type="button" className="mobile-menu" aria-label="Abrir navegación" aria-expanded={sidebar} onClick={() => setSidebar(value => !value)}><Icon name="menu" /></button>
          <div className="workspace-title">
            <span className="breadcrumb">VetTrack / {clinic ? `${clinic} / ` : ''}{title}</span>
            <h2>{title}</h2>
          </div>
          <div className="user-area">
            <div className="clinic">
              {clinic && logoArchivo && <StoredImage id={logoArchivo} alt={`Logo de ${clinic}`} className="header-clinic-logo" />}
              <div className="clinic-info">
                <span className="clinic-label">{clinic ? 'Clínica actual' : 'Administración'}</span>
                <strong title={clinic || 'Todas las veterinarias'}>{clinic || 'Todas las veterinarias'}</strong>
              </div>
            </div>
            <div className="user-avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</div>
            <div className="user-info">
              <strong>{userName || (clinic ? (role || 'Usuario de clínica') : 'Superadministrador')}</strong>
              <span title={email}>{role || 'Superadministrador'} · {clinic || 'Administración global'}</span>
            </div>
            <LogoutButton />
          </div>
        </header>
        <section className="content">{children}</section>
      </main>
    </div>
  )
}

function ClinicWorkspace({ session }: { session: Session }) {
  const [access, setAccess] = useState<ClinicAccess | null>(null)
  const [error, setError] = useState('')
  const [path, setPath] = useState(currentClinicPath)
  const request = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const data = await apiFetch<ClinicAccess>('/api/sesion', { signal: controller.signal })
      if (!controller.signal.aborted) { setAccess(data); setError('') }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setAccess(null)
        setError(cause instanceof Error ? cause.message : 'No se pudo verificar el acceso a la clínica.')
        throw cause
      }
    }
  }, [])

  useEffect(() => {
    const reload = () => { void refresh().catch(() => {}) }
    const routeChanged = () => setPath(currentClinicPath())
    const visible = () => { if (document.visibilityState === 'visible') reload() }
    reload()
    window.addEventListener('focus', reload)
    window.addEventListener('vettrack:access-changed', reload)
    window.addEventListener('hashchange', routeChanged)
    window.addEventListener('popstate', routeChanged)
    document.addEventListener('visibilitychange', visible)
    const interval = window.setInterval(reload, 30000)
    return () => {
      request.current?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', reload)
      window.removeEventListener('vettrack:access-changed', reload)
      window.removeEventListener('hashchange', routeChanged)
      window.removeEventListener('popstate', routeChanged)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])

  const can = useCallback((key: string) => access?.permisos.includes(key) === true, [access])
  if (error) return <SessionScreen message={error}><button type="button" className="primary-button" onClick={() => { void refresh().catch(() => {}) }}>Reintentar</button><div className="session-actions"><LogoutButton /></div></SessionScreen>
  if (!access) return <SessionScreen message="Verificando tu clínica y permisos…" />
  const route = clinicRoutes.find(item => item.path === path)
  const visible = (item: typeof clinicRoutes[number]) => (!item.permission || can(item.permission)) && (!['/clinica','/expediente'].includes(item.path) || ['admin','medico'].includes(access.rol))
  const allowed = route && visible(route)
  const pageKey = `${access.id}:${access.id_veterinaria}:${access.rol}:${[...access.permisos].sort().join(',')}`
  const roleLabel = { admin: 'Administrador', recepcionista: 'Recepcionista', medico: 'Médico' }[access.rol]

  if (access.estado === 'suspendido') return <PermissionsContext.Provider value={{ access, refresh, can }}><Workspace session={session} clinic={access.nombre_veterinaria} role={roleLabel} userName={access.nombre} title="Ayuda y soporte" navigation={<button type="button" className="nav-item active" aria-current="page" onClick={() => { window.location.hash='/soporte' }}><Icon name="file"/><span className="nav-label">Ayuda y soporte</span></button>}><p className="users-notice error" role="alert">Veterinaria suspendida. La operación clínica está pausada; puedes contactar a soporte. Los registros se conservan.</p><Suspense fallback={<p role="status">Cargando soporte…</p>}><Support/></Suspense></Workspace></PermissionsContext.Provider>

  return (
    <PermissionsContext.Provider value={{ access, refresh, can }}>
    <Workspace session={session} clinic={access.nombre_veterinaria} role={roleLabel} userName={access.nombre} logoArchivo={access.logo_archivo} title={route?.title || 'Acceso no autorizado'} navigation={
      <>
        {clinicRoutes.filter(visible).map(item => <div key={item.path}>
          {item.path === '/configuracion/usuarios' && <div className="nav-section">Configuración</div>}
          {item.path === '/medicos' && <div className="nav-section">Administración</div>}
          <button type="button" className={`nav-item ${path === item.path ? 'active' : ''}`} aria-current={path === item.path ? 'page' : undefined} onClick={() => { window.location.hash = item.path === '/soporte' ? `/soporte?modulo=${encodeURIComponent(path)}` : item.path }}>
            <Icon name={item.icon} /><span className="nav-label">{item.title}</span>
          </button>
        </div>)}
      </>
    }>
      <div key={pageKey}>
        <Suspense fallback={<p role="status">Cargando módulo…</p>}>
        {!allowed ? <div className="panel access-denied" role="alert"><h3>403 · Acceso no autorizado</h3><p>No tienes permiso para abrir esta pantalla.</p></div>
          : path === '/propietarios' ? <Duenos />
          : path === '/pacientes' ? <Pacientes />
          : path === '/configuracion/usuarios' ? <Usuarios />
          : path === '/medicos' ? <Medicos />
          : path === '/horarios' ? <Horarios />
          : path === '/servicios' ? <Servicios />
          : path === '/citas' ? <Citas />
          : path === '/clinica' ? <Clinica />
          : path === '/expediente' ? <Expediente />
          : path === '/ordenes-recepcion' ? <OrdenesRecepcion />
          : path === '/inventario' ? <Inventario />
          : path === '/proveedores' ? <Inventario module="proveedores" />
          : path === '/compras' ? <Inventario module="compras" />
          : path === '/pagos' ? <Pagos />
          : path === '/reportes' ? <Reportes />
          : path === '/configuracion' ? <Configuracion />
          : path === '/soporte' ? <Support />
          : <Dashboard clinicId={access.id_veterinaria} clinicName={access.nombre_veterinaria} />}
        </Suspense>
      </div>
    </Workspace>
    </PermissionsContext.Provider>
  )
}

function GlobalWorkspace({ session }: { session: Session }) {
  const [path,setPath]=useState(() => window.location.hash && currentClinicPath() !== '/dashboard' ? currentClinicPath() : '/superadmin/dashboard')
  useEffect(() => { const changed=()=>setPath(currentClinicPath()); window.addEventListener('hashchange',changed); return()=>window.removeEventListener('hashchange',changed) },[])
  const routes=[['/superadmin/dashboard','Dashboard','dashboard'],['/superadmin/veterinarias','Veterinarias','people'],['/superadmin/soporte','Soporte','file'],['/superadmin/cuenta','Mi cuenta','settings']]
  const current=routes.find(([p])=>p===path)
  return <Workspace session={session} role="Superadmin" userName={session.user.email} title={current?.[1] || 'Acceso no autorizado'} navigation={routes.map(([p,label,icon])=><button type="button" key={p} className={`nav-item ${p===path?'active':''}`} aria-current={p===path?'page':undefined} onClick={()=>{window.location.hash=p}}><Icon name={icon}/><span className="nav-label">{label}</span></button>)}><Suspense fallback={<p role="status">Cargando administración…</p>}>{path==='/superadmin/dashboard'?<GlobalDashboard/>:path==='/superadmin/veterinarias'?<GlobalTenants/>:path==='/superadmin/soporte'?<Support global/>:path==='/superadmin/cuenta'?<GlobalAccount/>:<div className="panel access-denied" role="alert"><h3>Acceso no autorizado</h3><p>Superadmin administra la plataforma. No tiene acceso clínico rutinario.</p></div>}</Suspense></Workspace>
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let authEventReceived = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived = true
      if (active) {
        setSession(nextSession)
        setError('')
        setLoading(false)
      }
    })

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authEventReceived) return
      if (sessionError) setError('No se pudo recuperar la sesión. Recarga la página para intentar de nuevo.')
      setSession(sessionError ? null : data.session)
      setLoading(false)
    }).catch(() => {
      if (!active || authEventReceived) return
      setError('No se pudo recuperar la sesión. Recarga la página para intentar de nuevo.')
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) return <SessionScreen message="Cargando sistema…" />
  if (error) return <SessionScreen message={error}><button type="button" className="primary-button" onClick={() => window.location.reload()}>Reintentar</button></SessionScreen>
  if (!session) return <Login onLogin={() => {}} />

  if (session.user.app_metadata.super_admin === true) {
    return <GlobalWorkspace key={`${session.user.id}:global`} session={session}/>
  }

  return <ClinicWorkspace key={`${session.user.id}:clinic`} session={session} />
}

export default function VetTrack() { return <ConfirmProvider><App /></ConfirmProvider> }
