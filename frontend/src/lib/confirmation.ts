import { createContext, useContext } from 'react'
export interface Confirmation { title: string; lines: string[]; label?: string }
export const ConfirmationContext = createContext<(options: Confirmation) => Promise<boolean>>(() => Promise.resolve(false))
export const useConfirm = () => useContext(ConfirmationContext)
