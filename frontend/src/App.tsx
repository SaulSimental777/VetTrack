import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './pages/login'
import Duenos from './pages/Duenos'
import Pacientes from './pages/Pacientes'
import Tenants from './pages/Tenants'
import Dashboard from './pages/Dashboard'
import Usuarios from './pages/Usuarios'
import { apiFetch } from './lib/api'
import { PermissionsContext } from './lib/permissions'
import type { ClinicAccess } from './lib/permissions'
import './App.css'

const clinicRoutes = [
  { path: '/dashboard', title: 'Dashboard', permission: 'dashboard.ver', icon: '▦' },
  { path: '/propietarios', title: 'Propietarios', permission: 'propietarios.ver', icon: '♙' },
  { path: '/pacientes', title: 'Pacientes', permission: 'pacientes.ver', icon: '♧' },
  { path: '/configuracion/usuarios', title: 'Usuarios', permission: 'usuarios.ver', icon: '⚙' },
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
      <button type="button" className="nav-item logout" onClick={logout} disabled={pending}>
        <span aria-hidden="true">←</span>
        <span className="nav-label">{pending ? 'Cerrando sesión…' : 'Cerrar sesión'}</span>
      </button>
      {error && <p className="logout-error" role="alert">{error}</p>}
    </>
  )
}

function Workspace({ session, clinic, role, title, navigation, children }: {
  session: Session
  clinic?: string
  role?: string
  title: string
  navigation: ReactNode
  children: ReactNode
}) {
  const email = session.user.email || 'Sin correo electrónico'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">V</div>
          <div><h1>VetTrack</h1><span>Gestión veterinaria</span></div>
        </div>
        <nav className="navigation" aria-label="Navegación principal">{navigation}</nav>
        <div className="sidebar-bottom"><LogoutButton /></div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">VetTrack / {clinic ? `${clinic} / ` : ''}{title}</span>
            <h2>{title}</h2>
          </div>
          <div className="user-area">
            <div className="clinic">
              <span className="clinic-label">{clinic ? 'Clínica actual' : 'Administración'}</span>
              <strong>{clinic || 'Todas las veterinarias'}</strong>
            </div>
            <div className="user-avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</div>
            <div className="user-info">
              <strong>{clinic ? (role || 'Usuario de clínica') : 'Superadministrador'}</strong>
              <span>{email}</span>
            </div>
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
  const allowed = route && can(route.permission)
  const pageKey = `${access.id}:${access.id_veterinaria}:${access.rol}:${[...access.permisos].sort().join(',')}`
  const roleLabel = { admin: 'Administrador', recepcionista: 'Recepcionista', medico: 'Médico' }[access.rol]

  return (
    <PermissionsContext.Provider value={{ access, refresh, can }}>
    <Workspace session={session} clinic={access.nombre_veterinaria} role={roleLabel} title={route?.title || 'Acceso no autorizado'} navigation={
      <>
        {clinicRoutes.filter(item => can(item.permission)).map(item => <div key={item.path}>
          {item.path === '/configuracion/usuarios' && <div className="nav-section">Configuración</div>}
          <button type="button" className={`nav-item ${path === item.path ? 'active' : ''}`} aria-current={path === item.path ? 'page' : undefined} onClick={() => { window.location.hash = item.path }}>
            <span aria-hidden="true">{item.icon}</span><span className="nav-label">{item.title}</span>
          </button>
        </div>)}
        {[
          ['citas.ver', 'Citas', '▣'], ['diagnosticos.ver', 'Diagnósticos', '✚'],
          ['servicios.ver', 'Servicios', '◆'], ['inventario.ver', 'Inventario', '□'], ['pagos.ver', 'Pagos', '$'],
        ].filter(([permission]) => can(permission)).map(([permission, label, icon]) => <button key={permission} type="button" className="nav-item" disabled title="Próximamente"><span aria-hidden="true">{icon}</span><span className="nav-label">{label}</span></button>)}
      </>
    }>
      <div key={pageKey}>
        {!allowed ? <div className="panel access-denied" role="alert"><h3>403 · Acceso no autorizado</h3><p>No tienes permiso para abrir esta pantalla.</p></div>
          : path === '/propietarios' ? <Duenos />
          : path === '/pacientes' ? <Pacientes />
          : path === '/configuracion/usuarios' ? <Usuarios />
          : <Dashboard clinicId={access.id_veterinaria} clinicName={access.nombre_veterinaria} />}
      </div>
    </Workspace>
    </PermissionsContext.Provider>
  )
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
    return (
      <Workspace key={`${session.user.id}:global`} session={session} title="Veterinarias" navigation={
        <button type="button" className="nav-item active" aria-current="page"><span aria-hidden="true">▦</span><span className="nav-label">Veterinarias</span></button>
      }>
        <Tenants />
      </Workspace>
    )
  }

  return <ClinicWorkspace key={`${session.user.id}:clinic`} session={session} />
}

export default App
