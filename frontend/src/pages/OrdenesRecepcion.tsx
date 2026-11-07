import { useState } from 'react'
import { apiFetch, downloadApiFile } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import { clinicDateTime, money, operationError, useOperationMutation, useOperationResource } from '../lib/operations'
import type { ClosureOrder } from '../lib/clinical'
import { OperationsPage, OperationNotice, OperationState } from '../components/OperationsUI'

function OrdenesRecepcion() {
  const { can } = usePermissions()
  const resource = useOperationResource<ClosureOrder[]>('/api/clinica/ordenes')
  const mutation = useOperationMutation()
  const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const process = async (order: ClosureOrder) => {
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
  return <OperationsPage title="Órdenes de recepción" description="Cierres administrativos de consultas, servicios realizados y entregas solicitadas.">{notice && <OperationNotice>{notice}</OperationNotice>}{error && <OperationNotice error>{error}</OperationNotice>}<OperationState loading={resource.loading} error={resource.error} empty={!resource.data?.length}>{resource.data?.map(order => <article className="users-card clinical-card" key={order.id_orden}><div className="operations-toolbar"><h4>{order.contenido.paciente.nombre} · {order.contenido.propietario.nombre}</h4><span className={`users-state ${order.estado === 'pendiente' ? 'inactive' : 'active'}`}>{order.estado.toUpperCase()}</span></div><p>{clinicDateTime(order.creado_en)} · {order.contenido.medico.nombre}</p><h4>Servicios</h4>{order.contenido.servicios.map((item, i) => <p key={i}>{item.nombre} · {money(item.precio_aplicado)}</p>)}<h4>Productos o medicamentos solicitados para entrega</h4>{order.contenido.productos.length ? order.contenido.productos.map((item, i) => <p key={i}>{item.nombre} · Cantidad {item.cantidad}</p>) : <p className="users-help">Sin entregas solicitadas.</p>}<p>{order.contenido.observaciones_administrativas}</p>{order.contenido.proxima_cita && <p>Próxima cita sugerida: {order.contenido.proxima_cita}</p>}<div className="operations-actions"><button type="button" className="users-secondary-button" onClick={() => void download(order)}>Descargar orden PDF</button>{order.estado === 'pendiente' && can('orden_recepcion.procesar') && <button type="button" className="primary-button" disabled={mutation.pending} onClick={() => void process(order)}>Marcar procesada</button>}</div></article>)}</OperationState></OperationsPage>
}
export default OrdenesRecepcion
