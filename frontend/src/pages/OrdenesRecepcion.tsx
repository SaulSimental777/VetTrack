import { useConfirm } from '../lib/confirmation'
import { StatusBadge } from '../components/StatusBadge'
import { useState } from 'react'
import { apiFetch, downloadApiFile } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import { clinicDateTime, money, operationError, useOperationMutation, useOperationResource } from '../lib/operations'
import type { ClosureOrder } from '../lib/clinical'
import { OperationsPage, OperationNotice, OperationState } from '../components/OperationsUI'
import { OperationDialog } from '../components/OperationsUI'
import { inventoryAction } from '../lib/inventory'

function PrescriptionDelivery({ order, onClose }: { order: string; onClose: () => void }) {
  const confirm = useConfirm()
  const resource = useOperationResource<{ id_detalle: string; nombre: string; cantidad: number; id_producto: string | null; stock_actual: number | null; entregada: boolean; grupo_prescripcion: string }[]>(`/api/inventario/entregas_receta?id_orden=${order}`)
  const mutation = useOperationMutation(); const [error, setError] = useState('')
  const deliver = async (id: string) => {
    const item = resource.data?.find(d => d.id_detalle === id)
    if (!await confirm({ title: 'Confirmar entrega de medicamento', lines: [item?.nombre || 'Medicamento', `Cantidad: ${item?.cantidad}`, `Stock disponible: ${item?.stock_actual}`], label: 'Confirmar entrega' })) return
    const controller = mutation.start(); if (!controller) return
    setError('')
    try { await inventoryAction('receta_entregar', { id_orden: order, id_detalle: id }, controller.signal); if (!controller.signal.aborted) resource.reload() }
    catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) } finally { mutation.finish(controller) }
  }
  return <OperationDialog title="Entrega de medicamentos" onClose={onClose} pending={mutation.pending}><div className="users-dialog-body">{error && <OperationNotice error>{error}</OperationNotice>}<OperationState loading={resource.loading} error={resource.error} empty={!resource.data?.length}>{resource.data?.map(item => <section className="clinical-entry" key={item.id_detalle}><h4>{item.nombre} · {item.cantidad}</h4><p>{item.entregada ? 'Entregada' : item.id_producto ? `Stock disponible: ${item.stock_actual}` : 'Sin vínculo de inventario. No se registra salida de stock.'}</p>{!item.entregada && item.id_producto && ['II', 'III'].includes(item.grupo_prescripcion) && <button type="button" className="primary-button" disabled={mutation.pending} onClick={() => void deliver(item.id_detalle)}>Confirmar entrega física</button>}{['I', 'no_clasificado'].includes(item.grupo_prescripcion) && <p className="users-help">Requiere control autorizado; entrega no disponible.</p>}</section>)}</OperationState></div></OperationDialog>
}

function OrdenesRecepcion() {
  const confirm = useConfirm()
  const { can } = usePermissions()
  const resource = useOperationResource<ClosureOrder[]>('/api/clinica/ordenes')
  const mutation = useOperationMutation()
  const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [delivery, setDelivery] = useState<string | null>(null)
  const process = async (order: ClosureOrder) => {
    if (!await confirm({ title: 'Procesar orden de recepción', lines: [order.contenido.paciente.nombre, order.contenido.propietario.nombre, ...order.contenido.servicios.map(s => `${s.nombre} · ${money(s.precio_aplicado)}`), 'El pago se registra por separado.'], label: 'Confirmar procesamiento' })) return
    const controller = mutation.start(); if (!controller) return
    setError('')
    try { await apiFetch(`/api/clinica/ordenes/${order.id_orden}/procesar`, { method: 'POST', signal: controller.signal }); if (!controller.signal.aborted) { setNotice('Orden procesada. El cobro se registra por separado.'); resource.reload() } }
    catch (cause) { if (!controller.signal.aborted) setError(operationError(cause)) } finally { mutation.finish(controller) }
  }
  const download = async (order: ClosureOrder) => {
    try {
      if (!order.id_documento) throw new Error('El documento aún no está disponible.')
      await downloadApiFile(`/api/clinica/documentos/${order.id_documento}`, 'orden-recepcion.pdf')
    } catch (cause) { setError(operationError(cause)) }
  }
  return <OperationsPage title="Órdenes de recepción" description="Cierres administrativos de consultas, servicios realizados y entregas solicitadas.">{notice && <OperationNotice>{notice}</OperationNotice>}{error && <OperationNotice error>{error}</OperationNotice>}<OperationState loading={resource.loading} error={resource.error} empty={!resource.data?.length}>{resource.data?.map(order => <article className="users-card clinical-card" key={order.id_orden}><div className="operations-toolbar"><h4>{order.contenido.paciente.nombre} · {order.contenido.propietario.nombre}</h4><StatusBadge value={order.estado} /></div><p>{clinicDateTime(order.creado_en)} · {order.contenido.medico.nombre}</p><h4>Servicios</h4>{order.contenido.servicios.map((item, i) => <p key={i}>{item.nombre} · {money(item.precio_aplicado)}</p>)}<h4>Productos o medicamentos solicitados para entrega</h4>{order.contenido.productos.length ? order.contenido.productos.map((item, i) => <p key={i}>{item.nombre} · Cantidad {item.cantidad}</p>) : <p className="users-help">Sin entregas solicitadas.</p>}<p>{order.contenido.observaciones_administrativas}</p>{order.contenido.proxima_cita && <p>Próxima cita sugerida: {order.contenido.proxima_cita}</p>}<div className="operations-actions">{can('pagos.ver') && <button type="button" className="primary-button" onClick={() => { window.location.hash = `/pagos?orden=${order.id_orden}` }}>Revisar pago</button>}{can('inventario.entregar') && order.estado !== 'anulada' && <button type="button" className="users-secondary-button" onClick={() => setDelivery(order.id_orden)}>Revisar entregas</button>}<button type="button" className="users-secondary-button" onClick={() => void download(order)}>Descargar orden PDF</button>{order.estado === 'pendiente' && can('orden_recepcion.procesar') && <button type="button" className="primary-button" disabled={mutation.pending} onClick={() => void process(order)}>Marcar procesada</button>}</div></article>)}</OperationState>{delivery && <PrescriptionDelivery order={delivery} onClose={() => setDelivery(null)} />}</OperationsPage>
}
export default OrdenesRecepcion
