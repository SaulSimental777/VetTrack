import { useState } from 'react'
import { usePermissions } from '../lib/permissions'
import { useOperationResource } from '../lib/operations'
import type { Medico } from '../lib/operations'
import { SearchableSelect } from '../components/SearchableSelect'
import { OperationsPage, OperationState, OperationNotice } from '../components/OperationsUI'
import { ScheduleDialog, BlocksDialog } from './Medicos'
export default function Horarios() {
  const { can } = usePermissions(); const resource = useOperationResource<{ id: string; nombre: string; activo: boolean }[]>('/api/operacion/horarios_medicos')
  const [selected, setSelected] = useState(''); const [blocks, setBlocks] = useState(false); const [notice, setNotice] = useState('')
  const doctor = resource.data?.find(d => d.id === selected)
  const medico: Medico | null = doctor ? { ...doctor, especialidades: [], horario_hoy: [], proxima_cita: null } : null
  return <OperationsPage title="Horarios" description="Consulta la semana de cada veterinario, sus bloques de atención y sus ausencias.">{notice && <OperationNotice>{notice}</OperationNotice>}<section className="users-card clinical-card"><OperationState loading={resource.loading} error={resource.error} empty={!resource.data?.length}><div className="users-field"><label htmlFor="schedule-doctor">Veterinario</label><SearchableSelect id="schedule-doctor" value={selected} onChange={event => { setSelected(event.target.value); setNotice('') }} options={resource.data?.map(d => ({ value: d.id, label: d.nombre, description: d.activo ? 'Activo' : 'Inactivo' })) || []} /></div></OperationState>{medico && can('horarios.ver') && <button type="button" className="users-secondary-button" onClick={() => setBlocks(true)}>Ver bloqueos y ausencias</button>}</section>{medico && <ScheduleDialog key={medico.id} medico={medico} inline onClose={() => setSelected('')} onSaved={() => setNotice('Horario guardado.')} />}{medico && blocks && <BlocksDialog medico={medico} onClose={() => setBlocks(false)} />}</OperationsPage>
}
