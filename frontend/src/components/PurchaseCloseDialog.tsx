import {useState} from 'react'
import type {FormEvent} from 'react'
import type {InventoryOrder} from '../lib/inventory'
import {inventoryAction} from '../lib/inventory'
import {operationError,useOperationMutation} from '../lib/operations'
import {OperationDialog,OperationFooter,OperationNotice} from './OperationsUI'
export default function PurchaseCloseDialog({order,state,onClose,onSaved}:{order:InventoryOrder;state:'cancelada'|'no_recibida';onClose:()=>void;onSaved:()=>void}){
 const [reason,setReason]=useState(''),[error,setError]=useState('');const mutation=useOperationMutation()
 const save=async(event:FormEvent)=>{event.preventDefault();const controller=mutation.start();if(!controller)return;setError('');try{await inventoryAction('compra_cerrar',{id:order.id_compra,estado:state,motivo:reason},controller.signal);if(!controller.signal.aborted)onSaved()}catch(cause){if(!controller.signal.aborted)setError(operationError(cause))}finally{mutation.finish(controller)}}
 return <OperationDialog title={state==='cancelada'?'Cancelar compra':'Marcar compra no recibida'} onClose={onClose} pending={mutation.pending}><form onSubmit={save}><div className="users-dialog-body"><p><strong>{order.proveedor}</strong> · {order.referencia||'Sin referencia'}</p>{order.detalles.map(d=><p key={d.id_detalle}>{d.nombre} · {d.cantidad}</p>)}<p>Se cerrará el pedido pendiente sin registrar recepción ni modificar existencias.</p><div className="users-field"><label htmlFor="purchase-close-reason">Motivo *</label><textarea id="purchase-close-reason" required rows={3} maxLength={2000} disabled={mutation.pending} value={reason} onChange={e=>setReason(e.target.value)}/></div>{error&&<OperationNotice error>{error}</OperationNotice>}</div><OperationFooter onClose={onClose} pending={mutation.pending} disabled={!reason.trim()} label={state==='cancelada'?'Confirmar cancelación':'Confirmar no recibida'}/></form></OperationDialog>
}
