import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import '../pages/Usuarios.css'
import '../pages/Operations.css'

export function OperationsPage({ title, description, section = 'Operación de clínica', actions, children }: {
  title: string; description: string; section?: string; actions?: ReactNode; children: ReactNode
}) {
  return <div className="operations-page"><div className="users-page-header"><div><span className="eyebrow">{section}</span><h3>{title}</h3><p>{description}</p></div><div className="operations-actions">{actions}</div></div>{children}</div>
}

export function OperationNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`users-notice ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{children}</p>
}

export function OperationState({ loading, error, empty, children }: { loading: boolean; error: string; empty: boolean; children: ReactNode }) {
  return <>{loading && <p className="users-loading" role="status">Cargando…</p>}{error && <OperationNotice error>{error}</OperationNotice>}{!loading && !error && empty && <p className="users-empty">No hay registros para esta selección.</p>}{children}</>
}

export function OperationDialog({ title, pending = false, onClose, children, wide = false }: {
  title: string; pending?: boolean; onClose: () => void; children: ReactNode; wide?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    if (element && !element.open) element.showModal()
    element?.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className={`users-dialog${wide ? ' users-dialog-wide' : ''}`} aria-labelledby={titleId} aria-busy={pending} onCancel={event => { event.preventDefault(); if (!pending) onClose() }}><div className="users-dialog-header"><div><span className="eyebrow">VetTrack</span><h3 id={titleId}>{title}</h3></div><button type="button" className="users-close" aria-label="Cerrar ventana" disabled={pending} onClick={onClose}>×</button></div>{children}</dialog>
}

export function OperationFooter({ pending, onClose, label = 'Guardar cambios', disabled = false }: { pending: boolean; onClose: () => void; label?: string; disabled?: boolean }) {
  return <div className="users-dialog-footer"><button type="button" className="users-secondary-button" disabled={pending} onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={pending || disabled}>{pending ? 'Guardando…' : label}</button></div>
}

export function SpecialtiesField({ options, selected, onChange, disabled = false, title = 'Especialidades sugeridas' }: {
  options: { id_especialidad: string; nombre: string }[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean; title?: string
}) {
  const titleId = useId()
  return <section aria-labelledby={titleId}><h4 id={titleId}>{title}</h4><p className="users-help">Son etiquetas de búsqueda; no limitan qué médico puede atender una cita.</p><div className="users-specialty-options">{options.map(item => <label className="users-specialty-option" key={item.id_especialidad}><input type="checkbox" disabled={disabled} checked={selected.includes(item.id_especialidad)} onChange={event => onChange(event.target.checked ? [...selected, item.id_especialidad] : selected.filter(id => id !== item.id_especialidad))} /><span>{item.nombre}</span></label>)}</div></section>
}
