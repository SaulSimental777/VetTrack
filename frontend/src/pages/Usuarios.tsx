import { StatusBadge } from '../components/StatusBadge'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import './Usuarios.css'

type Role = 'admin' | 'recepcionista' | 'medico'
interface Especialidad { id_especialidad: string; nombre: string; descripcion: string | null }
interface Usuario {
  id: string
  nombre: string | null
  correo: string | null
  telefono: string | null
  rol: Role
  activo: boolean
  especialidades: Especialidad[]
  creado_en: string | null
  ultimo_acceso: string | null
  cedula_profesional?: string | null
}
interface UsuarioResponse { message: string; usuario: Usuario }
interface Permiso { clave: string; modulo: string; accion: string; descripcion: string }
interface PermisosUsuario {
  catalogo: Permiso[]
  porRol: Record<string, boolean>
  overrides: Record<string, boolean>
  efectivos: Record<string, boolean>
}
type DialogState = { tipo: 'editor'; usuario: Usuario | null } | { tipo: 'password' | 'permisos' | 'estado'; usuario: Usuario }
const roleLabels: Record<Role, string> = { admin: 'Administrador', recepcionista: 'Recepcionista', medico: 'Médico' }
const moduleLabels: Record<string, string> = {
  dashboard: 'Dashboard', propietarios: 'Propietarios', pacientes: 'Pacientes', usuarios: 'Usuarios',
  citas: 'Citas', consultas: 'Consultas', expediente: 'Expediente', diagnosticos: 'Diagnósticos',
  recetas: 'Recetas', servicios: 'Servicios', horarios: 'Horarios', inventario: 'Inventario',
  proveedores: 'Proveedores', compras: 'Compras', pagos: 'Pagos', reportes: 'Reportes', configuracion: 'Configuración',
}
const passwordHelp = 'Mínimo 8 caracteres, con mayúscula, minúscula y número.'
const strongPassword = (value: string) => [...value].length >= 8 && /\p{Lu}/u.test(value) && /\p{Ll}/u.test(value) && /\p{Nd}/u.test(value)
const validEmail = (value: string) => {
  const email = value.trim()
  const parts = email.split('@')
  if ([...email].length > 100 || parts.length !== 2) return false
  const [local, domain] = parts
  const labels = domain.split('.')
  return [...local].length <= 64 && /^[\p{L}\p{M}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u.test(local) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
    labels.length >= 2 && /^[A-Za-z]{2,63}$/.test(labels.at(-1) || '') && labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
}
const errorMessage = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback
const userName = (usuario: Usuario) => usuario.nombre || usuario.correo || 'Usuario sin nombre'
const partialFailure = (cause: unknown) => cause instanceof ApiError && (cause.syncPending || cause.cleanupPending)
const dateFormat = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Tijuana', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const userDate = (value: string | null, withTime = false) => {
  if (!value) return withTime ? 'Sin accesos' : '—'
  let normalized = value.trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00'
  if (!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(normalized)) normalized += 'Z'
  normalized = normalized.replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = Object.fromEntries(dateFormat.formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.day}/${parts.month}/${parts.year}${withTime ? ` ${parts.hour}:${parts.minute}` : ''}`
}

// Every modal owns its requests and sensitive fields. Unmounting aborts pending
// work and discards the password instead of retaining it in the users page.
function useMutation() {
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  const start = () => {
    if (busy.current) return null
    busy.current = true
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    return controller
  }
  const finish = (controller: AbortController) => {
    busy.current = false
    if (!controller.signal.aborted) setPending(false)
  }
  return { pending, start, finish }
}

function UserDialog({ title, children, pending, onClose, wide = false, headerStatus }: {
  title: string
  children: ReactNode
  pending: boolean
  onClose: () => void
  wide?: boolean
  headerStatus?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    if (dialog && !dialog.open) dialog.showModal()
    dialog?.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    return () => {
      dialog?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  return (
    <dialog ref={ref} className={`users-dialog${wide ? ' users-dialog-wide' : ''}`} aria-labelledby={titleId} aria-busy={pending}
      onCancel={event => { event.preventDefault(); if (!pending) onClose() }}>
      <div className="users-dialog-header">
        <div><span className="eyebrow">Administración de la clínica</span><h3 id={titleId}>{title}</h3>{headerStatus && <div className="users-dialog-status">{headerStatus}</div>}</div>
        <button type="button" className="users-close" aria-label="Cerrar ventana" onClick={onClose} disabled={pending}>×</button>
      </div>
      {children}
    </dialog>
  )
}

function UserActionIcon({ type }: { type: 'key' | 'password' }) {
  return <svg className="users-action-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'key' ? <><circle cx="8" cy="8" r="5" /><path d="m11.5 11.5 9 9M17 17l3-3M14 14l3-3" /></> : <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4" /></>}
  </svg>
}

export function PasswordFields({ password, confirmation, onPassword, onConfirmation, prefix }: {
  password: string
  confirmation: string
  onPassword: (value: string) => void
  onConfirmation: (value: string) => void
  prefix: string
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const confirmationVisible = Boolean(password && confirmation)
  const matching = password === confirmation
  const passwordLabel = prefix === 'new-user' ? 'Contraseña temporal' : 'Nueva contraseña'
  const confirmationLabel = prefix === 'new-user' ? 'Confirmar contraseña' : 'Confirmar nueva contraseña'

  return (
    <>
    <div className="users-form-grid">
      <div className="users-field">
        <label htmlFor={`${prefix}-password`}>{passwordLabel} *</label>
        <div className="users-password-control">
          <input id={`${prefix}-password`} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => onPassword(event.target.value)} minLength={8} maxLength={128} aria-describedby={`${prefix}-password-help`} required />
          <button type="button" className="users-password-toggle" aria-label={`${showPassword ? 'Ocultar' : 'Mostrar'} ${passwordLabel.toLocaleLowerCase('es')}`} aria-pressed={showPassword} aria-controls={`${prefix}-password`} onMouseDown={event => event.preventDefault()} onClick={() => setShowPassword(previous => !previous)}><EyeIcon visible={showPassword} /></button>
        </div>
        <small id={`${prefix}-password-help`}>{passwordHelp}</small>
      </div>
      <div className="users-field">
        <label htmlFor={`${prefix}-confirmation`}>{confirmationLabel} *</label>
        <div className="users-password-control">
          <input id={`${prefix}-confirmation`} type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => onConfirmation(event.target.value)} minLength={8} maxLength={128} aria-invalid={confirmationVisible && !matching ? true : undefined} aria-describedby={`${prefix}-match`} required />
          <button type="button" className="users-password-toggle" aria-label={`${showConfirmation ? 'Ocultar' : 'Mostrar'} ${confirmationLabel.toLocaleLowerCase('es')}`} aria-pressed={showConfirmation} aria-controls={`${prefix}-confirmation`} onMouseDown={event => event.preventDefault()} onClick={() => setShowConfirmation(previous => !previous)}><EyeIcon visible={showConfirmation} /></button>
        </div>
      </div>
    </div>
    <p id={`${prefix}-match`} className={`users-password-feedback ${matching ? 'matching' : 'different'}`} aria-live="polite" aria-atomic="true">{confirmationVisible ? matching ? 'Las contraseñas coinciden.' : 'Las contraseñas no coinciden.' : ''}</p>
    </>
  )
}

function EyeIcon({ visible }: { visible: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>
}

function UsuarioEditor({ usuario, selfId, isAdmin, lastAdmin, canCreateSpecialty, canChangeState, onClose, onSaved, onUnconfirmed }: {
  usuario: Usuario | null
  selfId: string
  isAdmin: boolean
  lastAdmin: boolean
  canCreateSpecialty: boolean
  canChangeState: boolean
  onClose: () => void
  onSaved: (usuario: Usuario, message: string) => void
  onUnconfirmed: () => void
}) {
  const [form, setForm] = useState({ nombre: usuario?.nombre || '', correo: usuario?.correo || '', telefono: usuario?.telefono || '', rol: usuario?.rol || 'recepcionista' as Role, activo: usuario?.activo ?? true })
  const [license, setLicense] = useState(usuario?.cedula_profesional || '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [selected, setSelected] = useState<string[]>(usuario?.especialidades.map(item => item.id_especialidad) || [])
  const [especialidades, setEspecialidades] = useState<Especialidad[] | null>(null)
  const [specialtyError, setSpecialtyError] = useState('')
  const [specialtyRetry, setSpecialtyRetry] = useState(0)
  const [newSpecialty, setNewSpecialty] = useState(false)
  const [specialtyName, setSpecialtyName] = useState('')
  const [specialtyDescription, setSpecialtyDescription] = useState('')
  const [createSpecialtyError, setCreateSpecialtyError] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation()
  const specialtyMutation = useMutation()
  const pending = mutation.pending || specialtyMutation.pending
  const lockedRole = usuario?.id === selfId || lastAdmin
  const lockedState = !canChangeState || usuario?.id === selfId || lastAdmin
  const invalidEmail = Boolean(form.correo.trim()) && !validEmail(form.correo)

  useEffect(() => {
    if (form.rol !== 'medico' || especialidades !== null) return
    const controller = new AbortController()
    apiFetch<Especialidad[]>('/api/especialidades', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setEspecialidades(data); setSpecialtyError('') } })
      .catch(() => { if (!controller.signal.aborted) setSpecialtyError('No se pudieron cargar las especialidades. Intenta de nuevo antes de guardar.') })
    return () => controller.abort()
  }, [form.rol, especialidades, specialtyRetry])

  const changeRole = (rol: Role) => {
    setForm(previous => ({ ...previous, rol }))
    setNewSpecialty(false)
    setCreateSpecialtyError('')
  }

  const createSpecialty = async () => {
    if (pending || !canCreateSpecialty || !specialtyName.trim()) return
    const controller = specialtyMutation.start()
    if (!controller) return
    setCreateSpecialtyError('')
    try {
      const result = await apiFetch<Especialidad>('/api/especialidades', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ nombre: specialtyName.trim(), descripcion: specialtyDescription.trim() || null }),
      })
      if (controller.signal.aborted) return
      setEspecialidades(previous => [...(previous || []), result].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
      setSelected(previous => [...new Set([...previous, result.id_especialidad])])
      setNewSpecialty(false)
      setSpecialtyName('')
      setSpecialtyDescription('')
    } catch (cause) {
      if (!controller.signal.aborted) setCreateSpecialtyError(errorMessage(cause, 'No se pudo crear la especialidad.'))
    } finally { specialtyMutation.finish(controller) }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    if (!form.nombre.trim() || !form.correo.trim()) { setError('Completa el nombre y el correo electrónico.'); return }
    if (!validEmail(form.correo)) { setError('Ingresa un correo válido, por ejemplo nombre@veterinaria.com.'); return }
    if (!usuario && (!strongPassword(password) || password !== confirmation)) {
      setError(password !== confirmation ? 'Las contraseñas no coinciden.' : passwordHelp)
      return
    }
    if (form.rol === 'medico' && !especialidades) { setError('Espera a que se carguen las especialidades.'); return }
    if (form.rol === 'medico' && selected.length > 50) { setError('Selecciona como máximo 50 especialidades.'); return }
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try {
      const result = await apiFetch<UsuarioResponse>(usuario ? `/api/usuarios/${usuario.id}` : '/api/usuarios', {
        method: usuario ? 'PUT' : 'POST', signal: controller.signal,
        body: JSON.stringify({ nombre: form.nombre.trim(), correo: form.correo.trim(), telefono: form.telefono.trim() || null,
          ...(isAdmin && form.rol === 'medico' ? { cedula_profesional: license || null } : {}), rol: form.rol, activo: form.activo, especialidades: form.rol === 'medico' ? selected : [], ...(!usuario ? { passwordTemporal: password } : {}) }),
      })
      if (controller.signal.aborted) return
      setPassword('')
      setConfirmation('')
      onSaved(result.usuario, usuario ? 'Usuario actualizado.' : result.usuario.activo ? 'Usuario creado. Ya puede ingresar con su contraseña temporal.' : 'Usuario creado como INACTIVO. Podrá ingresar cuando se reactive su cuenta.')
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (partialFailure(cause)) { setPassword(''); setConfirmation(''); onUnconfirmed() }
        else setError(errorMessage(cause, 'No se pudo guardar el usuario.'))
      }
    } finally { mutation.finish(controller) }
  }

  const close = () => {
    if (pending) return
    setPassword('')
    setConfirmation('')
    onClose()
  }

  return (
    <UserDialog title={usuario ? 'Editar usuario' : 'Nuevo usuario'} pending={pending} onClose={close} wide headerStatus={usuario && <>Estado actual: <StatusBadge value={usuario.activo ? 'activo' : 'inactivo'} /></>}>
      <form onSubmit={save}>
        <div className="users-dialog-body">
          <fieldset disabled={pending} className="users-fields">
            <div className="users-form-grid">
              <div className="users-field"><label htmlFor="user-name">Nombre *</label><input id="user-name" data-initial-focus value={form.nombre} onChange={event => setForm(previous => ({ ...previous, nombre: event.target.value }))} maxLength={100} required /></div>
              <div className="users-field"><label htmlFor="user-email">Correo *</label><input id="user-email" type="email" autoComplete="off" value={form.correo} onChange={event => setForm(previous => ({ ...previous, correo: event.target.value }))} maxLength={100} aria-invalid={invalidEmail ? true : undefined} aria-describedby={invalidEmail ? 'user-email-error' : undefined} required />{invalidEmail && <small id="user-email-error" className="users-field-error">Ingresa un correo válido, por ejemplo nombre@veterinaria.com.</small>}</div>
              <div className="users-field"><label htmlFor="user-phone">Teléfono</label><input id="user-phone" type="tel" value={form.telefono} onChange={event => setForm(previous => ({ ...previous, telefono: event.target.value }))} maxLength={20} /></div>
              <div className="users-field"><label htmlFor="user-role">Rol *</label>
                <select id="user-role" value={form.rol} onChange={event => changeRole(event.target.value as Role)} disabled={lockedRole} required>
                  {isAdmin && <option value="admin">Administrador</option>}
                  <option value="recepcionista">Recepcionista</option><option value="medico">Médico</option>
                </select>
                {lockedRole && <small>{usuario?.id === selfId ? 'No puedes cambiar tu propio rol.' : 'Debe conservarse al menos un administrador activo.'}</small>}
              </div>
              <div className="users-field"><label htmlFor="user-state">Estado</label><select id="user-state" value={form.activo ? 'active' : 'inactive'} onChange={event => setForm(previous => ({ ...previous, activo: event.target.value === 'active' }))} disabled={lockedState}><option value="active">Activo</option><option value="inactive">Inactivo</option></select>{lockedState && <small>{!canChangeState ? 'No tienes permiso para cambiar el estado de la cuenta.' : usuario?.id === selfId ? 'No puedes cambiar el estado de tu propia cuenta.' : 'Debe conservarse al menos un administrador activo.'}</small>}</div>
            </div>
            {form.rol === 'medico' && isAdmin && <div className="users-field"><label htmlFor="user-license">Cédula profesional</label><input id="user-license" inputMode="numeric" pattern="[0-9]{5,20}" maxLength={20} value={license} onChange={event => setLicense(event.target.value)} /></div>}
            {!usuario && <PasswordFields password={password} confirmation={confirmation} onPassword={value => { setPassword(value); setError('') }} onConfirmation={value => { setConfirmation(value); setError('') }} prefix="new-user" />}
            {form.rol === 'medico' && (
              <section className="users-specialties" aria-labelledby="user-specialties-title">
                <div className="users-specialties-heading"><h4 id="user-specialties-title">Especialidades médicas</h4>{canCreateSpecialty && <button type="button" className="users-link-button" onClick={() => setNewSpecialty(true)} disabled={!especialidades || pending || newSpecialty || selected.length >= 50}>+ Crear especialidad</button>}</div>
                {!especialidades && !specialtyError && <p role="status">Cargando especialidades…</p>}
                {specialtyError && <div className="users-notice error" role="alert">{specialtyError}<button type="button" className="users-link-button" onClick={() => { setSpecialtyError(''); setSpecialtyRetry(previous => previous + 1) }}>Reintentar</button></div>}
                {especialidades?.length === 0 && <p className="users-help">No hay especialidades registradas. Puedes crear una para esta clínica.</p>}
                {especialidades && <div className="users-specialty-options">{especialidades.map(especialidad => (
                  <label key={especialidad.id_especialidad} className="users-specialty-option"><input type="checkbox" checked={selected.includes(especialidad.id_especialidad)} disabled={selected.length >= 50 && !selected.includes(especialidad.id_especialidad)} onChange={event => setSelected(previous => event.target.checked ? [...previous, especialidad.id_especialidad] : previous.filter(id => id !== especialidad.id_especialidad))} /><span>{especialidad.nombre}</span></label>
                ))}</div>}
                {selected.length >= 50 && <p className="users-help">Se permiten como máximo 50 especialidades por médico.</p>}
                {newSpecialty && <div className="users-inline-specialty">
                  <div className="users-field"><label htmlFor="specialty-name">Nombre de la especialidad</label><input id="specialty-name" value={specialtyName} onChange={event => setSpecialtyName(event.target.value)} maxLength={100} /></div>
                  <div className="users-field"><label htmlFor="specialty-description">Descripción</label><textarea id="specialty-description" value={specialtyDescription} onChange={event => setSpecialtyDescription(event.target.value)} rows={2} maxLength={2000} /></div>
                  {createSpecialtyError && <p className="users-notice error" role="alert">{createSpecialtyError}</p>}
                  <div className="users-inline-actions"><button type="button" className="users-secondary-button" onClick={() => { setNewSpecialty(false); setSpecialtyName(''); setSpecialtyDescription(''); setCreateSpecialtyError('') }}>Cancelar especialidad</button><button type="button" className="primary-button" onClick={createSpecialty} disabled={!specialtyName.trim() || pending}>{specialtyMutation.pending ? 'Creando…' : 'Crear y seleccionar'}</button></div>
                </div>}
              </section>
            )}
          </fieldset>
          {error && <p className="users-notice error" role="alert">{error}</p>}
        </div>
        <div className="users-dialog-footer"><button type="button" className="users-secondary-button" onClick={close} disabled={pending}>Cancelar</button><button type="submit" className="primary-button" disabled={pending || newSpecialty || !form.nombre.trim() || !validEmail(form.correo) || (!usuario && (!strongPassword(password) || password !== confirmation)) || (form.rol === 'medico' && !especialidades)}>{mutation.pending ? 'Guardando…' : usuario ? 'Guardar cambios' : 'Crear usuario'}</button></div>
      </form>
    </UserDialog>
  )
}

function PasswordDialog({ usuario, onClose, onSaved, onUnconfirmed }: { usuario: Usuario; onClose: () => void; onSaved: () => void; onUnconfirmed: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation()
  const close = () => {
    if (mutation.pending) return
    setPassword('')
    setConfirmation('')
    onClose()
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!strongPassword(password) || password !== confirmation) {
      setError(password !== confirmation ? 'Las contraseñas no coinciden.' : passwordHelp)
      return
    }
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try {
      await apiFetch(`/api/usuarios/${usuario.id}/password`, { method: 'PUT', signal: controller.signal, body: JSON.stringify({ nuevaPassword: password }) })
      if (controller.signal.aborted) return
      setPassword('')
      setConfirmation('')
      onSaved()
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (partialFailure(cause)) { setPassword(''); setConfirmation(''); onUnconfirmed() }
        else setError(errorMessage(cause, 'No se pudo cambiar la contraseña.'))
      }
    } finally { mutation.finish(controller) }
  }
  return (
    <UserDialog title="Cambiar contraseña" pending={mutation.pending} onClose={close} wide>
      <form onSubmit={save}>
        <div className="users-dialog-body"><p className="users-dialog-description">Define una nueva contraseña para <strong>{userName(usuario)}</strong>.</p>
          <fieldset disabled={mutation.pending} className="users-fields"><PasswordFields password={password} confirmation={confirmation} onPassword={value => { setPassword(value); setError('') }} onConfirmation={value => { setConfirmation(value); setError('') }} prefix="change-user" /></fieldset>
          {error && <p className="users-notice error" role="alert">{error}</p>}
        </div>
        <div className="users-dialog-footer"><button type="button" className="users-secondary-button" onClick={close} disabled={mutation.pending}>Cancelar</button><button type="submit" className="primary-button" disabled={mutation.pending || !strongPassword(password) || password !== confirmation}>{mutation.pending ? 'Guardando…' : 'Cambiar contraseña'}</button></div>
      </form>
    </UserDialog>
  )
}

function EstadoDialog({ usuario, onClose, onSaved, onUnconfirmed }: { usuario: Usuario; onClose: () => void; onSaved: (usuario: Usuario, message: string) => void; onUnconfirmed: () => void }) {
  const [error, setError] = useState('')
  const mutation = useMutation()
  const save = async () => {
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try {
      const result = await apiFetch<UsuarioResponse>(`/api/usuarios/${usuario.id}/estado`, { method: 'PATCH', signal: controller.signal, body: JSON.stringify({ activo: !usuario.activo }) })
      if (!controller.signal.aborted) onSaved(result.usuario, usuario.activo ? 'Usuario desactivado.' : 'Usuario reactivado.')
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (partialFailure(cause)) onUnconfirmed()
        else setError(errorMessage(cause, 'No se pudo cambiar el estado del usuario.'))
      }
    } finally { mutation.finish(controller) }
  }
  return (
    <UserDialog title={usuario.activo ? 'Desactivar usuario' : 'Reactivar usuario'} pending={mutation.pending} onClose={onClose}>
      <div className="users-dialog-body"><p className="users-dialog-description">¿Deseas {usuario.activo ? 'desactivar' : 'reactivar'} a <strong>{userName(usuario)}</strong>?</p><p className="users-help">{usuario.activo ? 'Se impedirá su acceso a la clínica y se conservarán sus registros.' : 'Podrá volver a ingresar con su cuenta y sus permisos asignados.'}</p>{error && <p className="users-notice error" role="alert">{error}</p>}</div>
      <div className="users-dialog-footer"><button type="button" className="users-secondary-button" onClick={onClose} disabled={mutation.pending}>Cancelar</button><button type="button" className={usuario.activo ? 'users-danger-button' : 'primary-button'} onClick={save} disabled={mutation.pending}>{mutation.pending ? 'Guardando…' : usuario.activo ? 'Desactivar usuario' : 'Reactivar usuario'}</button></div>
    </UserDialog>
  )
}

function PermisosDialog({ usuario, onClose, onUpdated }: { usuario: Usuario; onClose: () => void; onUpdated: () => void }) {
  const [data, setData] = useState<PermisosUsuario | null>(null)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [retry, setRetry] = useState(0)
  const mutation = useMutation()
  const prefix = useId()

  useEffect(() => {
    const controller = new AbortController()
    apiFetch<PermisosUsuario>(`/api/usuarios/${usuario.id}/permisos`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setData(result)
        setDraft(result.overrides)
      })
      .catch(cause => { if (!controller.signal.aborted) setLoadError(errorMessage(cause, 'No se pudieron cargar los permisos.')) })
    return () => controller.abort()
  }, [usuario.id, retry])

  const changes: Record<string, boolean | null> = {}
  if (data) {
    for (const permiso of data.catalogo) {
      if (permiso.clave === 'usuarios.permisos') continue
      if (draft[permiso.clave] !== data.overrides[permiso.clave]) changes[permiso.clave] = draft[permiso.clave] ?? null
    }
  }
  const groups = new Map<string, Permiso[]>()
  data?.catalogo.forEach(permiso => groups.set(permiso.modulo, [...(groups.get(permiso.modulo) || []), permiso]))

  const save = async (reset: boolean) => {
    const controller = mutation.start()
    if (!controller) return
    setError('')
    setSuccess('')
    try {
      const result = await apiFetch<{ message: string; permisos: PermisosUsuario }>(`/api/usuarios/${usuario.id}/permisos`, {
        method: 'PUT', signal: controller.signal, body: JSON.stringify(reset ? {} : changes),
      })
      if (controller.signal.aborted) return
      setData(result.permisos)
      setDraft(result.permisos.overrides)
      setSuccess(reset ? 'Se restauraron los permisos del rol.' : 'Permisos personalizados guardados.')
      onUpdated()
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause, 'No se pudieron actualizar los permisos.'))
    } finally { mutation.finish(controller) }
  }

  return (
    <UserDialog title={`Permisos de ${userName(usuario)}`} pending={mutation.pending} onClose={onClose} wide>
      <div className="users-dialog-body">
        <p className="users-dialog-description">Rol: <strong>{roleLabels[usuario.rol]}</strong>. Cada permiso puede heredarse del rol o personalizarse para esta cuenta.</p>
        {!usuario.activo && <p className="users-notice info" role="status">Este usuario está inactivo y no tiene acceso. Las asignaciones se aplicarán cuando se reactive su cuenta.</p>}
        {Object.keys(changes).length > 0 && <p className="users-help">Los cambios seleccionados se aplicarán al guardar los permisos.</p>}
        {!data && !loadError && <p className="users-loading" role="status">Cargando permisos…</p>}
        {loadError && <div className="users-notice error" role="alert">{loadError}<button type="button" className="users-link-button" onClick={() => { setLoadError(''); setRetry(previous => previous + 1) }}>Reintentar</button></div>}
        {success && <p className="users-notice success" role="status">{success}</p>}
        {error && <p className="users-notice error" role="alert">{error}</p>}
        {data && <div className="users-permission-groups">{[...groups].map(([module, permisos]) => (
          <section className="users-permission-group" key={module} aria-labelledby={`${prefix}-${module}`}>
            <h4 id={`${prefix}-${module}`}>{moduleLabels[module] || module}</h4>
            {permisos.map(permiso => {
              const inherited = data.porRol[permiso.clave] === true
              const personal = Object.hasOwn(draft, permiso.clave)
              const reserved = permiso.clave === 'usuarios.permisos'
              const changed = draft[permiso.clave] !== data.overrides[permiso.clave]
              const effective = usuario.activo && !reserved && (changed ? personal ? draft[permiso.clave] : inherited : data.efectivos[permiso.clave] === true)
              return <div className="users-permission-row" key={permiso.clave}>
                <div><label htmlFor={`${prefix}-${permiso.clave}`}>{permiso.descripcion}</label><small>{reserved ? 'Reservado al administrador' : personal ? 'Personalizado' : 'Heredado del rol'}</small></div>
                <span className={`users-permission-status ${effective ? 'allowed' : 'denied'}`}>{!usuario.activo ? 'Inactivo' : effective ? 'Permitido' : 'Denegado'}</span>
                <select id={`${prefix}-${permiso.clave}`} aria-label={`Modo de permiso: ${permiso.descripcion}`} value={personal ? draft[permiso.clave] ? 'allow' : 'deny' : 'inherit'} disabled={mutation.pending || reserved} onChange={event => {
                  const mode = event.target.value
                  setDraft(previous => { const next = { ...previous }; if (mode === 'inherit') delete next[permiso.clave]; else next[permiso.clave] = mode === 'allow'; return next })
                  setSuccess('')
                }}><option value="inherit">Heredar ({inherited ? 'permitido' : 'denegado'})</option><option value="allow">Permitir</option><option value="deny">Denegar</option></select>
              </div>
            })}
          </section>
        ))}</div>}
      </div>
      <div className="users-dialog-footer users-permissions-footer">
        <button type="button" className="users-link-button" onClick={() => void save(true)} disabled={!data || mutation.pending || !Object.keys(data.overrides).length}>Restaurar permisos del rol</button>
        <div><button type="button" className="users-secondary-button" onClick={onClose} disabled={mutation.pending}>Cerrar</button><button type="button" className="primary-button" onClick={() => void save(false)} disabled={!data || mutation.pending || !Object.keys(changes).length}>{mutation.pending ? 'Guardando…' : 'Guardar permisos'}</button></div>
      </div>
    </UserDialog>
  )
}

function Usuarios() {
  const { access, can, refresh } = usePermissions()
  const identity = `${access.id}:${access.id_veterinaria}`
  const [list, setList] = useState<{ identity: string; usuarios: Usuario[]; error: string; loading: boolean }>({ identity, usuarios: [], error: '', loading: true })
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<(DialogState & { identity: string }) | null>(null)
  const [notice, setNotice] = useState('')
  const [accessError, setAccessError] = useState('')
  const loadRequest = useRef<AbortController | null>(null)
  const allowed = can('usuarios.ver')

  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    loadRequest.current = controller
    apiFetch<Usuario[]>('/api/usuarios', { signal: controller.signal })
      .then(usuarios => { if (!controller.signal.aborted) setList({ identity, usuarios, error: '', loading: false }) })
      .catch(cause => {
        if (!controller.signal.aborted) setList(previous => ({ identity, usuarios: previous.identity === identity ? previous.usuarios : [], error: errorMessage(cause, 'No se pudieron cargar los usuarios.'), loading: false }))
      })
    return () => controller.abort()
  }, [identity, allowed, reload])

  const usuarios = list.identity === identity ? list.usuarios : []
  const loading = list.identity !== identity || list.loading
  const error = list.identity === identity ? list.error : ''
  const admin = access.rol === 'admin'
  const activeAdmins = usuarios.filter(usuario => usuario.rol === 'admin' && usuario.activo).length
  const filtered = usuarios.filter(usuario => [usuario.nombre, usuario.correo, usuario.rol, roleLabels[usuario.rol]].some(value => value?.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'))))
  const activeDialog = dialog?.identity === identity ? dialog : null

  const open = (next: DialogState) => {
    loadRequest.current?.abort()
    setList(previous => ({ ...previous, loading: false }))
    setNotice('')
    setDialog({ ...next, identity })
  }
  const reloadList = () => {
    loadRequest.current?.abort()
    setList(previous => ({ ...previous, loading: true, error: '' }))
    setReload(previous => previous + 1)
  }
  const refreshAccess = () => {
    void refresh().catch(() => setAccessError('Los cambios se guardaron, pero no se pudo actualizar tu acceso. Recarga la página antes de continuar.'))
  }
  const saved = (usuario: Usuario, message: string) => {
    setList(previous => ({ identity, loading: false, error: previous.error, usuarios: [usuario, ...previous.usuarios.filter(item => item.id !== usuario.id)] }))
    setNotice(message)
    setAccessError('')
    setDialog(null)
    if (usuario.id === access.id) refreshAccess()
  }

  const unconfirmed = () => {
    setDialog(null)
    setNotice('')
    setAccessError('La operación quedó pendiente de revisión. Se recargó la lista para mostrar el estado actual; compruébalo antes de volver a guardar.')
    reloadList()
  }

  if (!allowed) return <div className="users-forbidden" role="alert"><h3>403 · Acceso no autorizado</h3><p>No tienes permiso para consultar usuarios.</p></div>

  return (
    <div className="users-page">
      <div className="users-page-header"><div><span className="eyebrow">Configuración / Usuarios</span><h3>Usuarios</h3><p>Administra las cuentas, los roles y el acceso a tu clínica.</p></div>{can('usuarios.crear') && <button type="button" className="primary-button" disabled={loading || Boolean(activeDialog)} onClick={() => open({ tipo: 'editor', usuario: null })}>+ Nuevo usuario</button>}</div>
      {notice && <p className="users-notice success" role="status">{notice}</p>}
      {accessError && <p className="users-notice error" role="alert">{accessError}</p>}
      <section className="users-card" aria-labelledby="users-list-title" aria-busy={loading}>
        <div className="users-card-header"><div><h3 id="users-list-title">Usuarios de la clínica</h3><span>{loading ? 'Consultando usuarios…' : `${usuarios.length} ${usuarios.length === 1 ? 'usuario' : 'usuarios'}`}</span></div>
          <div className="users-list-controls"><div className="users-search"><label htmlFor="users-search">Buscar por nombre, correo o rol</label><input id="users-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar usuario…" /></div><button type="button" className="users-secondary-button" disabled={loading || Boolean(activeDialog)} onClick={reloadList}>Recargar</button></div>
        </div>
        {loading && <p className="users-loading" role="status">Cargando usuarios…</p>}
        {error && <p className="users-notice error" role="alert">{error}</p>}
        {!loading && !error && usuarios.length === 0 && <div className="users-empty"><h4>No hay usuarios registrados</h4><p>Las cuentas de esta clínica aparecerán aquí.</p></div>}
        {!loading && usuarios.length > 0 && filtered.length === 0 && <div className="users-empty"><h4>Sin coincidencias</h4><p>Prueba con otro nombre, correo o rol.</p></div>}
        {filtered.length > 0 && <div className="users-table-scroll"><table className="users-table"><thead><tr><th scope="col">Usuario</th><th scope="col">Correo</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Especialidad</th><th scope="col">Creado</th><th scope="col">Último acceso</th><th scope="col">Acciones</th></tr></thead><tbody>{filtered.map(usuario => {
          const manageable = admin || usuario.rol !== 'admin'
          const self = usuario.id === access.id
          const lastAdmin = usuario.rol === 'admin' && usuario.activo && activeAdmins <= 1
          return <tr key={usuario.id}>
            <th scope="row"><div className="users-person"><div className="users-avatar" aria-hidden="true">{userName(usuario).charAt(0).toUpperCase()}</div><div><strong>{userName(usuario)}</strong>{self && <small>Tu cuenta</small>}</div></div></th>
            <td>{usuario.correo || '—'}</td><td><span className={`users-role ${usuario.rol}`}>{roleLabels[usuario.rol]}</span></td><td><span className={`users-state ${usuario.activo ? 'active' : 'inactive'}`}><span aria-hidden="true" />{usuario.activo ? 'ACTIVO' : 'INACTIVO'}</span></td>
            <td>{usuario.rol === 'medico' && usuario.especialidades.length ? <div className="users-specialty-tags">{usuario.especialidades.map(especialidad => <span key={especialidad.id_especialidad}>{especialidad.nombre}</span>)}</div> : '—'}</td>
            <td className="users-date">{userDate(usuario.creado_en)}</td>
            <td className="users-date">{userDate(usuario.ultimo_acceso, true)}</td>
            <td><div className="users-row-actions">
              {can('usuarios.editar') && manageable && <><button type="button" aria-label={`Editar a ${userName(usuario)}`} onClick={() => open({ tipo: 'editor', usuario })}><span aria-hidden="true">✎</span> Editar</button><button type="button" aria-label={`Cambiar contraseña de ${userName(usuario)}`} onClick={() => open({ tipo: 'password', usuario })}><UserActionIcon type="password" /> Contraseña</button></>}
              {can('usuarios.permisos') && admin && <button type="button" aria-label={`Permisos de ${userName(usuario)}`} disabled={usuario.rol === 'admin'} title={usuario.rol === 'admin' ? 'El administrador tiene todos los permisos de la clínica y no admite personalizaciones.' : 'Personalizar permisos'} onClick={() => open({ tipo: 'permisos', usuario })}><UserActionIcon type="key" /> Permisos</button>}
              {can('usuarios.desactivar') && manageable && <button type="button" className={usuario.activo ? 'danger' : 'reactivate'} aria-label={`${usuario.activo ? 'Desactivar' : 'Reactivar'} a ${userName(usuario)}`} disabled={self || lastAdmin} title={self ? 'No puedes desactivar tu propia cuenta.' : lastAdmin ? 'Debe conservarse al menos un administrador activo.' : undefined} onClick={() => open({ tipo: 'estado', usuario })}>{usuario.activo ? 'Desactivar' : 'Reactivar'}</button>}
              {!(can('usuarios.editar') && manageable) && !(can('usuarios.permisos') && admin) && !(can('usuarios.desactivar') && manageable) && <span className="users-help">Sin acciones disponibles</span>}
            </div></td>
          </tr>
        })}</tbody></table></div>}
      </section>
      {activeDialog?.tipo === 'editor' && <UsuarioEditor usuario={activeDialog.usuario} selfId={access.id} isAdmin={admin} lastAdmin={Boolean(activeDialog.usuario?.rol === 'admin' && activeDialog.usuario.activo && activeAdmins <= 1)} canCreateSpecialty={can('usuarios.crear')} canChangeState={can('usuarios.desactivar')} onClose={() => setDialog(null)} onSaved={saved} onUnconfirmed={unconfirmed} />}
      {activeDialog?.tipo === 'password' && <PasswordDialog usuario={activeDialog.usuario} onClose={() => setDialog(null)} onSaved={() => { setNotice('Contraseña actualizada.'); setDialog(null) }} onUnconfirmed={unconfirmed} />}
      {activeDialog?.tipo === 'estado' && <EstadoDialog usuario={activeDialog.usuario} onClose={() => setDialog(null)} onSaved={saved} onUnconfirmed={unconfirmed} />}
      {activeDialog?.tipo === 'permisos' && <PermisosDialog usuario={activeDialog.usuario} onClose={() => setDialog(null)} onUpdated={() => { if (activeDialog.usuario.id === access.id) refreshAccess() }} />}
    </div>
  )
}

export default Usuarios
