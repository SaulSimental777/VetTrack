import { supabase } from './supabase'

const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:3000'

export class ApiError extends Error {
  readonly status: number
  readonly syncPending: boolean
  readonly cleanupPending: boolean
  constructor(message: string, status: number, details?: { syncPending?: unknown; cleanupPending?: unknown } | null) {
    super(message)
    this.status = status
    this.syncPending = details?.syncPending === true
    this.cleanupPending = details?.cleanupPending === true
  }
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error || !session?.access_token) {
    throw new Error('No hay una sesión activa')
  }

  const headers = new Headers(options.headers)

  headers.set(
    'Authorization',
    `Bearer ${session.access_token}`
  )

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(
    `${API_URL}${endpoint}`,
    {
      ...options,
      headers,
    }
  ).catch(cause => {
    if (options.signal?.aborted) throw cause
    console.error('API no disponible', cause)
    throw new ApiError('No se pudo conectar con VetTrack. Revisa tu conexión y vuelve a intentar.', 503)
  })

  const data = await response
    .json()
    .catch(() => null)

  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && endpoint !== '/api/sesion') {
      window.dispatchEvent(new Event('vettrack:access-changed'))
    }
    throw new ApiError(
      data?.error ||
      'No se pudo completar la operación. Vuelve a intentarlo.',
      response.status,
      data
    )
  }

  return data as T
}

export async function downloadApiFile(endpoint: string, filename: string): Promise<void> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session) throw new Error('No hay una sesión activa')
  const response = await fetch(`${API_URL}${endpoint}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
  if (!response.ok) {
    if ([401, 403].includes(response.status)) window.dispatchEvent(new Event('vettrack:access-changed'))
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.error || 'No se pudo descargar el documento.', response.status)
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
