import { supabase } from './supabase'

const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:3000'

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
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
  )

  const data = await response
    .json()
    .catch(() => null)

  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && endpoint !== '/api/sesion') {
      window.dispatchEvent(new Event('vettrack:access-changed'))
    }
    throw new ApiError(
      data?.error ||
      `Error HTTP ${response.status}`,
      response.status
    )
  }

  return data as T
}
