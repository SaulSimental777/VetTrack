import { createContext, useContext } from 'react'

export interface ClinicAccess {
  id: string
  id_veterinaria: string
  nombre: string | null
  telefono: string | null
  nombre_veterinaria: string
  rol: 'admin' | 'recepcionista' | 'medico'
  activo: boolean
  permisos: string[]
  estado?: 'activo' | 'suspendido'
  logo_archivo?: string | null
}

interface PermissionsContextValue {
  access: ClinicAccess
  can: (key: string) => boolean
  refresh: () => Promise<void>
}

export const PermissionsContext = createContext<PermissionsContextValue | null>(null)

export function usePermissions(): PermissionsContextValue {
  const value = useContext(PermissionsContext)
  if (!value) throw new Error('Los permisos requieren una sesión de clínica.')
  return value
}
