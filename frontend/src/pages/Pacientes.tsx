import { SearchableSelect } from '../components/SearchableSelect'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { apiFetch } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import './Duenos.css'
import './Pacientes.css'

interface Propietario { id_dueno: string; nombre: string }
interface Paciente {
  id_mascota: string
  nombre: string
  id_dueno: string
  especie: string | null
  raza: string | null
  sexo: string | null
  fecha_nacimiento: string | null
  peso_actual: number | null
  observaciones: string | null
  propietario: Propietario | null
}
const emptyForm = { nombre: '', id_dueno: '', especie: '', raza: '', sexo: '', fecha_nacimiento: '', peso_actual: '', observaciones: '' }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tijuana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const errorMessage = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback

function Pacientes() {
  const { access, can } = usePermissions()
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [propietarios, setPropietarios] = useState<Propietario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ownersError, setOwnersError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [editor, setEditor] = useState<{ paciente: Paciente | null } | null>(null)
  const [eliminando, setEliminando] = useState<Paciente | null>(null)
  const [pending, setPending] = useState(false)
  const [modalError, setModalError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [viewOnly,setViewOnly]=useState(false)
  const [requested]=useState(()=>new URLSearchParams(location.hash.split('?')[1]||''))
  const requestedHandled=useRef(false)
  const focusReturn = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const modalOpen = Boolean(editor || eliminando)

  useEffect(() => {
    const controller = new AbortController()
    apiFetch<Paciente[]>('/api/pacientes', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPacientes(data) })
      .catch(() => { if (!controller.signal.aborted) setError('No se pudieron cargar los pacientes.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    apiFetch<Propietario[]>('/api/pacientes/propietarios', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPropietarios(data) })
      .catch(() => { if (!controller.signal.aborted) setOwnersError('No se pudieron cargar los propietarios. Recarga la página para registrar o editar pacientes.') })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!modalOpen) return
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => focusReturn.current?.focus()
  }, [modalOpen])

  const closeModal = () => {
    if (pending) return
    setEditor(null)
    setEliminando(null)
    setModalError('')
  }
  const dialogKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); closeModal() }
    if (event.key !== 'Tab') return
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const openEditor = useCallback((paciente: Paciente | null, readonly = false) => {
    if (!can(readonly ? 'pacientes.ver' : paciente ? 'pacientes.editar' : 'pacientes.crear')) return
    setViewOnly(readonly)
    focusReturn.current = document.activeElement as HTMLElement
    setModalError('')
    setForm(paciente ? {
      nombre: paciente.nombre, id_dueno: paciente.id_dueno,
      especie: paciente.especie ?? '', raza: paciente.raza ?? '', sexo: paciente.sexo ?? '',
      fecha_nacimiento: paciente.fecha_nacimiento ?? '', peso_actual: paciente.peso_actual == null ? '' : String(paciente.peso_actual),
      observaciones: paciente.observaciones ?? '',
    } : emptyForm)
    setEditor({ paciente })
  },[can])
  useEffect(()=>{
    if(loading||requestedHandled.current||!requested.get('paciente'))return
    const patient=pacientes.find(p=>p.id_mascota===requested.get('paciente'))
    const frame=requestAnimationFrame(()=>{requestedHandled.current=true;if(patient)openEditor(patient,requested.get('editar')!=='1'||!can('pacientes.editar'))})
    return()=>cancelAnimationFrame(frame)
  },[loading,pacientes,requested,openEditor,can])
  const refresh = async () => {
    try {
      setPacientes(await apiFetch<Paciente[]>('/api/pacientes'))
      setError('')
    } catch { setError('La operación terminó, pero no se pudo actualizar la lista. Recarga la página.') }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor || pending || viewOnly) return
    if (!can(editor.paciente ? 'pacientes.editar' : 'pacientes.crear')) return
    if (!form.nombre.trim() || !form.id_dueno) { setModalError('Completa el nombre y selecciona un propietario.'); return }
    if (form.fecha_nacimiento && form.fecha_nacimiento > today()) { setModalError('La fecha de nacimiento no puede ser futura.'); return }
    setPending(true)
    setModalError('')
    try {
      await apiFetch(editor.paciente ? `/api/pacientes/${editor.paciente.id_mascota}` : '/api/pacientes', {
        method: editor.paciente ? 'PUT' : 'POST',
        body: JSON.stringify({ ...form, nombre: form.nombre.trim(), fecha_nacimiento: form.fecha_nacimiento || null,
          peso_actual: form.peso_actual === '' ? null : Number(form.peso_actual) }),
      })
      setEditor(null)
      await refresh()
    } catch (cause) { setModalError(errorMessage(cause, 'No se pudo guardar el paciente.')) }
    finally { setPending(false) }
  }
  const remove = async () => {
    if (!eliminando || pending || !can('pacientes.eliminar')) return
    setPending(true)
    setModalError('')
    try {
      await apiFetch(`/api/pacientes/${eliminando.id_mascota}`, { method: 'DELETE' })
      setEliminando(null)
      await refresh()
    } catch (cause) { setModalError(errorMessage(cause, 'No se pudo eliminar el paciente.')) }
    finally { setPending(false) }
  }
  const query = busqueda.trim().toLocaleLowerCase('es')
  const filtered = pacientes.filter(paciente => [paciente.nombre, paciente.especie, paciente.raza, paciente.sexo, paciente.propietario?.nombre]
    .some(value => value?.toLocaleLowerCase('es').includes(query)))
  const field = (name: keyof typeof emptyForm, value: string) => setForm(previous => ({ ...previous, [name]: value }))

  return (
    <div className="duenos-page pacientes-page">
      <div className="duenos-header">
        <div><span className="eyebrow">Clínica / Pacientes</span><h3>Pacientes</h3><p>Administra los datos básicos de los pacientes de tu clínica.</p></div>
        {can('pacientes.crear') && <button className="primary-button" type="button" disabled={loading || !propietarios.length || Boolean(ownersError)} onClick={() => openEditor(null)}>+ Nuevo paciente</button>}
      </div>
      {ownersError && <p className="pacientes-alert" role="alert">{ownersError}</p>}
      {can('pacientes.crear') && !loading && !ownersError && !propietarios.length && <p className="pacientes-alert">Solicita que se registre un propietario antes de agregar un paciente.</p>}
      <div className="duenos-card" aria-busy={loading}>
        <div className="duenos-card-header">
          <div><strong>Pacientes registrados</strong><span>{loading ? 'Cargando…' : `${pacientes.length} registros · ${filtered.length} en la búsqueda`}</span></div>
          <label className="pacientes-search">Buscar pacientes<input className="duenos-search" type="search" placeholder="Nombre, especie o propietario" value={busqueda} onChange={event => setBusqueda(event.target.value)} /></label>
        </div>
        {loading ? <p className="duenos-message" role="status">Cargando pacientes…</p>
          : error ? <p className="duenos-message error" role="alert">{error}</p>
          : !pacientes.length ? <div className="duenos-empty"><div className="duenos-empty-icon" aria-hidden="true">♧</div><h4>No hay pacientes registrados</h4><p>Registra el primer paciente y asígnale un propietario.</p></div>
          : !filtered.length ? <p className="duenos-message" role="status">No hay pacientes que coincidan con tu búsqueda.</p>
          : <div className="duenos-table-wrapper"><table className="duenos-table">
            <thead><tr><th scope="col">Nombre</th><th scope="col">Especie</th><th scope="col">Raza</th><th scope="col">Sexo</th><th scope="col">Propietario</th><th scope="col">Acciones</th></tr></thead>
            <tbody>{filtered.map(paciente => <tr key={paciente.id_mascota}>
              <td><strong>{paciente.nombre}</strong></td><td>{paciente.especie || 'Sin registrar'}</td><td>{paciente.raza || '—'}</td><td>{paciente.sexo || 'Sin registrar'}</td><td>{paciente.propietario?.nombre || 'No disponible'}</td>
              <td><div className="dueno-actions">{can('expediente.ver') && ['admin','medico'].includes(access.rol) && <button type="button" onClick={() => { window.location.hash = `/expediente?paciente=${paciente.id_mascota}` }}>Ver expediente</button>}{can('pacientes.editar') && <button type="button" aria-label={`Editar ${paciente.nombre}`} disabled={!propietarios.length || Boolean(ownersError)} onClick={() => openEditor(paciente)}>Editar</button>}
                {can('pacientes.eliminar') && <button type="button" className="danger" aria-label={`Eliminar ${paciente.nombre}`} onClick={() => { focusReturn.current = document.activeElement as HTMLElement; setModalError(''); setEliminando(paciente) }}>Eliminar</button>}</div></td>
            </tr>)}</tbody>
          </table></div>}
      </div>
      {modalOpen && <div className="modal-overlay">
        <div className="dueno-modal paciente-modal" role="dialog" aria-modal="true" aria-labelledby="patient-dialog-title" aria-describedby={modalError ? 'patient-dialog-error' : undefined} ref={dialogRef} onKeyDown={dialogKeys}>
          <div className="modal-header"><div><span className="eyebrow">Pacientes</span><h3 id="patient-dialog-title">{eliminando ? 'Eliminar paciente' : viewOnly ? 'Ver paciente' : editor?.paciente ? 'Editar paciente' : 'Registrar paciente'}</h3></div>
            <button className="modal-close" type="button" aria-label="Cerrar" onClick={closeModal} disabled={pending}>×</button></div>
          {editor ? <form onSubmit={save}>
            <div className="modal-body">
              <fieldset disabled={pending || viewOnly} className="paciente-fields">
                <div className="form-group"><label htmlFor="patient-name">Nombre *</label><input id="patient-name" required maxLength={100} value={form.nombre} onChange={event => field('nombre', event.target.value)} /></div>
                <div className="form-group"><label htmlFor="patient-owner">Propietario *</label><SearchableSelect id="patient-owner" required value={form.id_dueno} onChange={event => field('id_dueno', event.target.value)}><option value="">Selecciona un propietario</option>{propietarios.map(owner => <option key={owner.id_dueno} value={owner.id_dueno}>{owner.nombre}</option>)}</SearchableSelect></div>
                <div className="form-row">
                  <div className="form-group"><label htmlFor="patient-species">Especie</label><input id="patient-species" maxLength={100} placeholder="Ej. Perro, gato" value={form.especie} onChange={event => field('especie', event.target.value)} /></div>
                  <div className="form-group"><label htmlFor="patient-breed">Raza</label><input id="patient-breed" maxLength={100} value={form.raza} onChange={event => field('raza', event.target.value)} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label htmlFor="patient-sex">Sexo</label><input id="patient-sex" maxLength={50} placeholder="Ej. Hembra, macho, desconocido" value={form.sexo} onChange={event => field('sexo', event.target.value)} /></div>
                  <div className="form-group"><label htmlFor="patient-birth">Fecha de nacimiento</label><input id="patient-birth" type="date" min="0001-01-01" max={today()} value={form.fecha_nacimiento} onChange={event => field('fecha_nacimiento', event.target.value)} /></div>
                </div>
                <div className="form-group"><label htmlFor="patient-weight">Peso actual (kg)</label><input id="patient-weight" type="number" min="0.001" max="99999.999" step="0.001" value={form.peso_actual} onChange={event => field('peso_actual', event.target.value)} /></div>
                <div className="form-group"><label htmlFor="patient-notes">Observaciones generales</label><textarea id="patient-notes" rows={3} maxLength={5000} value={form.observaciones} onChange={event => field('observaciones', event.target.value)} /></div>
              </fieldset>
              {modalError && <p className="modal-error" id="patient-dialog-error" role="alert">{modalError}</p>}
            </div>
            <div className="modal-footer"><button type="button" className="secondary-button" onClick={closeModal} disabled={pending}>{viewOnly ? 'Cerrar' : 'Cancelar'}</button>{!viewOnly && <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar paciente'}</button>}</div>
          </form> : <><div className="modal-body"><p>¿Eliminar a <strong>{eliminando?.nombre}</strong>?</p><p>Solo se puede eliminar un paciente sin información relacionada. Esta acción no se puede deshacer.</p>{modalError && <p className="modal-error" id="patient-dialog-error" role="alert">{modalError}</p>}</div>
            <div className="modal-footer"><button type="button" className="secondary-button" onClick={closeModal} disabled={pending}>Cancelar</button><button type="button" className="primary-button paciente-delete" onClick={remove} disabled={pending}>{pending ? 'Eliminando…' : 'Eliminar paciente'}</button></div></>}
        </div>
      </div>}
    </div>
  )
}
export default Pacientes
