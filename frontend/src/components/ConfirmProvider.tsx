import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { OperationDialog } from './OperationsUI'
import { ConfirmationContext as Context } from '../lib/confirmation'
import type { Confirmation } from '../lib/confirmation'
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Confirmation | null>(null)
  const result = useRef<((accepted: boolean) => void) | null>(null)
  useEffect(() => () => { result.current?.(false) }, [])
  const finish = (accepted: boolean) => { result.current?.(accepted); result.current = null; setRequest(null) }
  const confirm = (options: Confirmation) => new Promise<boolean>(resolve => { result.current?.(false); result.current = resolve; setRequest(options) })
  return <Context.Provider value={confirm}>{children}{request && <OperationDialog title={request.title} onClose={() => finish(false)}><div className="users-dialog-body"><p>Revisa el resumen antes de continuar.</p><ul className="confirmation-summary">{request.lines.map((line, i) => <li key={i}>{line}</li>)}</ul></div><div className="users-dialog-footer"><button type="button" className="users-secondary-button" onClick={() => finish(false)}>Volver</button><button type="button" className="primary-button" onClick={() => finish(true)}>{request.label || 'Confirmar acción'}</button></div></OperationDialog>}</Context.Provider>
}
