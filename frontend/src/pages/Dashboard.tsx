import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePermissions } from '../lib/permissions'

const metrics = [
  { table: 'dueno', label: 'Propietarios', icon: '♙', detail: 'Registrados en la clínica' },
  { table: 'mascota', label: 'Pacientes', icon: '♧', detail: 'Pacientes registrados' },
  { table: 'cita', label: 'Citas', icon: '▣', detail: 'Citas registradas' },
  { table: 'diagnostico', label: 'Diagnósticos', icon: '✚', detail: 'Registros médicos' },
] as const

function Dashboard({ clinicId, clinicName }: { clinicId: string; clinicName: string }) {
  const { access, can } = usePermissions()
  const [counts, setCounts] = useState<(number | null)[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    const loadCounts = async () => {
      const results = await Promise.allSettled(metrics.map(async ({ table }) => {
        const permission = { dueno: 'propietarios.ver', mascota: 'pacientes.ver', cita: 'citas.ver', diagnostico: 'diagnosticos.ver' }[table]
        if (!access.permisos.includes(permission)) return null
        const query = table === 'mascota'
          ? supabase.from(table).select('*', { count: 'exact', head: true })
          : supabase.from(table).select('*', { count: 'exact', head: true }).eq('id_veterinaria', clinicId)
        const { count, error } = await query.abortSignal(controller.signal)
        if (error) throw error
        return count
      }))

      if (controller.signal.aborted) return
      setCounts(results.map(result => result.status === 'fulfilled' ? result.value : null))
      setFailed(results.some(result => result.status === 'rejected'))
    }

    void loadCounts()
    return () => controller.abort()
  }, [clinicId, access.permisos])

  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow">Panel principal</span>
          <h3>Bienvenido a VetTrack</h3>
          <p>Administra los pacientes, propietarios, citas y servicios de {clinicName}.</p>
        </div>
      </div>
      {failed && <p className="dashboard-error" role="alert">No se pudieron cargar algunas estadísticas. Los valores no disponibles se muestran como —.</p>}
      <section className="stats-grid" aria-label="Estadísticas de la clínica" aria-busy={counts === null}>
        {metrics.map((metric, index) => can({ dueno: 'propietarios.ver', mascota: 'pacientes.ver', cita: 'citas.ver', diagnostico: 'diagnosticos.ver' }[metric.table]) && (
          <div className="stat-card" key={metric.table}>
            <div className="stat-icon" aria-hidden="true">{metric.icon}</div>
            <div>
              <span>{metric.label}</span>
              <strong>{counts === null ? '…' : (counts[index] ?? '—')}</strong>
              <small>{counts === null ? 'Cargando…' : metric.detail}</small>
            </div>
          </div>
        ))}
      </section>
      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header"><div><span className="eyebrow">Agenda</span><h3>Próximas citas</h3></div></div>
          <div className="dashboard-placeholder">{can('citas.ver') ? <><p>Consulta las citas, los médicos y los horarios disponibles en la agenda de tu clínica.</p><button type="button" className="text-button" onClick={() => { window.location.hash = '/citas' }}>Abrir agenda</button></> : 'No tienes permiso para consultar la agenda.'}</div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><span className="eyebrow">Actividad</span><h3>Actividad reciente</h3></div></div>
          <p className="dashboard-placeholder">El historial de actividad todavía no está disponible.</p>
        </div>
      </section>
      <section className="tenant-banner">
        <div className="tenant-icon" aria-hidden="true">V</div>
        <div><span>Clínica actual</span><strong>{clinicName}</strong><p>Los datos mostrados corresponden a esta clínica.</p></div>
      </section>
    </>
  )
}

export default Dashboard
