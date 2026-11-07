import { useState } from 'react'
import type { FormEvent } from 'react'
import { apiFetch } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import { clinicDateTime, clinicDayRange, clinicInputDateTime, clinicLocalToISO, clinicToday, formatDuration, money, operationError, useOperationMutation, useOperationResource } from '../lib/operations'
import type { Cita, Disponibilidad, Medico, Servicio } from '../lib/operations'
import { OperationDialog, OperationFooter, OperationNotice, OperationsPage, OperationState } from '../components/OperationsUI'

interface Selectores { propietarios: { id_dueno: string; nombre: string }[]; pacientes: { id_mascota: string; nombre: string; id_dueno: string }[] }
const stateLabels: Record<string, string> = { programada: 'Programada', confirmada: 'Confirmada', en_espera: 'En espera', en_consulta: 'En consulta', completada: 'Completada', cancelada: 'Cancelada', no_asistio: 'No asistió' }
const editableStates = ['programada', 'confirmada', 'en_espera']
const cancelableStates = ['programada', 'confirmada', 'en_espera']

function AppointmentEditor({ cita, initialDate, onClose, onSaved }: { cita: Cita | null; initialDate: string; onClose: () => void; onSaved: (cita: Cita) => void }) {
  const { access, can } = usePermissions()
  const initialLocal = cita ? clinicInputDateTime(cita.fecha_inicio) : `${initialDate}T09:00`
  const [form, setForm] = useState({ owner: cita?.id_dueno || '', patient: cita?.id_mascota || '', doctor: cita?.id_medico || (access.rol === 'medico' ? access.id : ''), date: initialLocal.slice(0, 10), time: initialLocal.slice(11, 16), motivo: cita?.motivo || '', estado: cita?.estado || 'programada' })
  const [selectedServices, setSelectedServices] = useState(cita?.servicios.filter(item => item.estado !== 'cancelado' && item.estado !== 'cancelada').map(item => item.id_servicio) || [])
  const [slot, setSlot] = useState(cita?.fecha_inicio || '')
  const [force, setForce] = useState(false)
  const [ownerQuery, setOwnerQuery] = useState('')
  const [doctorQuery, setDoctorQuery] = useState('')
  const [doctorSpecialty, setDoctorSpecialty] = useState('')
  const [error, setError] = useState('')
  const selectors = useOperationResource<Selectores>('/api/citas/selectores')
  const doctors = useOperationResource<Medico[]>('/api/medicos?activo=true')
  const services = useOperationResource<Servicio[]>('/api/servicios')
  const mutation = useOperationMutation()
  const serviceOptions = (services.data || []).filter(service => service.activo || selectedServices.includes(service.id_servicio))
  const selectedOptions = serviceOptions.filter(service => selectedServices.includes(service.id_servicio))
  const appliedService = (id: string) => cita?.servicios.find(service => service.id_servicio === id && service.estado !== 'cancelado' && service.estado !== 'cancelada')
  const duration = selectedOptions.reduce((sum, service) => sum + (appliedService(service.id_servicio)?.duracion_aplicada ?? service.duracion_minutos), 0)
  const subtotal = selectedOptions.reduce((sum, service) => sum + Number(appliedService(service.id_servicio)?.precio_aplicado ?? service.costo), 0)
  const availabilityParams = new URLSearchParams({ fecha: form.date, servicios: selectedServices.join(','), ...(cita ? { excluir_cita: cita.id_cita } : {}) })
  const availability = useOperationResource<Disponibilidad>(form.doctor && form.date && selectedServices.length > 0 && duration > 0 && duration <= 1440 ? `/api/medicos/${form.doctor}/disponibilidad?${availabilityParams}` : null)
  const availableSlot = availability.data?.slots.find(item => slot && new Date(item.fecha_inicio).getTime() === new Date(slot).getTime())
  const specialtyOptions = [...new Map((doctors.data || []).flatMap(doctor => doctor.especialidades).map(item => [item.id_especialidad, item])).values()]
  const suggestedSpecialties = new Set(selectedOptions.flatMap(service => service.especialidades.map(item => item.id_especialidad)))
  const recommended = (doctor: Medico) => doctor.especialidades.some(item => suggestedSpecialties.has(item.id_especialidad))
  const filteredDoctors = (doctors.data || []).filter(doctor => (doctor.nombre || '').toLocaleLowerCase('es').includes(doctorQuery.toLocaleLowerCase('es')) && (!doctorSpecialty || doctor.especialidades.some(item => item.id_especialidad === doctorSpecialty))).sort((a, b) => Number(recommended(b)) - Number(recommended(a)))
  const selectedDoctor = doctors.data?.find(item => item.id === form.doctor)
  const ownerOptions = selectors.data?.propietarios.filter(owner => owner.id_dueno === form.owner || owner.nombre.toLocaleLowerCase('es').includes(ownerQuery.toLocaleLowerCase('es'))) || []
  const patients = selectors.data?.pacientes.filter(patient => patient.id_dueno === form.owner) || []
  const loading = selectors.loading || doctors.loading || services.loading
  const loadError = selectors.error || doctors.error || services.error

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.owner || !form.patient || !form.doctor || !selectedServices.length || selectedServices.length > 50 || duration > 1440) { setError('Selecciona propietario, paciente, médico y de 1 a 50 servicios con duración total de hasta 1440 minutos.'); return }
    let start: string
    try {
      if (force && can('citas.forzar_horario')) start = clinicLocalToISO(`${form.date}T${form.time}`)
      else if (availableSlot && !availability.loading && !availability.error) start = availableSlot.fecha_inicio
      else throw new Error('Selecciona un horario disponible actualizado.')
    } catch (cause) { setError(operationError(cause)); return }
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try {
      const result = await apiFetch<{ cita: Cita }>(cita ? `/api/citas/${cita.id_cita}` : '/api/citas', { method: cita ? 'PUT' : 'POST', signal: controller.signal, body: JSON.stringify({ id_dueno: form.owner, id_mascota: form.patient, id_medico: form.doctor, fecha_inicio: start, motivo: form.motivo.trim() || null, servicios: selectedServices, forzar_horario: force && can('citas.forzar_horario'), estado: cita ? form.estado : 'programada' }) })
      if (!controller.signal.aborted) onSaved(result.cita)
    } catch (cause) { if (!controller.signal.aborted) { setError(operationError(cause)); availability.reload() } }
    finally { mutation.finish(controller) }
  }

  return <OperationDialog title={cita ? 'Editar cita' : 'Nueva cita'} onClose={onClose} pending={mutation.pending} wide><form onSubmit={save}><div className="users-dialog-body"><OperationState loading={loading} error={loadError} empty={false}>
    <fieldset className="users-fields" disabled={mutation.pending || loading || Boolean(loadError)}>
      <div className="users-form-grid">
        <div className="users-field"><label htmlFor="appointment-owner-search">Buscar propietario</label><input id="appointment-owner-search" data-initial-focus type="search" placeholder="Nombre del propietario" value={ownerQuery} onChange={event => setOwnerQuery(event.target.value)} /></div>
        <div className="users-field"><label htmlFor="appointment-owner">Propietario *</label><select id="appointment-owner" value={form.owner} onChange={event => setForm(previous => ({ ...previous, owner: event.target.value, patient: '' }))} required><option value="">Selecciona propietario</option>{ownerOptions.map(owner => <option key={owner.id_dueno} value={owner.id_dueno}>{owner.nombre}</option>)}</select></div>
        <div className="users-field"><label htmlFor="appointment-patient">Paciente *</label><select id="appointment-patient" value={form.patient} disabled={!form.owner} onChange={event => setForm(previous => ({ ...previous, patient: event.target.value }))} required><option value="">{form.owner ? 'Selecciona paciente' : 'Selecciona primero al propietario'}</option>{patients.map(patient => <option key={patient.id_mascota} value={patient.id_mascota}>{patient.nombre}</option>)}</select></div>
        {cita && <div className="users-field"><label htmlFor="appointment-state">Estado</label><select id="appointment-state" value={form.estado} onChange={event => setForm(previous => ({ ...previous, estado: event.target.value }))}>{({ programada: ['programada', 'confirmada', 'no_asistio'], confirmada: ['confirmada', 'en_espera', 'no_asistio'], en_espera: ['en_espera', 'no_asistio'] }[cita.estado] || [cita.estado]).map(value => <option key={value} value={value}>{stateLabels[value]}</option>)}</select></div>}
        <div className="users-field operations-wide-field"><label htmlFor="appointment-reason">Motivo</label><textarea id="appointment-reason" value={form.motivo} rows={2} maxLength={2000} onChange={event => setForm(previous => ({ ...previous, motivo: event.target.value }))} /></div>
      </div>
      <section className="operations-form-section" aria-labelledby="appointment-services-title"><h4 id="appointment-services-title">Servicios *</h4><p className="users-help">Selecciona uno o varios servicios. Sus especialidades sólo ayudan a sugerir médicos.</p>{serviceOptions.length === 0 && <p className="users-help">No hay servicios activos. Solicita al administrador que registre uno.</p>}{serviceOptions.map(service => <div className="operations-service-option" key={service.id_servicio}><label><input type="checkbox" checked={selectedServices.includes(service.id_servicio)} disabled={!service.activo && !selectedServices.includes(service.id_servicio)} onChange={event => { setSelectedServices(previous => event.target.checked ? [...previous, service.id_servicio] : previous.filter(id => id !== service.id_servicio)); setSlot('') }} /><span>{service.nombre}{!service.activo ? ' (inactivo)' : ''}<small className="users-help"> · {formatDuration(appliedService(service.id_servicio)?.duracion_aplicada ?? service.duracion_minutos)}</small></span></label><strong>{money(appliedService(service.id_servicio)?.precio_aplicado ?? service.costo)}</strong></div>)}<div className="operations-subtotal"><span>Subtotal estimado · {formatDuration(duration)}</span><strong>{money(subtotal)}</strong></div></section>
      <section className="operations-form-section" aria-labelledby="appointment-doctor-title"><h4 id="appointment-doctor-title">Médico y disponibilidad</h4><div className="users-form-grid"><div className="users-field"><label htmlFor="appointment-doctor-search">Buscar médico por nombre</label><input id="appointment-doctor-search" type="search" value={doctorQuery} onChange={event => setDoctorQuery(event.target.value)} /></div><div className="users-field"><label htmlFor="appointment-specialty">Filtrar por especialidad</label><select id="appointment-specialty" value={doctorSpecialty} onChange={event => setDoctorSpecialty(event.target.value)}><option value="">Todas las especialidades</option>{specialtyOptions.map(item => <option key={item.id_especialidad} value={item.id_especialidad}>{item.nombre}</option>)}</select></div></div><button type="button" className="users-link-button" onClick={() => { setDoctorQuery(''); setDoctorSpecialty('') }}>Ver todos los médicos</button><p className="users-help">Puedes elegir cualquier médico disponible, aunque no tenga la especialidad sugerida.</p><div className="users-form-grid"><div className="users-field"><label htmlFor="appointment-doctor">Médico *</label><select id="appointment-doctor" value={form.doctor} disabled={!can('citas.asignar_medico')} onChange={event => { setForm(previous => ({ ...previous, doctor: event.target.value })); setSlot('') }} required><option value="">Selecciona médico</option>{form.doctor && !filteredDoctors.some(doctor => doctor.id === form.doctor) && <option value={form.doctor}>{selectedDoctor?.nombre || cita?.medico || 'Médico asignado'} (seleccionado)</option>}{filteredDoctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.nombre || 'Médico sin nombre'}{recommended(doctor) ? ' · Sugerido' : ''}</option>)}</select>{!can('citas.asignar_medico') && <small>No tienes permiso para reasignar el médico.</small>}</div><div className="users-field"><label htmlFor="appointment-date">Fecha (Tijuana)</label><input id="appointment-date" type="date" value={form.date} onChange={event => { setForm(previous => ({ ...previous, date: event.target.value })); setSlot('') }} required /></div></div>
      {!selectedServices.length && <p className="users-help">Selecciona servicios para consultar la duración y los horarios disponibles.</p>}{form.doctor && selectedServices.length > 0 && <OperationState loading={availability.loading} error={availability.error} empty={Boolean(availability.data && !availability.data.slots.length)}>{availability.data && !availability.data.slots.length && <p role="status">{availability.data.bloque_maximo_minutos !== undefined && duration > availability.data.bloque_maximo_minutos ? `La duración solicitada (${formatDuration(duration)}) no cabe en los bloques de este día (máximo ${formatDuration(availability.data.bloque_maximo_minutos)}). Revisa los servicios o el horario del médico.` : 'No hay horarios libres para esta duración. Revisa la fecha, el horario semanal, los bloqueos o las citas existentes.'}</p>}<div className="operations-slots" role="group" aria-label="Horarios disponibles">{availability.data?.slots.map(item => <button type="button" className={`operations-slot ${availableSlot?.fecha_inicio === item.fecha_inicio ? 'selected' : ''}`} aria-pressed={availableSlot?.fecha_inicio === item.fecha_inicio} key={item.fecha_inicio} onClick={() => { setSlot(item.fecha_inicio); setForce(false) }}>{clinicInputDateTime(item.fecha_inicio).slice(11, 16)}–{clinicInputDateTime(item.fecha_fin).slice(11, 16)}</button>)}</div><button type="button" className="users-link-button" disabled={availability.loading} onClick={availability.reload}>Actualizar disponibilidad</button></OperationState>}
      {can('citas.forzar_horario') && <div className="operations-form-section"><label className="users-help"><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} /> Usar una hora fuera del horario semanal</label>{force && <div className="users-field"><label htmlFor="appointment-force-time">Hora (Tijuana)</label><input id="appointment-force-time" type="time" value={form.time} onChange={event => setForm(previous => ({ ...previous, time: event.target.value }))} required /><small>Esta autorización no permite citas solapadas ni horarios bloqueados por ausencia.</small></div>}</div>}
      </section>
    </fieldset></OperationState>{error && <OperationNotice error>{error}</OperationNotice>}{duration > 1440 && <OperationNotice error>La suma de servicios supera 24 h. Reduce los servicios seleccionados.</OperationNotice>}<p className="operations-timezone">Fechas y horas de la clínica: Tijuana. Los precios aplicados se conservan en el historial de la cita.</p></div><OperationFooter pending={mutation.pending} onClose={onClose} label={cita ? 'Guardar cita' : 'Crear cita'} disabled={loading || Boolean(loadError) || !form.patient || !form.owner || !form.doctor || !selectedServices.length || selectedServices.length > 50 || duration > 1440 || (!force && (!availableSlot || availability.loading || Boolean(availability.error)))} /></form></OperationDialog>
}

function CancelAppointment({ cita, onClose, onSaved }: { cita: Cita; onClose: () => void; onSaved: () => void }) {
  const mutation = useOperationMutation()
  const [error, setError] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try { await apiFetch(`/api/citas/${cita.id_cita}/cancelar`, { method: 'PATCH', signal: controller.signal }); if (!controller.signal.aborted) onSaved() }
    catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) }
    finally { mutation.finish(controller) }
  }
  return <OperationDialog title="Cancelar cita" onClose={onClose} pending={mutation.pending}><form onSubmit={save}><div className="users-dialog-body"><p>¿Deseas cancelar la cita de <strong>{cita.paciente || 'este paciente'}</strong> del {clinicDateTime(cita.fecha_inicio)}?</p><p className="users-help">Se conservará su registro y se liberará el horario del médico.</p>{error && <OperationNotice error>{error}</OperationNotice>}</div><OperationFooter pending={mutation.pending} onClose={onClose} label="Confirmar cancelación" /></form></OperationDialog>
}

function Citas() {
  const { access, can } = usePermissions()
  const [date, setDate] = useState(clinicToday())
  const [doctor, setDoctor] = useState('')
  const [state, setState] = useState('')
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<{ cita: Cita | null } | null>(null)
  const [cancel, setCancel] = useState<Cita | null>(null)
  const [notice, setNotice] = useState('')
  const range = date ? clinicDayRange(date) : null
  const params = new URLSearchParams({ ...(range || {}), ...(doctor ? { medico: doctor } : {}), ...(state ? { estado: state } : {}) })
  const resource = useOperationResource<Cita[]>(can('citas.ver') && range ? `/api/citas?${params}` : null)
  const doctors = useOperationResource<Medico[]>(can('medicos.ver') ? '/api/medicos' : null)
  const filtered = (resource.data || []).filter(cita => `${cita.paciente || ''} ${cita.propietario || ''} ${cita.medico || ''} ${cita.motivo || ''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')))
  const saved = (message: string, cita?: Cita) => { if (cita) setDate(clinicInputDateTime(cita.fecha_inicio).slice(0, 10)); setEditor(null); setCancel(null); setNotice(message); resource.reload() }
  if (!can('citas.ver')) return <OperationNotice error>403 · No tienes permiso para consultar citas.</OperationNotice>
  return <OperationsPage title="Citas" description="Agenda pacientes, revisa disponibilidad y conserva los servicios y precios de cada cita." actions={<>{can('citas.crear') && <button type="button" className="primary-button" onClick={() => setEditor({ cita: null })}>+ Nueva cita</button>}<button type="button" className="users-secondary-button" onClick={resource.reload} disabled={resource.loading}>Recargar</button></>}>
    {notice && <OperationNotice>{notice}</OperationNotice>}<div className="users-card"><div className="operations-toolbar"><div className="users-field"><label htmlFor="appointments-date">Fecha</label><input id="appointments-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></div><div className="users-field"><label htmlFor="appointments-doctor">Médico</label><select id="appointments-doctor" value={doctor} onChange={event => setDoctor(event.target.value)}><option value="">Todos los médicos</option>{doctors.data?.map(item => <option value={item.id} key={item.id}>{item.nombre || 'Médico sin nombre'}</option>)}</select></div><div className="users-field"><label htmlFor="appointments-state">Estado</label><select id="appointments-state" value={state} onChange={event => setState(event.target.value)}><option value="">Todos los estados</option>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="users-field"><label htmlFor="appointments-search">Buscar</label><input id="appointments-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Paciente, propietario o médico" /></div></div><OperationState loading={resource.loading} error={resource.error} empty={filtered.length === 0}>{filtered.length > 0 && <div className="users-table-scroll"><table className="users-table"><thead><tr><th>Fecha y hora</th><th>Paciente / Propietario</th><th>Médico</th><th>Servicios</th><th>Subtotal</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filtered.map(cita => <tr key={cita.id_cita}><td>{clinicDateTime(cita.fecha_inicio)}<br /><small>hasta {clinicInputDateTime(cita.fecha_fin).slice(11, 16)}</small></td><th scope="row">{cita.paciente || 'Sin paciente'}<br /><small>{cita.propietario || 'Sin propietario'}</small></th><td>{cita.medico || 'Sin asignar'}</td><td>{cita.servicios.map(service => `${service.nombre} · ${money(service.precio_aplicado)}`).join(', ') || 'Sin servicios'}</td><td>{money(cita.subtotal)}</td><td><span className={`operations-status ${cita.estado}`}>{stateLabels[cita.estado] || cita.estado}</span></td><td><div className="operations-table-actions">{can('consultas.crear') && ['admin', 'medico'].includes(access.rol) && cita.id_medico && ['programada', 'confirmada', 'en_espera', 'en_consulta'].includes(cita.estado) && (cita.id_medico === access.id || can('consultas.tomar_ajenas')) && <button type="button" onClick={() => { window.location.hash = `/clinica?cita=${cita.id_cita}` }}>Atender</button>}{can('citas.editar') && editableStates.includes(cita.estado) && <button type="button" onClick={() => setEditor({ cita })}>Editar</button>}{can('citas.cancelar') && cancelableStates.includes(cita.estado) && <button type="button" className="danger" onClick={() => setCancel(cita)}>Cancelar cita</button>}</div></td></tr>)}</tbody></table></div>}</OperationState></div><p className="operations-timezone">Horarios de Tijuana. El subtotal es una estimación; no representa un pago.</p>
    {editor && <AppointmentEditor cita={editor.cita} initialDate={date} onClose={() => setEditor(null)} onSaved={cita => saved(editor.cita ? 'Cita actualizada.' : 'Cita creada.', cita)} />}{cancel && <CancelAppointment cita={cancel} onClose={() => setCancel(null)} onSaved={() => saved('Cita cancelada.')} />}
  </OperationsPage>
}
export default Citas
