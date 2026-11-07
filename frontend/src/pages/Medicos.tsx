import { StatusBadge } from '../components/StatusBadge'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { apiFetch } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import { clinicDateTime, clinicDayRange, clinicLocalToISO, clinicToday, operationError, useOperationMutation, useOperationResource, weekdays } from '../lib/operations'
import type { Bloqueo, Cita, Especialidad, Horario, Medico } from '../lib/operations'
import { OperationDialog, OperationFooter, OperationNotice, OperationsPage, OperationState } from '../components/OperationsUI'

export function ScheduleDialog({ medico, onClose, onSaved, inline = false }: { medico: Medico; onClose: () => void; onSaved: () => void; inline?: boolean }) {
  const { can } = usePermissions()
  const resource = useOperationResource<Horario[]>(`/api/medicos/${medico.id}/horarios`)
  const [draft, setDraft] = useState<Horario[] | null>(null)
  const [error, setError] = useState('')
  const mutation = useOperationMutation()
  const editable = can('horarios.administrar')
  const blocks = draft ?? resource.data ?? []
  const update = (index: number, key: keyof Horario, value: string | boolean) => setDraft(blocks.map((block, position) => position === index ? { ...block, [key]: value } : block))
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = blocks.map(block => ({ ...block, hora_inicio: block.hora_inicio.slice(0, 5), hora_fin: block.hora_fin.slice(0, 5) }))
    for (let day = 0; day <= 6; day++) {
      const active = normalized.filter(block => block.dia_semana === day && block.activo).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
      if (normalized.some(block => block.hora_inicio >= block.hora_fin) || active.some((block, index) => index > 0 && active[index - 1].hora_fin > block.hora_inicio)) { setError('Revisa las horas: el inicio debe ser anterior al fin y los bloques activos no pueden solaparse.'); return }
    }
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try {
      await apiFetch(`/api/medicos/${medico.id}/horarios`, { method: 'PUT', signal: controller.signal, body: JSON.stringify({ bloques: blocks.map(block => ({ dia_semana: block.dia_semana, hora_inicio: block.hora_inicio.slice(0, 5), hora_fin: block.hora_fin.slice(0, 5), activo: block.activo })) }) })
      if (!controller.signal.aborted) onSaved()
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) }
    finally { mutation.finish(controller) }
  }
  const content = <form onSubmit={save}><OperationState loading={resource.loading} error={resource.error} empty={false}>{resource.data && <fieldset className="users-fields" disabled={mutation.pending}><div className="operations-week">{[1, 2, 3, 4, 5, 6, 0].map(day => <section className="operations-day" key={day}><h4>{weekdays[day]}</h4>{blocks.filter(block => block.dia_semana === day).length === 0 && <p className="users-help">No disponible</p>}{blocks.map((block, index) => block.dia_semana === day && <div className="operations-schedule-row" key={index}><input type="time" aria-label={`Inicio ${weekdays[day]} bloque ${index + 1}`} value={block.hora_inicio.slice(0, 5)} readOnly={!editable} onChange={event => update(index, 'hora_inicio', event.target.value)} required /><span>–</span><input type="time" aria-label={`Fin ${weekdays[day]} bloque ${index + 1}`} value={block.hora_fin.slice(0, 5)} readOnly={!editable} onChange={event => update(index, 'hora_fin', event.target.value)} required />{editable && <><label className="users-help"><input type="checkbox" checked={block.activo} onChange={event => update(index, 'activo', event.target.checked)} /> Activo</label><button type="button" className="users-link-button" onClick={() => setDraft(blocks.filter((_, position) => position !== index))}>Quitar</button></>}</div>)}{editable && <button type="button" className="users-link-button" onClick={() => setDraft([...blocks, { dia_semana: day, hora_inicio: '09:00', hora_fin: '13:00', activo: true }])}>+ Agregar bloque</button>}</section>)}</div></fieldset>}</OperationState>{error && <div className="users-dialog-body"><OperationNotice error>{error}</OperationNotice></div>}<p className="operations-timezone users-dialog-body">Horario local de Tijuana. Puedes guardar varios bloques por día.</p>{editable ? <OperationFooter pending={mutation.pending} onClose={onClose} disabled={resource.loading || Boolean(resource.error)} /> : <div className="users-dialog-footer"><button type="button" className="users-secondary-button" onClick={onClose}>Cerrar</button></div>}</form>
  return inline ? <section className="users-card clinical-card"><h4>Horario de {medico.nombre}</h4>{content}</section> : <OperationDialog title={`Horario de ${medico.nombre}`} pending={mutation.pending} onClose={onClose} wide>{content}</OperationDialog>
}

export function BlocksDialog({ medico, onClose }: { medico: Medico; onClose: () => void }) {
  const { can } = usePermissions()
  const resource = useOperationResource<Bloqueo[]>(`/api/medicos/${medico.id}/bloqueos`)
  const mutation = useOperationMutation()
  const [form, setForm] = useState({ inicio: `${clinicToday()}T09:00`, fin: `${clinicToday()}T10:00`, tipo: 'manual', motivo: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const write = async (event: FormEvent, remove?: string) => {
    event.preventDefault()
    let body: Record<string, string> | undefined
    try {
      if (!remove) {
        const inicio = clinicLocalToISO(form.inicio), fin = clinicLocalToISO(form.fin)
        if (inicio >= fin) throw new Error('El final del bloqueo debe ser posterior al inicio.')
        body = { fecha_inicio: inicio, fecha_fin: fin, tipo: form.tipo, motivo: form.motivo.trim() }
      }
    } catch (cause) { setError(operationError(cause)); return }
    const controller = mutation.start()
    if (!controller) return
    setError(''); setNotice('')
    try {
      await apiFetch(`/api/medicos/${medico.id}/bloqueos${remove ? `/${remove}` : ''}`, { method: remove ? 'DELETE' : 'POST', signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) })
      if (!controller.signal.aborted) { setNotice(remove ? 'Bloqueo eliminado.' : 'Bloqueo creado.'); setRemoving(null); resource.reload() }
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) }
    finally { mutation.finish(controller) }
  }
  return <OperationDialog title={`Bloqueos de ${medico.nombre || 'médico'}`} pending={mutation.pending} onClose={onClose} wide><div className="users-dialog-body">{notice && <OperationNotice>{notice}</OperationNotice>}{error && <OperationNotice error>{error}</OperationNotice>}<OperationState loading={resource.loading} error={resource.error} empty={!resource.data?.length}>{resource.data?.map(block => <div className="operations-service-option" key={block.id_bloqueo}><div><strong>{{manual:'Bloqueo manual',vacaciones:'Vacaciones',comida:'Comida',cirugia:'Cirugía',ausencia:'Ausencia'}[block.tipo] || 'Bloqueo'}</strong><p className="operations-summary">{clinicDateTime(block.fecha_inicio)} – {clinicDateTime(block.fecha_fin)}<br />{block.motivo}</p></div>{can('horarios.administrar') && <div>{removing === block.id_bloqueo ? <form onSubmit={event => void write(event, block.id_bloqueo)}><span className="users-help">¿Eliminar bloqueo? </span><button type="submit" className="users-link-button" disabled={mutation.pending || resource.loading}>Confirmar</button><button type="button" className="users-link-button" disabled={mutation.pending} onClick={() => setRemoving(null)}>Cancelar</button></form> : <button type="button" className="users-link-button" disabled={mutation.pending || resource.loading} onClick={() => setRemoving(block.id_bloqueo)}>Eliminar</button>}</div>}</div>)}</OperationState></div>{can('horarios.administrar') && <form className="operations-inline-form" onSubmit={event => void write(event)}><h4>Nuevo bloqueo</h4><fieldset className="users-fields" disabled={mutation.pending}><div className="users-form-grid"><div className="users-field"><label htmlFor="block-start">Inicio (Tijuana)</label><input id="block-start" type="datetime-local" value={form.inicio} onChange={event => setForm(previous => ({ ...previous, inicio: event.target.value }))} required /></div><div className="users-field"><label htmlFor="block-end">Fin (Tijuana)</label><input id="block-end" type="datetime-local" value={form.fin} onChange={event => setForm(previous => ({ ...previous, fin: event.target.value }))} required /></div><div className="users-field"><label htmlFor="block-type">Tipo</label><select id="block-type" value={form.tipo} onChange={event => setForm(previous => ({ ...previous, tipo: event.target.value }))}>{[['manual', 'Bloqueo manual'], ['vacaciones', 'Vacaciones'], ['comida', 'Comida'], ['cirugia', 'Cirugía'], ['ausencia', 'Ausencia']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="users-field"><label htmlFor="block-reason">Motivo</label><input id="block-reason" maxLength={2000} value={form.motivo} onChange={event => setForm(previous => ({ ...previous, motivo: event.target.value }))} /></div></div><button type="submit" className="primary-button" disabled={mutation.pending}>{mutation.pending ? 'Guardando…' : 'Agregar bloqueo'}</button></fieldset></form>}<div className="users-dialog-footer"><button type="button" className="users-secondary-button" onClick={onClose} disabled={mutation.pending}>Cerrar</button></div></OperationDialog>
}

function AgendaDialog({ medico, onClose }: { medico: Medico; onClose: () => void }) {
  const [date, setDate] = useState(clinicToday())
  const range = date ? clinicDayRange(date) : null
  const params = new URLSearchParams({ medico: medico.id, ...(range || {}) })
  const resource = useOperationResource<Cita[]>(range ? `/api/citas?${params}` : null)
  return <OperationDialog title={`Agenda de ${medico.nombre || 'médico'}`} onClose={onClose} wide><div className="users-dialog-body"><div className="users-field"><label htmlFor="agenda-date">Fecha</label><input id="agenda-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></div><OperationState loading={resource.loading} error={resource.error} empty={!resource.data?.length}>{resource.data?.map(cita => <div key={cita.id_cita} className="operations-service-option"><div><strong>{cita.paciente || 'Paciente'}</strong><p className="operations-summary">{clinicDateTime(cita.fecha_inicio)} – {clinicDateTime(cita.fecha_fin)}<br />{cita.motivo || 'Sin motivo registrado'}</p></div><span className={`operations-status ${cita.estado}`}>{cita.estado.replaceAll('_', ' ')}</span></div>)}</OperationState></div><div className="users-dialog-footer"><button type="button" className="users-secondary-button" onClick={onClose}>Cerrar</button></div></OperationDialog>
}

function SpecialtiesDialog({ onClose }: { onClose: () => void }) {
  const resource = useOperationResource<Especialidad[]>('/api/especialidades')
  const [editor, setEditor] = useState<{ id: string | null; nombre: string; descripcion: string }>({ id: null, nombre: '', descripcion: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mutation = useOperationMutation()
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try { await apiFetch(`/api/especialidades${editor.id ? `/${editor.id}` : ''}`, { method: editor.id ? 'PUT' : 'POST', signal: controller.signal, body: JSON.stringify({ nombre: editor.nombre.trim(), descripcion: editor.descripcion.trim() || null }) }); if (!controller.signal.aborted) { setNotice('Especialidad guardada.'); setEditor({ id: null, nombre: '', descripcion: '' }); resource.reload() } }
    catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) }
    finally { mutation.finish(controller) }
  }
  return <OperationDialog title="Especialidades de la clínica" pending={mutation.pending} onClose={onClose} wide><div className="users-dialog-body">{notice && <OperationNotice>{notice}</OperationNotice>}<OperationState loading={resource.loading} error={resource.error} empty={!resource.data?.length}>{resource.data?.map(item => <div className="operations-service-option" key={item.id_especialidad}><div><strong>{item.nombre}</strong><p className="operations-summary">{item.descripcion}</p></div><button type="button" className="users-link-button" disabled={mutation.pending} onClick={() => setEditor({ id: item.id_especialidad, nombre: item.nombre, descripcion: item.descripcion || '' })}>Editar</button></div>)}</OperationState><form className="operations-form-section" onSubmit={save}><h4>{editor.id ? 'Editar especialidad' : 'Nueva especialidad'}</h4><fieldset className="users-fields" disabled={mutation.pending}><div className="users-form-grid"><div className="users-field"><label htmlFor="medical-specialty-name">Nombre *</label><input id="medical-specialty-name" value={editor.nombre} maxLength={100} onChange={event => setEditor(previous => ({ ...previous, nombre: event.target.value }))} required /></div><div className="users-field"><label htmlFor="medical-specialty-description">Descripción</label><textarea id="medical-specialty-description" rows={2} maxLength={2000} value={editor.descripcion} onChange={event => setEditor(previous => ({ ...previous, descripcion: event.target.value }))} /></div></div>{error && <OperationNotice error>{error}</OperationNotice>}<div className="operations-actions"><button type="submit" className="primary-button" disabled={mutation.pending || !editor.nombre.trim()}>Guardar especialidad</button>{editor.id && <button type="button" className="users-secondary-button" onClick={() => setEditor({ id: null, nombre: '', descripcion: '' })}>Nueva especialidad</button>}</div></fieldset></form></div><div className="users-dialog-footer"><button type="button" className="users-secondary-button" onClick={onClose} disabled={mutation.pending}>Cerrar</button></div></OperationDialog>
}

function Medicos() {
  const { can } = usePermissions()
  const [query, setQuery] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [panel, setPanel] = useState<{ type: 'schedule' | 'blocks' | 'agenda'; medico: Medico } | null>(null)
  const [specialtiesOpen, setSpecialtiesOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const params = new URLSearchParams({ ...(query ? { q: query } : {}), ...(specialty ? { especialidad: specialty } : {}) })
  const resource = useOperationResource<Medico[]>(can('medicos.ver') ? `/api/medicos?${params}` : null)
  const specialties = useOperationResource<Especialidad[]>(can('medicos.ver') ? '/api/especialidades' : null)
  if (!can('medicos.ver')) return <OperationNotice error>403 · No tienes permiso para consultar médicos.</OperationNotice>
  return <OperationsPage title="Médicos" section="Administración / Médicos" description="Consulta especialidades, horarios, ausencias y agenda de los médicos de tu clínica." actions={<>{can('medicos.administrar') && <button type="button" className="primary-button" onClick={() => setSpecialtiesOpen(true)}>Especialidades</button>}<button type="button" className="users-secondary-button" disabled={resource.loading} onClick={resource.reload}>Recargar</button></>}>
    {notice && <OperationNotice>{notice}</OperationNotice>}<div className="users-card"><div className="operations-toolbar"><div className="users-field"><label htmlFor="medical-search">Buscar médico</label><input id="medical-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre" /></div><div className="users-field"><label htmlFor="medical-specialty">Especialidad</label><select id="medical-specialty" value={specialty} onChange={event => setSpecialty(event.target.value)}><option value="">Todas las especialidades</option>{specialties.data?.map(item => <option key={item.id_especialidad} value={item.id_especialidad}>{item.nombre}</option>)}</select></div><button type="button" className="users-secondary-button" onClick={() => { setQuery(''); setSpecialty('') }}>Ver todos los médicos</button></div>{specialties.error && <OperationNotice error>{specialties.error}</OperationNotice>}<OperationState loading={resource.loading} error={resource.error} empty={!resource.data?.length}>{resource.data && resource.data.length > 0 && <div className="users-table-scroll"><table className="users-table"><thead><tr><th>Nombre</th><th>Especialidades</th><th>Cédula</th><th>Estado</th><th>Horario de hoy</th><th>Próxima cita</th><th>Acciones</th></tr></thead><tbody>{resource.data.map(medico => <tr key={medico.id}><th scope="row">{medico.nombre || 'Médico sin nombre'}</th><td>{medico.especialidades.map(item => item.nombre).join(', ') || 'Sin especialidades'}</td><td>{medico.cedula_profesional || 'Sin registrar'}</td><td><StatusBadge value={medico.activo ? 'activo' : 'inactivo'} /></td><td>{!can('horarios.ver') ? 'Sin permiso' : medico.horario_hoy.filter(block => block.activo).map(block => `${block.hora_inicio.slice(0, 5)}–${block.hora_fin.slice(0, 5)}`).join(', ') || 'No disponible'}</td><td>{!can('citas.ver') ? 'Sin permiso' : medico.proxima_cita ? clinicDateTime(medico.proxima_cita.fecha_inicio) : 'Sin próximas citas'}</td><td><div className="operations-table-actions">{can('horarios.ver') && <><button type="button" onClick={() => setPanel({ type: 'schedule', medico })}>{can('horarios.administrar') ? 'Editar horario' : 'Ver horario'}</button><button type="button" onClick={() => setPanel({ type: 'blocks', medico })}>Bloqueos</button></>}{can('citas.ver') && <button type="button" onClick={() => setPanel({ type: 'agenda', medico })}>Ver agenda</button>}</div></td></tr>)}</tbody></table></div>}</OperationState></div>
    {panel?.type === 'schedule' && <ScheduleDialog medico={panel.medico} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); setNotice('Horario guardado.'); resource.reload() }} />}{panel?.type === 'blocks' && <BlocksDialog medico={panel.medico} onClose={() => { setPanel(null); resource.reload() }} />}{panel?.type === 'agenda' && <AgendaDialog medico={panel.medico} onClose={() => setPanel(null)} />}{specialtiesOpen && <SpecialtiesDialog onClose={() => { setSpecialtiesOpen(false); specialties.reload(); resource.reload() }} />}
  </OperationsPage>
}
export default Medicos
