import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { operationError, useOperationMutation } from '../lib/operations'
import { OperationNotice } from './OperationsUI'
export function QuickCreate({ kind, owner, ownerName, onClose, onSaved }: { kind: 'owner' | 'patient'; owner: string; ownerName?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState(''); const [extra, setExtra] = useState(''); const [email, setEmail] = useState(''); const [error, setError] = useState(''); const mutation = useOperationMutation()
  const save = async () => {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return }
    const controller = mutation.start(); if (!controller) return
    setError('')
    try {
      const data = await apiFetch<{ id_dueno?: string; id_mascota?: string }>(kind === 'owner' ? '/api/duenos' : '/api/pacientes', { method: 'POST', signal: controller.signal, body: JSON.stringify(kind === 'owner' ? { nombre: name, telefono: extra, correo: email, direccion: '' } : { nombre: name, id_dueno: owner, especie: extra || null }) })
      if (!controller.signal.aborted) onSaved((kind === 'owner' ? data.id_dueno : data.id_mascota)!)
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) } finally { mutation.finish(controller) }
  }
  return <section className="operations-form-section"><h4>{kind === 'owner' ? 'Crear propietario' : 'Crear paciente'}</h4><div className="users-form-grid">{kind === 'patient' && ownerName && <div className="users-field"><label htmlFor="quick-owner">Propietario</label><input id="quick-owner" readOnly value={ownerName}/></div>}<div className="users-field"><label htmlFor="quick-name">Nombre *</label><input id="quick-name" maxLength={100} value={name} onChange={event => setName(event.target.value)} /></div><div className="users-field"><label htmlFor="quick-extra">{kind === 'owner' ? 'Teléfono' : 'Especie'}</label><input id="quick-extra" maxLength={kind === 'owner' ? 20 : 100} value={extra} onChange={event => setExtra(event.target.value)} /></div>{kind === 'owner' && <div className="users-field"><label htmlFor="quick-email">Correo</label><input id="quick-email" type="email" maxLength={100} value={email} onChange={event => setEmail(event.target.value)} /></div>}</div>{error && <OperationNotice error>{error}</OperationNotice>}<div className="operations-actions"><button type="button" className="users-secondary-button" disabled={mutation.pending} onClick={onClose}>Cancelar registro</button><button type="button" className="primary-button" disabled={mutation.pending || !name.trim()} onClick={() => void save()}>Guardar y seleccionar</button></div></section>
}
