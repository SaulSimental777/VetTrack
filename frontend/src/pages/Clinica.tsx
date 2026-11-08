import { FileLink, FileUpload } from '../components/FileUpload'
import { StatusBadge } from '../components/StatusBadge'
import { SearchableSelect } from '../components/SearchableSelect'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { apiFetch, downloadApiFile } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import { clinicDateTime, clinicInputDateTime, clinicToday, formatDuration, money, operationError, useOperationMutation, useOperationResource } from '../lib/operations'
import type { Cita, Servicio } from '../lib/operations'
import { clinicalSections, coreFields, documentLabels, medicationFields } from '../lib/clinical'
import type { ClinicalBundle, ClinicalField, ClinicalRow, Prescription } from '../lib/clinical'
import { OperationDialog, OperationFooter, OperationNotice, OperationsPage, OperationState } from '../components/OperationsUI'
import type { Product } from '../lib/inventory'
import { StockMovementEditor } from './Inventario'

export function ClinicalFields({ fields, values, onChange, prefix = 'clinical', disabled = false, minimumDate }: { fields: ClinicalField[]; values: Record<string, string>; onChange: (key: string, value: string) => void; prefix?: string; disabled?: boolean; minimumDate?: string }) {
  return <div className="users-form-grid">{fields.map(field => <div className={`users-field ${field.type === 'textarea' ? 'operations-wide-field' : ''}`} key={field.key}><label htmlFor={`${prefix}-${field.key}`}>{field.label}{field.required ? ' *' : ''}</label>{field.type === 'textarea' ? <textarea id={`${prefix}-${field.key}`} rows={3} maxLength={20000} value={values[field.key] || ''} required={field.required} disabled={disabled} onChange={event => onChange(field.key, event.target.value)} /> : field.type === 'select' ? <select id={`${prefix}-${field.key}`} value={values[field.key] || field.options?.[0]?.[0] || ''} required={field.required} disabled={disabled} onChange={event => onChange(field.key, event.target.value)}>{field.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <input id={`${prefix}-${field.key}`} type={field.type || 'text'} value={values[field.key] || ''} required={field.required} disabled={disabled} step={field.step} min={field.type === 'number' ? (field.key.startsWith('frecuencia') ? 0 : 0.001) : field.key === 'proxima_cita' ? minimumDate : undefined} max={field.max} maxLength={20000} onChange={event => onChange(field.key, event.target.value)} />}</div>)}</div>
}
const initialValues = (fields: ClinicalField[], row?: ClinicalRow) => Object.fromEntries(fields.map(field => [field.key, row?.[field.key] == null ? field.type === 'select' ? field.options?.[0]?.[0] || '' : field.type === 'date' && field.required ? clinicToday() : '' : String(row[field.key])]))
const bodyValues = (fields: ClinicalField[], values: Record<string, string>) => Object.fromEntries(fields.map(field => [field.key, values[field.key] === '' ? null : field.type === 'number' ? Number(values[field.key]) : values[field.key]]))
const rowId = (row: ClinicalRow) => Object.entries(row).find(([key]) => ['id_diagnostico', 'id_tratamiento', 'id_vacuna', 'id_desparasitacion', 'id_estudio'].includes(key))?.[1]

function RecordEditor({ section, row, consultation, onClose, onSaved }: { section: typeof clinicalSections[number]; row?: ClinicalRow; consultation: string; onClose: () => void; onSaved: (data: ClinicalBundle) => void }) {
  const [values, setValues] = useState(() => initialValues(section.fields, row))
  const [error, setError] = useState('')
  const [attachment,setAttachment]=useState<string|null>(typeof row?.archivo_adjunto==='string'?row.archivo_adjunto:null),[legacyUrl,setLegacyUrl]=useState<string|null>(typeof row?.archivo_url==='string'?row.archivo_url:null),[uploadBusy,setUploadBusy]=useState(false)
  const mutation = useOperationMutation()
  const save = async (event: FormEvent) => {
    event.preventDefault(); if(uploadBusy)return; const controller = mutation.start(); if (!controller) return
    setError('')
    try {
      const data = await apiFetch<ClinicalBundle>(`/api/clinica/consultas/${consultation}/registros/${section.kind}`, { method: 'POST', signal: controller.signal, body: JSON.stringify({ ...bodyValues(section.fields, values), ...(section.kind === 'estudio' ? {archivo_adjunto:attachment,archivo_url:legacyUrl} : {}), ...(row ? { id: rowId(row) } : {}) }) })
      if (!controller.signal.aborted) onSaved(data)
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) } finally { mutation.finish(controller) }
  }
  return <section className="clinical-inline-editor"><h4>{row ? 'Editar' : 'Registrar'} · {section.label}</h4><form onSubmit={save}><div className="users-dialog-body"><ClinicalFields fields={section.fields} values={values} onChange={(key, value) => setValues(previous => ({ ...previous, [key]: value }))} disabled={mutation.pending} />{section.kind==='estudio'&&<FileUpload label="Archivo adjunto" category="estudios" contextId={consultation} value={attachment} onChange={setAttachment} legacyUrl={legacyUrl} onLegacyChange={setLegacyUrl} onBusyChange={setUploadBusy} disabled={mutation.pending}/>} {error && <OperationNotice error>{error}</OperationNotice>}</div><OperationFooter pending={mutation.pending||uploadBusy} onClose={onClose} /></form></section>
}

const emptyMedication = (): Record<string, string> => ({ ...initialValues(medicationFields), cantidad: '1', entregar: 'false' })
function PrescriptionEditor({ prescription, consultation, onClose, onSaved }: { prescription?: Prescription | null; consultation: string; onClose: () => void; onSaved: (data: ClinicalBundle) => void }) {
  const { can } = usePermissions()
  const catalog = useOperationResource<Product[]>(can('medicamentos.ver') ? '/api/inventario/medicamentos' : null)
  const [items, setItems] = useState<Record<string, string>[]>(() => prescription?.detalles.length ? prescription.detalles.map(item => ({ ...initialValues(medicationFields, item), id_producto: String(item.id_producto || ''), entregar: String(item.entregar ?? false) })) : [emptyMedication()])
  const [instructions, setInstructions] = useState(prescription?.indicaciones || '')
  const [error, setError] = useState('')
  const mutation = useOperationMutation()
  const save = async (event: FormEvent) => {
    event.preventDefault(); const controller = mutation.start(); if (!controller) return
    setError('')
    try {
      const data = await apiFetch<ClinicalBundle>(`/api/clinica/consultas/${consultation}/registros/receta`, { method: 'POST', signal: controller.signal, body: JSON.stringify({ indicaciones: instructions || null, detalles: items.map(item => ({ ...bodyValues(medicationFields, item), id_producto: item.id_producto || null, entregar: item.entregar === 'true' })) }) })
      if (!controller.signal.aborted) onSaved(data)
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) } finally { mutation.finish(controller) }
  }
  return <section className="clinical-inline-editor"><h4>Receta veterinaria</h4><form onSubmit={save}><div className="users-dialog-body"><p className="users-help">Los medicamentos pueden registrarse aunque no existan en inventario. Recetar no descuenta existencias.</p>{items.map((item, index) => <section className="operations-form-section" key={index}><h4>Medicamento {index + 1}</h4>{can('medicamentos.ver') && <div className="users-field"><label htmlFor={`rx-product-${index}`}>Vincular medicamento de inventario (opcional)</label><SearchableSelect id={`rx-product-${index}`} value={item.id_producto || ''} onChange={event => { const p = catalog.data?.find(p => p.id_producto === event.target.value); setItems(old => old.map((entry, i) => i === index ? { ...entry, id_producto: p?.id_producto || '', ...(p ? { nombre_medicamento: p.nombre, principio_activo: p.principio_activo || '', concentracion: p.concentracion || '', presentacion: p.presentacion || '', grupo_prescripcion: p.grupo_prescripcion, tiempo_retiro: p.tiempo_retiro_default || '' } : {}) } : entry)) }}><option value="">Sin vínculo de inventario</option>{catalog.data?.filter(p => p.tipo_producto === 'medicamento').map(p => <option key={p.id_producto} value={p.id_producto}>{p.nombre} · Stock {p.stock_actual} {p.unidad}</option>)}</SearchableSelect>{catalog.error && <OperationNotice error>{catalog.error}</OperationNotice>}</div>}<ClinicalFields prefix={`rx-${index}`} fields={medicationFields} values={item} onChange={(key, value) => setItems(previous => previous.map((old, i) => i === index ? { ...old, [key]: value } : old))} disabled={mutation.pending} />{item.grupo_prescripcion === 'I' && <OperationNotice error>Este medicamento requiere receta médica cuantificada autorizada.</OperationNotice>}{item.grupo_prescripcion === 'no_clasificado' && <p className="users-help">Debe clasificarse antes de emitir una receta simple.</p>}<label className="users-help"><input type="checkbox" checked={item.entregar === 'true'} disabled={mutation.pending} onChange={event => setItems(previous => previous.map((old, i) => i === index ? { ...old, entregar: String(event.target.checked) } : old))} /> Incluir en la orden de recepción para entrega</label>{items.length > 1 && <button type="button" className="users-link-button" disabled={mutation.pending} onClick={() => setItems(previous => previous.filter((_, i) => i !== index))}>Quitar medicamento</button>}</section>)}<button type="button" className="users-secondary-button" disabled={mutation.pending || items.length >= 50} onClick={() => setItems(previous => [...previous, emptyMedication()])}>+ Agregar medicamento</button><div className="users-field"><label htmlFor="rx-instructions">Indicaciones generales</label><textarea id="rx-instructions" rows={3} maxLength={20000} value={instructions} onChange={event => setInstructions(event.target.value)} /></div>{error && <OperationNotice error>{error}</OperationNotice>}</div><OperationFooter pending={mutation.pending} onClose={onClose} label="Guardar receta" /></form></section>
}

function ProfessionalEditor({ data, onClose }: { data: ClinicalBundle; onClose: () => void }) {
  const { access, can } = usePermissions()
  const [license, setLicense] = useState(data.contexto.medico.cedula_profesional || '')
  const [address, setAddress] = useState(data.contexto.clinica.direccion || '')
  const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const mutation = useOperationMutation()
  const own = access.id === data.consulta.id_medico || access.rol === 'admin'
  const save = async (event: FormEvent) => {
    event.preventDefault(); const controller = mutation.start(); if (!controller) return
    setError(''); setNotice('')
    try {
      if (own) await apiFetch(`/api/clinica/medicos/${data.consulta.id_medico}/cedula`, { method: 'PUT', signal: controller.signal, body: JSON.stringify({ cedula_profesional: license || null }) })
      if (can('configuracion.editar') && access.rol === 'admin') await apiFetch('/api/clinica/datos-profesionales', { method: 'PUT', signal: controller.signal, body: JSON.stringify({ direccion: address || null }) })
      if (!controller.signal.aborted) setNotice('Datos profesionales guardados. Se usarán al emitir los documentos de esta revisión.')
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) } finally { mutation.finish(controller) }
  }
  return <OperationDialog title="Datos profesionales" pending={mutation.pending} onClose={onClose}><form onSubmit={save}><div className="users-dialog-body"><div className="users-field"><label htmlFor="clinical-license">Cédula de {data.contexto.medico.nombre}</label><input id="clinical-license" inputMode="numeric" pattern="[0-9]{5,20}" maxLength={20} value={license} disabled={!own || mutation.pending} onChange={event => setLicense(event.target.value)} /></div>{access.rol === 'admin' && can('configuracion.editar') && <div className="users-field"><label htmlFor="clinical-address">Domicilio profesional de la clínica</label><textarea id="clinical-address" maxLength={2000} rows={3} value={address} onChange={event => setAddress(event.target.value)} disabled={mutation.pending} /></div>}<p className="users-help">La cédula es obligatoria para emitir receta. No se generan firmas digitales ni folios oficiales.</p>{notice && <OperationNotice>{notice}</OperationNotice>}{error && <OperationNotice error>{error}</OperationNotice>}</div><OperationFooter pending={mutation.pending} onClose={onClose} /></form></OperationDialog>
}

export function ClinicalSummary({ row, fields }: { row: ClinicalRow; fields: ClinicalField[] }) {
  return <><dl className="clinical-summary">{fields.filter(field => row[field.key] != null && row[field.key] !== '').map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.options?.find(([value]) => value === row[field.key])?.[1] || String(row[field.key])}</dd></div>)}</dl><FileLink id={typeof row.archivo_adjunto==='string'?row.archivo_adjunto:undefined} legacyUrl={typeof row.archivo_url==='string'?row.archivo_url:undefined}/></>
}

function ConsultationWorkspace({ initial, onClose }: { initial: ClinicalBundle; onClose: () => void }) {
  const { can } = usePermissions()
  const [data, setData] = useState(initial)
  const [values, setValues] = useState(() => initialValues(coreFields, initial.consulta))
  const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [record, setRecord] = useState<{ section: typeof clinicalSections[number]; row?: ClinicalRow } | null>(null)
  const [prescription, setPrescription] = useState(false); const [professional, setProfessional] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false); const [reopen, setReopen] = useState(false); const [reason, setReason] = useState('')
  const [service, setService] = useState('')
  const [stockUse, setStockUse] = useState(false)
  const stockCatalog = useOperationResource<Product[]>(can('inventario.uso_clinico') ? '/api/inventario/medicamentos' : null)
  const catalog = useOperationResource<Servicio[]>(can('servicios.ver') ? '/api/servicios' : null)
  const mutation = useOperationMutation()
  const closed = data.consulta.estado === 'finalizada'
  const blockedRx = data.receta?.detalles.some(item => ['I', 'no_clasificado'].includes(String(item.grupo_prescripcion)))
  const replace = (next: ClinicalBundle) => { setData(next); setRecord(null); setPrescription(false); setNotice('Registro clínico guardado.') }
  const write = async (action: 'save' | 'finish' | 'service' | 'reopen') => {
    if (['save','finish'].includes(action) && values.proxima_cita && values.proxima_cita < clinicInputDateTime(String(data.consulta.fecha_inicio)).slice(0,10)) { setError('La próxima cita sugerida no puede ser anterior a la fecha de consulta.');return }
    const controller = mutation.start(); if (!controller) return
    setError(''); setNotice('')
    try {
      if (action === 'save' || (action === 'finish' && can('consultas.editar'))) {
        if (!values.motivo_consulta.trim()) throw new Error('El motivo de consulta es obligatorio.')
        const saved = await apiFetch<ClinicalBundle>(`/api/clinica/consultas/${data.consulta.id_consulta}`, { method: 'PUT', signal: controller.signal, body: JSON.stringify(bodyValues(coreFields, values)) })
        if (!controller.signal.aborted) setData(saved)
      }
      if (action !== 'save') {
        const body = action === 'service' ? { id_servicio: service } : action === 'reopen' ? { motivo: reason } : undefined
        const next = await apiFetch<ClinicalBundle>(`/api/clinica/consultas/${data.consulta.id_consulta}/${action === 'service' ? 'servicios' : action === 'reopen' ? 'reabrir' : 'finalizar'}`, { method: 'POST', signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) })
        if (!controller.signal.aborted) { setData(next); setConfirmFinish(false); setReopen(false); setService('') }
      }
      if (!controller.signal.aborted) setNotice(action === 'finish' ? 'Consulta finalizada. Los documentos están disponibles para descargar.' : action === 'reopen' ? 'Consulta reabierta con una nueva revisión.' : 'Información guardada.')
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) } finally { mutation.finish(controller) }
  }
  const download = async (id: string, tipo: string) => { try { await downloadApiFile(`/api/clinica/documentos/${id}`, `${tipo}.pdf`) } catch (cause) { setError(operationError(cause)) } }
  return <OperationsPage title={`Consulta · ${data.contexto.paciente.nombre}`} description={`${data.contexto.propietario.nombre} · ${data.contexto.medico.nombre} · ${clinicDateTime(String(data.consulta.fecha_inicio))} · revisión ${data.consulta.revision}`} actions={<><StatusBadge value={closed ? 'finalizada' : 'en_consulta'} /><button type="button" className="users-secondary-button" disabled={mutation.pending} onClick={onClose}>Volver</button><button type="button" className="users-secondary-button" onClick={() => setProfessional(true)}>Datos profesionales</button></>}>
    {notice && <OperationNotice>{notice}</OperationNotice>}{error && <OperationNotice error>{error}</OperationNotice>}
    <div className="clinical-layout"><nav className="clinical-nav" aria-label="Secciones de consulta">{[['evaluacion','Evaluación','consultas.ver'],['diagnostico','Diagnósticos','diagnosticos.ver'],['tratamiento','Tratamientos','tratamientos.ver'],['servicios','Servicios','servicios.ver'],['receta','Receta','recetas.ver'],['vacuna','Vacunas','vacunas.ver'],['desparasitacion','Desparasitación','desparasitacion.ver'],['estudio','Estudios','estudios.ver'],['indicaciones','Indicaciones','consultas.ver'],['cierre','Cierre','consultas.ver']].filter(([, , p]) => can(p)).map(([id,label]) => <a href={`#clinical-${id}`} key={id} onClick={event => { event.preventDefault(); document.getElementById(`clinical-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{label}</a>)}</nav><div className="clinical-workspace"><div id="clinical-evaluacion" className="users-card clinical-card"><h4>Evaluación</h4><p><strong>{data.contexto.paciente.nombre}</strong> · {data.contexto.paciente.especie || 'Especie pendiente'} · {data.contexto.paciente.raza || 'Raza no registrada'}</p><form onSubmit={event => { event.preventDefault(); void write('save') }}><fieldset className="users-fields" disabled={closed || mutation.pending || !can('consultas.editar')}><ClinicalFields fields={coreFields.filter(f => !['indicaciones','pronostico','proxima_cita','observaciones_administrativas'].includes(f.key))} values={values} onChange={(key, value) => setValues(previous => ({ ...previous, [key]: value }))} />{!closed && can('consultas.editar') && <button type="submit" className="primary-button" disabled={mutation.pending}>Guardar consulta</button>}</fieldset></form></div>
    {clinicalSections.filter(section => can(`${section.module}.ver`)).map(section => <section id={`clinical-${section.kind}`} className="users-card clinical-card" key={section.kind}><div className="operations-toolbar"><h4>{section.label}</h4>{!closed && can(`${section.module}.crear`) && <button type="button" className="users-secondary-button" disabled={mutation.pending} onClick={() => setRecord({ section })}>+ Registrar</button>}</div>{(data[section.key] || []).map(row => <div className="clinical-entry" key={String(rowId(row))}><ClinicalSummary row={row} fields={section.fields} />{!closed && can(`${section.module}.editar`) && <button type="button" className="users-link-button" onClick={() => setRecord({ section, row })}>Editar</button>}</div>)}{!data[section.key]?.length && <p className="users-help">Sin registros.</p>}{record?.section.kind === section.kind && <RecordEditor {...record} consultation={data.consulta.id_consulta} onClose={() => setRecord(null)} onSaved={replace} />}</section>)}
    {can('recetas.ver') && <section id="clinical-receta" className="users-card clinical-card"><div className="operations-toolbar"><h4>Receta</h4>{!closed && can(data.receta ? 'recetas.editar' : 'recetas.crear') && <button type="button" className="users-secondary-button" onClick={() => setPrescription(true)}>{data.receta ? 'Editar receta' : '+ Registrar receta'}</button>}</div>{data.receta?.detalles.map((item, index) => <div className="clinical-entry" key={index}><ClinicalSummary row={item} fields={medicationFields} />{item.grupo_prescripcion === 'I' && <OperationNotice error>Este medicamento requiere receta médica cuantificada autorizada.</OperationNotice>}</div>)}{!data.receta && <p className="users-help">Sin receta. Puede finalizarse una consulta sin medicamentos.</p>}{prescription && <PrescriptionEditor consultation={data.consulta.id_consulta} prescription={data.receta} onClose={() => setPrescription(false)} onSaved={replace} />}</section>}
    {!closed && can('inventario.uso_clinico') && <section className="users-card clinical-card"><h4>Aplicación de productos en clínica</h4><p className="users-help">Registra productos físicamente aplicados. La receta para casa no descuenta stock.</p><button type="button" className="users-secondary-button" onClick={() => setStockUse(true)}>Registrar aplicación</button>{stockCatalog.error && <OperationNotice error>{stockCatalog.error}</OperationNotice>}</section>}
    {stockUse && <StockMovementEditor products={stockCatalog.data || []} consultation={data.consulta.id_consulta} onClose={() => setStockUse(false)} onSaved={() => { setStockUse(false); stockCatalog.reload(); setNotice('Aplicación registrada y existencias descontadas.') }} />}
    <section id="clinical-servicios" className="users-card clinical-card"><h4>Servicios clínicos</h4>{data.servicios.map(item => <p key={item.id_servicio}>{item.nombre} · {money(item.precio_aplicado)} · {formatDuration(item.duracion_aplicada)}</p>)}{!closed && can('consultas.editar') && can('servicios.ver') && <div className="operations-toolbar"><div className="users-field"><label htmlFor="clinical-service">Servicio adicional</label><SearchableSelect id="clinical-service" value={service} onChange={event => setService(event.target.value)}><option value="">Selecciona un servicio</option>{catalog.data?.filter(item => item.activo && !data.servicios.some(old => old.id_servicio === item.id_servicio)).map(item => <option key={item.id_servicio} value={item.id_servicio}>{item.nombre} · {money(item.costo)}</option>)}</SearchableSelect></div><button type="button" className="users-secondary-button" disabled={!service || mutation.pending} onClick={() => void write('service')}>Agregar servicio</button></div>}{catalog.error && <OperationNotice error>{catalog.error}</OperationNotice>}</section>
    <section id="clinical-indicaciones" className="users-card clinical-card"><h4>Indicaciones</h4><form onSubmit={event => { event.preventDefault(); void write('save') }}><fieldset className="users-fields" disabled={closed || mutation.pending || !can('consultas.editar')}><ClinicalFields minimumDate={clinicInputDateTime(String(data.consulta.fecha_inicio)).slice(0,10)} fields={coreFields.filter(f => ['indicaciones','pronostico','proxima_cita','observaciones_administrativas'].includes(f.key))} values={values} onChange={(key,value) => setValues(old => ({ ...old, [key]:value }))} />{!closed && can('consultas.editar') && <button className="primary-button" type="submit">Guardar indicaciones</button>}</fieldset></form></section><section id="clinical-cierre" className="users-card clinical-card"><h4>Documentos</h4>{data.documentos.length ? data.documentos.map(doc => <p key={doc.id_documento}><button type="button" className="users-link-button" onClick={() => void download(doc.id_documento, doc.tipo)}>{documentLabels[doc.tipo]} · revisión {doc.revision} · Descargar PDF</button></p>) : <p className="users-help">Se generan al finalizar la consulta a partir de los datos registrados.</p>}{data.documentos_pendientes && <p className="users-help">La descarga reintentará generar los documentos pendientes desde los datos guardados.</p>}</section>
    {!closed && can('consultas.finalizar') && <button type="button" className="primary-button" disabled={mutation.pending} onClick={() => setConfirmFinish(true)}>Finalizar consulta</button>}{closed && can('consultas.reabrir') && <button type="button" className="users-secondary-button" onClick={() => setReopen(true)}>Reabrir con motivo</button>}
    </div></div>{professional && <ProfessionalEditor data={data} onClose={() => setProfessional(false)} />}
    {confirmFinish && <OperationDialog title="Finalizar consulta" onClose={() => setConfirmFinish(false)} pending={mutation.pending}><form onSubmit={event => { event.preventDefault(); void write('finish') }}><div className="users-dialog-body"><p>Se guardará la información del formulario, se completará la cita y se generarán los documentos y la orden para recepción.</p><p>{data.diagnosticos?.length || 0} diagnósticos · {data.tratamientos?.length || 0} tratamientos · {data.servicios.length} servicios.</p>{blockedRx && <OperationNotice error>La receta incluye Grupo I o medicamentos sin clasificar; no se emitirá receta simple.</OperationNotice>}{error && <OperationNotice error>{error}</OperationNotice>}</div><OperationFooter pending={mutation.pending} onClose={() => setConfirmFinish(false)} label="Confirmar finalización" /></form></OperationDialog>}
    {reopen && <OperationDialog title="Reabrir consulta" onClose={() => setReopen(false)} pending={mutation.pending}><form onSubmit={event => { event.preventDefault(); void write('reopen') }}><div className="users-dialog-body"><div className="users-field"><label htmlFor="clinical-reopen-reason">Motivo obligatorio</label><textarea id="clinical-reopen-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required /></div><p className="users-help">Se conserva la revisión anterior y sus documentos. No puede reabrirse una orden ya procesada.</p>{error && <OperationNotice error>{error}</OperationNotice>}</div><OperationFooter pending={mutation.pending} onClose={() => setReopen(false)} label="Reabrir consulta" disabled={!reason.trim()} /></form></OperationDialog>}
  </OperationsPage>
}

function OpenConsultation({ id, onClose }: { id: string; onClose: () => void }) {
  const resource = useOperationResource<ClinicalBundle>(`/api/clinica/consultas/${id}`)
  return <OperationState loading={resource.loading} error={resource.error} empty={false}>{resource.data && <ConsultationWorkspace initial={resource.data} key={id} onClose={onClose} />}{resource.error && <button type="button" className="users-secondary-button" onClick={onClose}>Volver</button>}</OperationState>
}

function Clinica() {
  const { access, can } = usePermissions()
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const [opened, setOpened] = useState<string | null>(query.get('consulta'))
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const mutation = useOperationMutation()
  const appointments = useOperationResource<Cita[]>(can('citas.ver') ? `/api/citas${access.rol === 'medico' ? `?medico=${access.id}` : ''}` : null)
  const consultations = useOperationResource<{ id_consulta: string; paciente: string; propietario: string; medico: string; estado: string; fecha_inicio: string }[]>(can('consultas.ver') ? `/api/clinica/consultas?mias=${access.rol === 'medico'}` : null)
  const start = async (id: string) => {
    const controller = mutation.start(); if (!controller) return
    setError('')
    try {
      const data = await apiFetch<ClinicalBundle>(`/api/clinica/citas/${id}/iniciar`, { method: 'POST', signal: controller.signal })
      if (!controller.signal.aborted) { setOpened(data.consulta.id_consulta); appointments.reload(); consultations.reload() }
    } catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) } finally { mutation.finish(controller) }
  }
  if (opened) return <OpenConsultation id={opened} onClose={() => { setOpened(null); appointments.reload(); consultations.reload() }} />
  const selectedCita = query.get('cita')
  return <OperationsPage title={access.rol === 'medico' ? 'Mis citas y consultas' : 'Consultas clínicas'} description="Abre una cita asignada, registra la atención y consulta el expediente longitudinal.">
    {error && <OperationNotice error>{error}</OperationNotice>}<section className="users-card clinical-card"><h4>Citas para atención</h4><OperationState loading={appointments.loading} error={appointments.error} empty={false}>{[['Citas de hoy',0],['Citas pendientes anteriores',-1],['Próximas citas',1]].map(([label,group])=>{const rows=(appointments.data||[]).filter(item=>['programada','confirmada','en_espera','en_consulta'].includes(item.estado)).filter(item=>{const day=clinicInputDateTime(item.fecha_inicio).slice(0,10);return group===0?day===clinicToday():group===-1?day<clinicToday():day>clinicToday()});return <section className="operations-form-section" key={label}><h4>{label}</h4>{!rows.length?<p className="users-help">No hay citas en esta sección.</p>:rows.map(item=><div className={`operations-service-option ${item.id_cita===selectedCita?'clinical-selected':''}`} key={item.id_cita}><div><strong>{item.paciente||'Paciente'} · {item.propietario}</strong><p>{clinicDateTime(item.fecha_inicio)} · {item.medico||'Médico sin asignar'} · <StatusBadge value={item.estado}/>{group===-1&&item.estado!=='en_consulta'&&<StatusBadge value="atrasada"/>}</p></div>{can('consultas.crear')&&<button type="button" className="primary-button" disabled={mutation.pending||!item.id_medico||(item.id_medico!==access.id&&!can('consultas.tomar_ajenas'))} onClick={()=>void start(item.id_cita)}>{item.estado==='en_consulta'?'Abrir consulta':'Iniciar consulta'}</button>}</div>)}</section>})}</OperationState></section>
    <section className="users-card clinical-card"><h4>Consultas registradas</h4><div className="users-field"><label htmlFor="clinical-search">Buscar paciente, propietario o médico</label><input id="clinical-search" type="search" value={search} onChange={event => setSearch(event.target.value)} /></div><OperationState loading={consultations.loading} error={consultations.error} empty={!consultations.data?.length}>{consultations.data?.filter(item => `${item.paciente} ${item.propietario} ${item.medico}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))).map(item => <div className="operations-service-option" key={item.id_consulta}><div><strong>{item.paciente}</strong><p>{clinicDateTime(item.fecha_inicio)} · {item.medico} · <StatusBadge value={item.estado}/></p></div><button type="button" className="users-secondary-button" onClick={() => setOpened(item.id_consulta)}>Abrir consulta</button></div>)}</OperationState></section>
  </OperationsPage>
}
export default Clinica
