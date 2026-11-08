import { useEffect, useRef, useState } from 'react'
import { apiFetch } from './api'
export { formatDuration } from './duration'

export interface Especialidad { id_especialidad: string; nombre: string; descripcion: string | null }
export interface Horario { id_horario?: string; dia_semana: number; hora_inicio: string; hora_fin: string; activo: boolean }
export interface Bloqueo { id_bloqueo: string; fecha_inicio: string; fecha_fin: string; motivo: string | null; tipo: string }
export interface Medico { cedula_profesional?: string | null; id: string; nombre: string | null; activo: boolean; especialidades: Especialidad[]; horario_hoy: Horario[]; proxima_cita: { id_cita: string; fecha_inicio: string; fecha_fin: string } | null }
export interface Servicio { id_servicio: string; nombre: string; descripcion: string | null; costo: number | string; duracion_minutos: number; activo: boolean; especialidades: Especialidad[] }
export interface CitaServicio { id_servicio: string; nombre: string; precio_aplicado: number | string; duracion_aplicada: number; estado: string }
export interface Cita { id_cita: string; fecha_inicio: string; fecha_fin: string; estado: string; motivo: string | null; id_mascota: string; id_dueno: string; id_medico: string; paciente: string | null; propietario: string | null; medico: string | null; servicios: CitaServicio[]; subtotal: number | string }
export interface Disponibilidad { fecha: string; duracion_minutos: number; zona_horaria: string; bloque_maximo_minutos?: number; slots: { fecha_inicio: string; fecha_fin: string }[] }
export const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const operationError = (cause: unknown, fallback = 'No se pudo completar la operación.') => cause instanceof Error ? cause.message : fallback
export const money = (value: number | string) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value))
export const clinicToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tijuana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const clinicDateTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Tijuana', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}
const localParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tijuana', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]))
export const clinicInputDateTime = (value: string) => {
  const parts = localParts(new Date(value))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
// Native datetime-local fields have no offset. Resolve them against the clinic's
// zone rather than the browser/host zone, including daylight saving changes.
export const clinicLocalToISO = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('Selecciona una fecha y hora válidas.')
  const [, year, month, day, hour, minute] = match.map(Number)
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = desired
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = localParts(new Date(candidate))
    candidate += desired - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  }
  if (clinicInputDateTime(new Date(candidate).toISOString()) !== value) throw new Error('Esta hora no existe en Tijuana por el cambio de horario. Selecciona otra.')
  return new Date(candidate).toISOString()
}
export const clinicDayRange = (date: string) => {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return { inicio: clinicLocalToISO(`${date}T00:00`), fin: clinicLocalToISO(`${next.toISOString().slice(0, 10)}T00:00`) }
}

export function useOperationResource<T>(endpoint: string | null) {
  const [version, setVersion] = useState(0)
  const key = `${endpoint}:${version}`
  const [result, setResult] = useState<{ key: string; endpoint: string | null; data: T | null; error: string }>({ key: '', endpoint: null, data: null, error: '' })

  useEffect(() => {
    if (!endpoint) return
    const controller = new AbortController()
    apiFetch<T>(endpoint, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult({ key, endpoint, data, error: '' }) })
      .catch(cause => { if (!controller.signal.aborted) setResult(previous => ({ key, endpoint, data: previous.endpoint === endpoint ? previous.data : null, error: operationError(cause, 'No se pudieron cargar los datos.') })) })
    return () => controller.abort()
  }, [endpoint, key])

  return {
    data: result.endpoint === endpoint ? result.data : null,
    error: result.key === key ? result.error : '',
    loading: Boolean(endpoint) && result.key !== key,
    reload: () => setVersion(previous => previous + 1),
  }
}

export function useOperationMutation() {
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const current = useRef<AbortController | null>(null)
  useEffect(() => () => current.current?.abort(), [])

  const start = () => {
    if (busy.current) return null
    busy.current = true
    const controller = new AbortController()
    current.current = controller
    setPending(true)
    return controller
  }
  const finish = (controller: AbortController) => {
    busy.current = false
    if (!controller.signal.aborted) setPending(false)
  }
  return { pending, start, finish }
}
