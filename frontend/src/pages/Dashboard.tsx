import { usePermissions } from '../lib/permissions'
import { clinicDateTime, clinicDayRange, clinicInputDateTime, clinicToday, useOperationResource } from '../lib/operations'
import type { Cita } from '../lib/operations'
import type { PaymentList } from '../lib/final-operations'
import { OperationState } from '../components/OperationsUI'
import { Icon } from '../components/Icon'
import './Inicio.css'

interface DashboardData { fecha: string; metricas: { titulo: string; valor: number; ruta: string }[]; citas: { id_cita: string; fecha_inicio: string; estado: string; paciente: string; medico: string | null }[] }
interface ActiveConsultation { id_consulta: string; id_mascota?: string; paciente: string; propietario: string; medico: string; estado: string; fecha_inicio: string }
interface PatientProfile { id_mascota: string; nombre: string; especie: string | null; raza: string | null; sexo: string | null }
const go = (path: string) => { window.location.hash = path }
const presentMetric = (title: string) => title === 'Citas del día' ? 'Citas de hoy' : title

export default function Dashboard({ clinicName }: { clinicId: string; clinicName: string }) {
  const { can, access } = usePermissions()
  const resource = useOperationResource<DashboardData>('/api/operacion/dashboard')
  const today = clinicToday()
  const range = new URLSearchParams({ ...clinicDayRange(today), ...(access.rol === 'medico' ? { medico: access.id } : {}) })
  const appointments = useOperationResource<Cita[]>(can('citas.ver') ? '/api/citas?' + range : null)
  const clinicalAccess = can('consultas.ver') && ['admin', 'medico'].includes(access.rol)
  const consultations = useOperationResource<ActiveConsultation[]>(clinicalAccess ? '/api/clinica/consultas?mias=' + (access.rol === 'medico') : null)
  const payments = useOperationResource<PaymentList>(can('pagos.ver') ? '/api/operacion/pagos' : null)
  const patients = useOperationResource<PatientProfile[]>(can('pacientes.ver') ? '/api/pacientes' : null)
  const metric = (title: string) => resource.data?.metricas.find(item => item.titulo === title)
  const summary = ['Citas del día', 'Citas pendientes', 'Pacientes registrados', 'Pagos pendientes']
    .flatMap(title => { const value = metric(title); return value ? [value] : [] })
  const icons: Record<string, string> = { 'Citas del día': 'calendar', 'Citas pendientes': 'clock', 'Pacientes registrados': 'patient', 'Pagos pendientes': 'money' }
  const waiting = (appointments.data || []).filter(c => ['programada', 'confirmada', 'en_espera'].includes(c.estado) && clinicInputDateTime(c.fecha_inicio).slice(0, 10) === today)
  const ongoing = (consultations.data || []).filter(c => c.estado === 'en_curso')
  // The clinical list can be capped; the existing dashboard aggregate is the total.
  const ongoingTotal = resource.loading || resource.error ? null : metric('Consultas en curso')?.valor ?? null
  const alerts = [
    { key: 'Stock bajo', empty: 'Stock al día', title: 'Productos con stock bajo', icon: 'box' },
    { key: 'Lotes próximos a caducar', empty: 'Sin lotes por caducar', title: 'Lotes por caducar', icon: 'clock' },
    { key: 'Órdenes pendientes', empty: 'Sin órdenes pendientes', title: 'Órdenes pendientes', icon: 'file' },
    { key: 'Recepciones de los últimos 7 días', empty: 'Sin recepciones nuevas', title: 'Recepciones recientes', icon: 'box' },
  ].flatMap(alert => { const value = metric(alert.key); return value ? [{ ...alert, ...value }] : [] })
  const date = new Date((resource.data?.fecha || today) + 'T12:00:00Z')
  const detail = (id?: string) => {
    const patient = patients.data?.find(p => p.id_mascota === id)
    return patient?.raza || patient?.especie || ''
  }

  return <div className="home-page" aria-label={`Inicio de ${clinicName}`}>
    <div className="home-heading users-page-header">
      <div><span className="home-date">{new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Tijuana' }).format(date)}</span></div>
      <div className="operations-actions">
        {can('citas.crear') && can('citas.ver') && <button type="button" className="primary-button home-primary" onClick={() => go('/citas?nueva=1')}>+ Nueva cita</button>}
        {can('pacientes.crear') && can('pacientes.ver') && <button type="button" className="users-secondary-button" onClick={() => go('/pacientes?nuevo=1')}>+ Paciente</button>}
      </div>
    </div>
    <OperationState loading={resource.loading} error={resource.error} empty={false}>
      {!!summary.length && <section className="home-summary" aria-label="Resumen de Inicio">
        {summary.map(item => <button type="button" className="home-stat" key={item.titulo} onClick={() => go(item.ruta)}>
          <span className="home-stat-icon"><Icon name={icons[item.titulo]} /></span><span className="home-stat-label">{presentMetric(item.titulo)}</span><strong>{item.valor}</strong><span className="home-stat-note">Ver detalle</span>
        </button>)}
      </section>}
      <div className="home-section-title"><div><h4>Flujo del día</h4><p>Atenciones y pendientes para continuar.</p></div>{can('citas.ver') && <button type="button" className="users-link-button" onClick={() => go('/citas')}>Abrir agenda</button>}</div>
      <div className="home-flow">
        {can('citas.ver') && <section className="home-column"><div className="home-column-heading"><h4><Icon name="calendar" />Por atender</h4><span>{appointments.loading ? '—' : appointments.error ? '—' : waiting.length}</span></div>
          <OperationState loading={appointments.loading} error={appointments.error} empty={false}>
            {!appointments.loading && !appointments.error && !waiting.length && <div className="home-empty"><Icon name="calendar" /><p>Sin citas por atender</p>{can('citas.crear') && <button type="button" className="users-link-button" onClick={() => go('/citas?nueva=1')}>Agendar cita</button>}</div>}
            <div className="home-flow-records">{waiting.slice(0, 2).map(c => <article className="home-patient-card" key={c.id_cita}><div className="home-case"><h5>{c.paciente}</h5><p>{[clinicDateTime(c.fecha_inicio).split(', ').at(-1), c.propietario].filter(Boolean).join(' · ')}</p><small>{c.medico || 'Sin médico asignado'}</small></div>{clinicalAccess && can('consultas.crear') && <button type="button" className="users-link-button" onClick={() => go('/clinica?cita=' + c.id_cita)}>Atender</button>}</article>)}</div>
          </OperationState>
          <button type="button" className="home-view-all users-link-button" onClick={() => go('/citas')}>Ver todas las citas{!appointments.loading && !appointments.error ? ` (${waiting.length})` : ''}</button>
        </section>}
        {clinicalAccess && <section className="home-column"><div className="home-column-heading"><h4><Icon name="clinical" />En consulta</h4><span>{ongoingTotal ?? '—'}</span></div><p className="home-column-caption">Consultas en curso</p>
          <OperationState loading={consultations.loading} error={consultations.error} empty={false}>
            {!consultations.loading && !consultations.error && !ongoing.length && <div className="home-empty"><Icon name="clinical" /><p>{ongoingTotal === 0 ? 'Sin consultas en curso' : 'Consulta el listado completo para continuar.'}</p></div>}
            <div className="home-flow-records">{ongoing.slice(0, 2).map(c => <article className="home-patient-card" key={c.id_consulta}><div className="home-case"><h5>{c.paciente}</h5><p>{[detail(c.id_mascota), c.propietario].filter(Boolean).join(' · ')}</p><small>{c.medico}</small></div><button type="button" className="users-link-button" onClick={() => go('/clinica?consulta=' + c.id_consulta)}>Abrir consulta</button></article>)}</div>
          </OperationState>
          <button type="button" className="home-view-all users-link-button" onClick={() => go('/clinica')}>Ver todas las consultas{ongoingTotal !== null ? ` (${ongoingTotal})` : ''}</button>
        </section>}
        {can('pagos.ver') && <section className="home-column"><div className="home-column-heading"><h4><Icon name="money" />Por cobrar</h4><span>{payments.loading ? '—' : payments.error ? '—' : payments.data?.pendientes.length ?? '—'}</span></div>
          <OperationState loading={payments.loading} error={payments.error} empty={false}>
            {!payments.loading && !payments.error && !payments.data?.pendientes.length && <div className="home-empty"><Icon name="money" /><p>Nada por cobrar</p></div>}
            <div className="home-flow-records">{payments.data?.pendientes.slice(0, 2).map(p => <article className="home-patient-card" key={p.id_orden}><div className="home-case"><h5>{p.paciente.nombre}</h5><p>{p.propietario.nombre}</p></div><button type="button" className="users-link-button" onClick={() => go('/pagos?orden=' + p.id_orden)}>Revisar pago</button></article>)}</div>
          </OperationState>
          <button type="button" className="home-view-all users-link-button" onClick={() => go('/pagos')}>Ver pendientes de cobro{!payments.loading && !payments.error && payments.data ? ` (${payments.data.pendientes.length})` : ''}</button>
        </section>}
      </div>
      {!!alerts.length && <section className="home-review"><div className="home-section-title"><div><h4>Revisar</h4><p>Alertas operativas de tu clínica.</p></div></div><div className="home-alert-grid">{alerts.map(item => <button type="button" className="home-alert" onClick={() => go(item.ruta)} key={item.key}><span className={item.valor ? 'home-alert-icon warning' : 'home-alert-icon'}><Icon name={item.icon} /></span><span><strong>{item.valor ? item.title : item.empty}</strong><small>{item.valor ? item.valor + ' por revisar' : 'Todo en orden'}{item.key.includes('Recepciones') ? ' · últimos 7 días' : item.key.includes('caducar') ? ' · próximos 30 días' : ''}</small></span><b>{item.valor}</b></button>)}</div></section>}
    </OperationState>
  </div>
}
