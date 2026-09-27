import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './pages/login'
import Duenos from './pages/Duenos'
import './App.css'


function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [veterinaria, setVeterinaria] = useState('')
  const [pagina, setPagina] = useState<'dashboard' | 'duenos'>('dashboard')

  // Controlar la sesión del usuario
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Obtener la veterinaria del usuario autenticado
  useEffect(() => {
    const cargarVeterinaria = async () => {
      if (!session?.user?.id) {
        setVeterinaria('')
        return
      }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfilusuario')
        .select('id_veterinaria')
        .eq('id', session.user.id)
        .single()

      if (perfilError) {
        console.error('Error al obtener perfil:', perfilError)
        return
      }

      if (!perfil?.id_veterinaria) {
        console.error('El usuario no tiene una veterinaria asignada.')
        return
      }

      const { data: vet, error: vetError } = await supabase
        .from('veterinaria')
        .select('nombre')
        .eq('id_veterinaria', perfil.id_veterinaria)
        .single()

      if (vetError) {
        console.error('Error al obtener veterinaria:', vetError)
        return
      }

      setVeterinaria(vet.nombre)
    }

    cargarVeterinaria()
  }, [session])

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">V</div>
        <h2>VetTrack</h2>
        <p>Cargando sistema...</p>
      </div>
    )
  }

  if (!session) {
    return <Login onLogin={() => {}} />
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">V</div>

          <div>
            <h1>VetTrack</h1>
            <span>Gestion veterinaria</span>
          </div>
        </div>

        <nav className="navigation">
          <button
            className={`nav-item ${pagina === 'dashboard' ? 'active' : ''}`}
            onClick={() => setPagina('dashboard')}
          >
            <span>▦</span>
            Dashboard
          </button>

         <button
            className={`nav-item ${pagina === 'duenos' ? 'active' : ''}`}
            onClick={() => setPagina('duenos')}
          >
            <span>♙</span>
            Dueños
          </button>

          <button className="nav-item">
            <span>🐾</span>
            Mascotas
          </button>

          <button className="nav-item">
            <span>▣</span>
            Citas
          </button>

          <button className="nav-item">
            <span>✚</span>
            Diagnosticos
          </button>

          <div className="nav-section">
            Administracion
          </div>

          <button className="nav-item">
            <span>◆</span>
            Servicios
          </button>

          <button className="nav-item">
            <span>□</span>
            Productos
          </button>

          <button className="nav-item">
            <span>$</span>
            Pagos
          </button>

          <button className="nav-item">
            <span>⚙</span>
            Configuracion
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button
            className="nav-item logout"
            onClick={() => supabase.auth.signOut()}
          >
            <span>←</span>
            Cerrar sesion
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">VetTrack / Dashboard</span>
            <h2>Dashboard</h2>
          </div>

          <div className="user-area">
            <div className="clinic">
              <span className="clinic-label">Clinica actual</span>
              <strong>{veterinaria || 'Cargando...'}</strong>
            </div>

            <div className="user-avatar">
              VG
            </div>

            <div className="user-info">
              <strong>Administrador</strong>
              <span>admin@vettrack.test</span>
            </div>
          </div>
        </header>

        <section className="content">
        {pagina === 'duenos' ? (
          <Duenos />
        ) : (
          <>
            <div className="welcome">
            <div>
              <span className="eyebrow">Panel principal</span>
              <h3>Bienvenido a VetTrack</h3>
              <p>
                Administra los pacientes, duenos, citas y servicios
                de tu clinica veterinaria.
              </p>
            </div>

            <button className="primary-button">
              + Nueva cita
            </button>
          </div>

          <section className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">♙</div>
              <div>
                <span>Dueños</span>
                <strong>3</strong>
                <small>Registrados en la clinica</small>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">🐾</div>
              <div>
                <span>Mascotas</span>
                <strong>3</strong>
                <small>Pacientes registrados</small>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">▣</div>
              <div>
                <span>Citas</span>
                <strong>1</strong>
                <small>Citas registradas</small>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">✚</div>
              <div>
                <span>Diagnosticos</span>
                <strong>1</strong>
                <small>Registros medicos</small>
              </div>
            </div>
          </section>

          <section className="dashboard-grid">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Agenda</span>
                  <h3>Proximas citas</h3>
                </div>

                <button className="text-button">
                  Ver todas
                </button>
              </div>

              <div className="appointments">
                <div className="appointment">
                  <div className="appointment-time">
                    <strong>10:00</strong>
                    <span>Hoy</span>
                  </div>

                  <div className="appointment-info">
                    <strong>Pepito</strong>
                    <span>Consulta veterinaria</span>
                  </div>

                  <span className="status confirmed">
                    Confirmada
                  </span>
                </div>

                <div className="appointment">
                  <div className="appointment-time">
                    <strong>11:30</strong>
                    <span>Hoy</span>
                  </div>

                  <div className="appointment-info">
                    <strong>Marvin</strong>
                    <span>Revision general</span>
                  </div>

                  <span className="status pending">
                    Pendiente
                  </span>
                </div>

                <div className="appointment">
                  <div className="appointment-time">
                    <strong>13:00</strong>
                    <span>Mañana</span>
                  </div>

                  <div className="appointment-info">
                    <strong>Panchito</strong>
                    <span>Baño de mascotas</span>
                  </div>

                  <span className="status confirmed">
                    Confirmada
                  </span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Actividad</span>
                  <h3>Actividad reciente</h3>
                </div>
              </div>

              <div className="activity-list">
                <div className="activity">
                  <div className="activity-icon">🐾</div>

                  <div>
                    <strong>Nuevo paciente registrado</strong>
                    <span>Pepito fue agregado al sistema</span>
                    <small>Hace 2 horas</small>
                  </div>
                </div>

                <div className="activity">
                  <div className="activity-icon">✚</div>

                  <div>
                    <strong>Diagnostico registrado</strong>
                    <span>Se agrego un diagnostico para Pepito</span>
                    <small>Ayer</small>
                  </div>
                </div>

                <div className="activity">
                  <div className="activity-icon">▣</div>

                  <div>
                    <strong>Cita confirmada</strong>
                    <span>Consulta veterinaria</span>
                    <small>Ayer</small>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="tenant-banner">
            <div className="tenant-icon">V</div>

            <div>
              <span>Tenant actual</span>
              <strong>{veterinaria || 'Cargando...'}</strong>
              <p>
                Los datos mostrados pertenecen exclusivamente a
                esta clinica.
              </p>
            </div>

            <div className="tenant-status">
              <span></span>
              Multi-Tenant activo
            </div>
          </section>

        </>
      )}
      </section>
    </main>
    </div>
  )
}

export default App