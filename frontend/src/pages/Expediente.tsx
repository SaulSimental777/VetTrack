import { SearchableSelect } from '../components/SearchableSelect'
import { useState } from 'react'
import { usePermissions } from '../lib/permissions'
import { clinicDateTime, useOperationResource } from '../lib/operations'
import { clinicalSections, coreFields, medicationFields } from '../lib/clinical'
import type { ClinicalRow, Prescription } from '../lib/clinical'
import { ClinicalSummary } from './Clinica'
import { OperationsPage, OperationState } from '../components/OperationsUI'

interface Timeline { paciente: { nombre: string; especie: string | null; raza: string | null; sexo?: string | null; fecha_nacimiento?: string | null; peso_actual?: number | null }; entradas: { id: string; tipo: string; fecha: string; descripcion: string; id_consulta: string | null; datos: ClinicalRow }[]; hay_mas: boolean }
function History({ patient }: { patient: string }) {
  const [offset, setOffset] = useState(0)
  const [type,setType] = useState('')
  const resource = useOperationResource<Timeline>(`/api/clinica/pacientes/${patient}/expediente?limite=100&offset=${offset}`)
  return <OperationState loading={resource.loading} error={resource.error} empty={Boolean(resource.data && !resource.data.entradas.length)}>{resource.data && <><section className="users-card clinical-card"><h4>{resource.data.paciente.nombre}</h4><dl className="summary-grid">{[['Especie',resource.data.paciente.especie],['Raza',resource.data.paciente.raza],['Sexo',resource.data.paciente.sexo],['Nacimiento',resource.data.paciente.fecha_nacimiento],['Peso (kg)',resource.data.paciente.peso_actual]].map(([label,value]) => <div key={String(label)}><dt>{label}</dt><dd>{value ?? 'Sin registrar'}</dd></div>)}</dl><div className="users-field"><label htmlFor="history-type">Filtrar eventos</label><select id="history-type" value={type} onChange={event => setType(event.target.value)}><option value="">Todos los eventos</option>{['consulta','diagnostico','tratamiento','receta','vacuna','desparasitacion','estudio','servicio'].map(t => <option key={t} value={t}>{({consulta:'Consultas',diagnostico:'Diagnósticos',tratamiento:'Tratamientos',receta:'Recetas',vacuna:'Vacunas',desparasitacion:'Desparasitación',estudio:'Estudios',servicio:'Servicios'})[t]}</option>)}</select></div></section><div className="timeline">{resource.data.entradas.filter(e => !type || e.tipo === type).map((entry, index) => {
    const section = clinicalSections.find(item => item.kind === entry.tipo)
    return <article className="users-card clinical-card" key={`${entry.tipo}-${entry.id}-${index}`}><span className="eyebrow">{entry.tipo.replaceAll('_', ' ')} · {clinicDateTime(entry.fecha)}</span><h4>{entry.descripcion}</h4>{entry.tipo === 'consulta' ? <ClinicalSummary row={entry.datos} fields={coreFields} /> : section ? <ClinicalSummary row={entry.datos} fields={section.fields} /> : entry.tipo === 'receta' ? ((entry.datos as unknown as Prescription).detalles || []).map((item, i) => <ClinicalSummary key={i} row={item} fields={medicationFields} />) : entry.tipo === 'servicio' ? <p>Precio aplicado: {String(entry.datos.precio_aplicado)} MXN</p> : null}{entry.id_consulta && <button type="button" className="users-link-button" onClick={() => { window.location.hash = `/clinica?consulta=${entry.id_consulta}` }}>Abrir consulta relacionada</button>}</article>
  })}</div><div className="operations-toolbar"><button type="button" className="users-secondary-button" disabled={offset === 0 || resource.loading} onClick={() => setOffset(value => Math.max(0, value - 100))}>Más recientes</button><button type="button" className="users-secondary-button" disabled={!resource.data.hay_mas || resource.loading} onClick={() => setOffset(value => value + 100)}>Más antiguas</button></div></>}</OperationState>
}
function Expediente() {
  const { can } = usePermissions()
  const [patient, setPatient] = useState(new URLSearchParams(window.location.hash.split('?')[1] || '').get('paciente') || '')
  const patients = useOperationResource<{ id_mascota: string; nombre: string }[]>(can('pacientes.ver') ? '/api/pacientes' : null)
  return <OperationsPage title="Expediente" description="Historial longitudinal del paciente: consultas, diagnósticos, tratamientos, recetas y prevención."><div className="users-card clinical-card"><div className="users-field"><label htmlFor="history-patient">Paciente</label><SearchableSelect id="history-patient" value={patient} onChange={event => setPatient(event.target.value)}><option value="">Selecciona un paciente</option>{patients.data?.map(item => <option key={item.id_mascota} value={item.id_mascota}>{item.nombre}</option>)}</SearchableSelect></div></div>{patient && <History key={patient} patient={patient} />}</OperationsPage>
}
export default Expediente
