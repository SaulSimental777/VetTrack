import { apiFetch } from './api'
export const platformAction = <T = unknown>(operation: string, body: object, signal?: AbortSignal) => apiFetch<T>(`/api/plataforma/${operation}`, { method: 'POST', body: JSON.stringify(body), signal })
export interface PageResult<T> { filas: T[]; offset: number; hay_mas: boolean }
export interface TenantRow { id_veterinaria: string; nombre: string; estado: 'activo' | 'suspendido'; creado_en: string | null; telefono: string | null; correo: string | null; logo_archivo: string | null; usuarios: number; administradores: number }
export interface TenantDetail { veterinaria: TenantRow & { direccion: string | null }; usuarios: number; pacientes: number; por_rol: Record<string, number>; ultima_actividad: string | null; administradores: { id: string; nombre: string | null; correo: string; telefono: string | null; activo: boolean; ultimo_acceso: string | null }[] }
export interface SupportTicket { id_ticket: string; id_veterinaria: string; id_usuario: string; rol: string; asunto: string; categoria: string; descripcion: string; prioridad: string; estado: string; modulo: string | null; creado_en: string; actualizado_en: string; cerrado_en: string | null; adjunto: string | null; veterinaria: string; usuario: string | null }
export interface TicketDetail { ticket: SupportTicket; respuestas: { id_respuesta: string; mensaje: string; es_superadmin: boolean; creado_en: string; adjunto: string | null }[] }
export const validPassword = (value: string) => value.length >= 8 && value.length <= 128 && /\p{Lu}/u.test(value) && /\p{Ll}/u.test(value) && /\p{Nd}/u.test(value)
export const supportStates = [['abierto','Abierto'],['en_revision','En revisión'],['en_proceso','En proceso'],['resuelto','Resuelto'],['cerrado','Cerrado']] as const
export const roleName = (value: string) => ({admin:'Administrador',medico:'Médico',recepcionista:'Recepcionista'})[value] || 'Usuario'
