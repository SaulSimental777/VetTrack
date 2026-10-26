import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './pages/login'
import Duenos from './pages/Duenos'
import Tenants from './pages/Tenants'
import Dashboard from './pages/Dashboard'
import './App.css'

type Pagina = 'dashboard' | 'duenos'

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

function Workspace({ session, clinic, title, navigation, children }: {
  session: Session
  clinic?: string
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
            <span className="breadcrumb">VetTrack / {title}</span>
            <h2>{title}</h2>
          </div>
          <div className="user-area">
            <div className="clinic">
              <span className="clinic-label">{clinic ? 'Clínica actual' : 'Administración'}</span>
              <strong>{clinic || 'Todas las veterinarias'}</strong>
            </div>
            <div className="user-avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</div>
            <div className="user-info">
              <strong>{clinic ? 'Usuario de clínica' : 'Superadministrador'}</strong>
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
  const [clinic, setClinic] = useState<{ id: string; nombre: string } | null>(null)
  const [error, setError] = useState('')
  const [pagina, setPagina] = useState<Pagina>('dashboard')
  const userId = session.user.id

  useEffect(() => {
    const controller = new AbortController()

    const loadClinic = async () => {
      try {
        const { data: perfil, error: perfilError } = await supabase
          .from('perfilusuario')
          .select('id_veterinaria')
          .eq('id', userId)
          .abortSignal(controller.signal)
          .single()

        if (controller.signal.aborted) return
        if (perfilError || !perfil?.id_veterinaria) {
          throw new Error('Tu cuenta no tiene un perfil de clínica disponible. Solicita al administrador que revise tu acceso.')
        }

        const { data: vet, error: vetError } = await supabase
          .from('veterinaria')
          .select('id_veterinaria, nombre')
          .eq('id_veterinaria', perfil.id_veterinaria)
          .abortSignal(controller.signal)
          .single()

        if (controller.signal.aborted) return
        if (vetError || !vet?.nombre) {
          throw new Error('No se pudo obtener la clínica asignada. Solicita al administrador que revise tu acceso.')
        }
        setClinic({ id: vet.id_veterinaria, nombre: vet.nombre })
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar la clínica asignada.')
        }
      }
    }

    void loadClinic()
    return () => controller.abort()
  }, [userId])

  if (error) return <SessionScreen message={error}><div className="session-actions"><LogoutButton /></div></SessionScreen>
  if (!clinic) return <SessionScreen message="Cargando tu clínica…" />

  return (
    <Workspace session={session} clinic={clinic.nombre} title={pagina === 'duenos' ? 'Dueños' : 'Dashboard'} navigation={
      <>
        <button type="button" className={`nav-item ${pagina === 'dashboard' ? 'active' : ''}`} aria-current={pagina === 'dashboard' ? 'page' : undefined} onClick={() => setPagina('dashboard')}>
          <span aria-hidden="true">▦</span><span className="nav-label">Dashboard</span>
        </button>
        <button type="button" className={`nav-item ${pagina === 'duenos' ? 'active' : ''}`} aria-current={pagina === 'duenos' ? 'page' : undefined} onClick={() => setPagina('duenos')}>
          <span aria-hidden="true">♙</span><span className="nav-label">Dueños</span>
        </button>
        <button type="button" className="nav-item" disabled title="Próximamente"><span aria-hidden="true">♧</span><span className="nav-label">Mascotas</span></button>
        <button type="button" className="nav-item" disabled title="Próximamente"><span aria-hidden="true">▣</span><span className="nav-label">Citas</span></button>
        <button type="button" className="nav-item" disabled title="Próximamente"><span aria-hidden="true">✚</span><span className="nav-label">Diagnósticos</span></button>
        <div className="nav-section">Administración</div>
        <button type="button" className="nav-item" disabled title="Próximamente"><span aria-hidden="true">◆</span><span className="nav-label">Servicios</span></button>
        <button type="button" className="nav-item" disabled title="Próximamente"><span aria-hidden="true">□</span><span className="nav-label">Productos</span></button>
        <button type="button" className="nav-item" disabled title="Próximamente"><span aria-hidden="true">$</span><span className="nav-label">Pagos</span></button>
        <button type="button" className="nav-item" disabled title="Próximamente"><span aria-hidden="true">⚙</span><span className="nav-label">Configuración</span></button>
      </>
    }>
      {pagina === 'duenos' ? <Duenos /> : <Dashboard clinicId={clinic.id} clinicName={clinic.nombre} />}
    </Workspace>
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
