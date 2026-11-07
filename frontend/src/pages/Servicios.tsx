import { StatusBadge } from '../components/StatusBadge'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { apiFetch } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import { formatDuration, money, operationError, useOperationMutation, useOperationResource } from '../lib/operations'
import type { Especialidad, Servicio } from '../lib/operations'
import { OperationDialog, OperationFooter, OperationNotice, OperationsPage, OperationState, SpecialtiesField } from '../components/OperationsUI'

function ServiceEditor({ servicio, priceOnly, onClose, onSaved }: { servicio: Servicio | null; priceOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const { can } = usePermissions()
  const [form, setForm] = useState({ nombre: servicio?.nombre || '', descripcion: servicio?.descripcion || '', costo: String(servicio?.costo ?? 0), duracion: String(servicio?.duracion_minutos ?? 30), activo: servicio?.activo ?? true })
  const [selected, setSelected] = useState(servicio?.especialidades.map(item => item.id_especialidad) || [])
  const specialties = useOperationResource<Especialidad[]>(priceOnly ? null : '/api/especialidades')
  const mutation = useOperationMutation()
  const [error, setError] = useState('')
  const priceAllowed = can('servicios.editar_precio')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const price = Number(form.costo)
    if (priceAllowed && (!Number.isFinite(price) || price < 0 || price > 99999999.99 || !/^\d+(?:\.\d{1,2})?$/.test(form.costo))) { setError('Ingresa un precio válido con hasta dos decimales.'); return }
    if (!priceOnly && (!form.nombre.trim() || !Number.isInteger(Number(form.duracion)) || Number(form.duracion) < 1 || Number(form.duracion) > 1440)) { setError('Completa el nombre y una duración de 1 a 1440 minutos.'); return }
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try {
      const body = priceOnly ? { costo: price } : { nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null, duracion_minutos: Number(form.duracion), activo: form.activo, especialidades: selected, ...(priceAllowed ? { costo: price } : !servicio ? { costo: 0 } : {}) }
      await apiFetch(servicio ? `/api/servicios/${servicio.id_servicio}` : '/api/servicios', { method: servicio ? 'PUT' : 'POST', signal: controller.signal, body: JSON.stringify(body) })
      if (!controller.signal.aborted) onSaved()
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) }
    finally { mutation.finish(controller) }
  }
  return <OperationDialog title={priceOnly ? `Cambiar precio: ${servicio?.nombre}` : servicio ? 'Editar servicio' : 'Nuevo servicio'} onClose={onClose} pending={mutation.pending} wide>
    <form onSubmit={save}><div className="users-dialog-body"><fieldset className="users-fields" disabled={mutation.pending}>
      <div className="users-form-grid">
        {!priceOnly && <><div className="users-field"><label htmlFor="service-name">Servicio *</label><input id="service-name" data-initial-focus value={form.nombre} onChange={event => setForm(previous => ({ ...previous, nombre: event.target.value }))} maxLength={100} required /></div><div className="users-field"><label htmlFor="service-duration">Duración en minutos *</label><input id="service-duration" type="number" min={1} max={1440} step={1} value={form.duracion} onChange={event => setForm(previous => ({ ...previous, duracion: event.target.value }))} required /></div></>}
        <div className="users-field"><label htmlFor="service-price">Precio (MXN)</label><input id="service-price" data-initial-focus={priceOnly ? true : undefined} type="number" min={0} max={99999999.99} step="0.01" value={form.costo} disabled={!priceAllowed} onChange={event => setForm(previous => ({ ...previous, costo: event.target.value }))} required />{!priceAllowed && <small>No tienes permiso para cambiar precios.</small>}</div>
        {!priceOnly && <><div className="users-field"><label htmlFor="service-state">Estado</label><select id="service-state" value={form.activo ? 'active' : 'inactive'} onChange={event => setForm(previous => ({ ...previous, activo: event.target.value === 'active' }))}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></div><div className="users-field operations-wide-field"><label htmlFor="service-description">Descripción</label><textarea id="service-description" rows={3} maxLength={5000} value={form.descripcion} onChange={event => setForm(previous => ({ ...previous, descripcion: event.target.value }))} /></div></>}
      </div>
      {!priceOnly && <OperationState loading={specialties.loading} error={specialties.error} empty={false}>{specialties.data && <SpecialtiesField options={specialties.data} selected={selected} onChange={setSelected} disabled={mutation.pending} />}{specialties.error && <button type="button" className="users-link-button" onClick={specialties.reload}>Reintentar especialidades</button>}</OperationState>}
      <p className="users-help">Los cambios de precio del catálogo no modifican los precios aplicados a citas anteriores.</p>
    </fieldset>{error && <OperationNotice error>{error}</OperationNotice>}</div><OperationFooter pending={mutation.pending} onClose={onClose} label={servicio ? 'Guardar cambios' : 'Crear servicio'} disabled={!priceOnly && (specialties.loading || Boolean(specialties.error))} /></form>
  </OperationDialog>
}

function DisableService({ servicio, onClose, onSaved }: { servicio: Servicio; onClose: () => void; onSaved: () => void }) {
  const mutation = useOperationMutation()
  const [error, setError] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const controller = mutation.start()
    if (!controller) return
    setError('')
    try { await apiFetch(`/api/servicios/${servicio.id_servicio}`, { method: 'DELETE', signal: controller.signal }); if (!controller.signal.aborted) onSaved() }
    catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) }
    finally { mutation.finish(controller) }
  }
  return <OperationDialog title="Desactivar servicio" pending={mutation.pending} onClose={onClose}><form onSubmit={save}><div className="users-dialog-body"><p>¿Deseas desactivar <strong>{servicio.nombre}</strong>?</p><p className="users-help">Se conservará en las citas anteriores y dejará de ofrecerse para nuevas citas.</p>{error && <OperationNotice error>{error}</OperationNotice>}</div><OperationFooter pending={mutation.pending} onClose={onClose} label="Desactivar servicio" /></form></OperationDialog>
}

function Servicios() {
  const { can } = usePermissions()
  const resource = useOperationResource<Servicio[]>(can('servicios.ver') ? '/api/servicios' : null)
  const [query, setQuery] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editor, setEditor] = useState<{ servicio: Servicio | null; priceOnly: boolean } | null>(null)
  const [disabling, setDisabling] = useState<Servicio | null>(null)
  const [notice, setNotice] = useState('')
  const filtered = (resource.data || []).filter(servicio => (includeInactive || servicio.activo) && `${servicio.nombre} ${servicio.descripcion || ''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')))
  const saved = (message: string) => { setEditor(null); setDisabling(null); setNotice(message); resource.reload() }
  if (!can('servicios.ver')) return <OperationNotice error>403 · No tienes permiso para consultar servicios.</OperationNotice>
  return <OperationsPage title="Servicios" description="Administra el catálogo, las duraciones y las especialidades sugeridas." actions={<>{can('servicios.crear') && <button type="button" className="primary-button" onClick={() => setEditor({ servicio: null, priceOnly: false })}>+ Nuevo servicio</button>}<button type="button" className="users-secondary-button" onClick={resource.reload} disabled={resource.loading}>Recargar</button></>}>
    {notice && <OperationNotice>{notice}</OperationNotice>}<div className="users-card"><div className="operations-toolbar"><div className="users-field"><label htmlFor="service-search">Buscar servicio</label><input id="service-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o descripción" /></div><label className="users-help"><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /> Mostrar inactivos</label></div><OperationState loading={resource.loading} error={resource.error} empty={filtered.length === 0}>{filtered.length > 0 && <div className="users-table-scroll"><table className="users-table"><thead><tr><th>Servicio</th><th>Descripción</th><th>Precio</th><th>Duración</th><th>Especialidades sugeridas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filtered.map(servicio => <tr key={servicio.id_servicio}><th scope="row">{servicio.nombre}</th><td>{servicio.descripcion || '—'}</td><td>{money(servicio.costo)}</td><td>{formatDuration(servicio.duracion_minutos)}</td><td>{servicio.especialidades.map(item => item.nombre).join(', ') || 'Sin sugerencia'}</td><td><StatusBadge value={servicio.activo ? 'activo' : 'inactivo'} /></td><td><div className="operations-table-actions">{can('servicios.editar') && <button type="button" onClick={() => setEditor({ servicio, priceOnly: false })}>Editar</button>}{can('servicios.editar_precio') && !can('servicios.editar') && <button type="button" onClick={() => setEditor({ servicio, priceOnly: true })}>Cambiar precio</button>}{can('servicios.eliminar') && servicio.activo && <button type="button" className="danger" onClick={() => setDisabling(servicio)}>Desactivar</button>}</div></td></tr>)}</tbody></table></div>}</OperationState></div>
    {editor && <ServiceEditor servicio={editor.servicio} priceOnly={editor.priceOnly} onClose={() => setEditor(null)} onSaved={() => saved(editor.servicio ? 'Servicio actualizado.' : 'Servicio creado.')} />}{disabling && <DisableService servicio={disabling} onClose={() => setDisabling(null)} onSaved={() => saved('Servicio desactivado.')} />}
  </OperationsPage>
}
export default Servicios
