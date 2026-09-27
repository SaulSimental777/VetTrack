import { supabase } from './supabase'

const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:3000'

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
    throw new Error(
      data?.error ||
      `Error HTTP ${response.status}`
    )
  }

  return data as T
}