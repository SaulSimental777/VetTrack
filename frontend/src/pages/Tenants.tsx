import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { apiFetch } from '../lib/api'
import './Tenants.css'

interface Tenant {
  id_veterinaria: string
  nombre: string
  telefono: string | null
  direccion: string | null
  adminEmail: string | null
}

interface CreateTenantResponse {
  message: string
  tenant: Tenant
}

function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [success, setSuccess] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [nombre, setNombre] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState('')
  const active = useRef(false)
  const savingRef = useRef(false)
  const loadController = useRef<AbortController | null>(null)
  const newButton = useRef<HTMLButtonElement>(null)

  const loadTenants = useCallback((signal: AbortSignal) => {
    return apiFetch<Tenant[]>('/api/tenants', { signal }).then(data => {
      if (!signal.aborted) setTenants(data)
    }).catch(() => {
      if (!signal.aborted) setLoadError('No se pudieron cargar las veterinarias. Intenta recargar la lista.')
    }).finally(() => {
      if (!signal.aborted) setLoading(false)
    })
  }, [])

  useEffect(() => {
    active.current = true
    const controller = new AbortController()
    loadController.current = controller
    void loadTenants(controller.signal)
    return () => {
      active.current = false
      loadController.current?.abort()
    }
  }, [loadTenants])

  const reload = () => {
    if (savingRef.current) return
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setLoading(true)
    setLoadError('')
    void loadTenants(controller.signal)
  }

  const clearForm = () => {
    setNombre('')
    setAdminEmail('')
    setAdminPassword('')
    setTelefono('')
    setDireccion('')
    setFormError('')
  }

  const cancel = () => {
    if (savingRef.current) return
    clearForm()
    setFormOpen(false)
    requestAnimationFrame(() => newButton.current?.focus())
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current) return
    if (!nombre.trim() || !adminEmail.trim() || adminPassword.length < 8) {
      setFormError('Completa el nombre, el correo y una contraseña temporal de al menos 8 caracteres.')
      return
    }
    savingRef.current = true
    loadController.current?.abort()
    setLoading(false)
    setSaving(true)
    setFormError('')
    setSuccess('')

    try {
      const { tenant } = await apiFetch<CreateTenantResponse>('/api/tenants', {
        method: 'POST',
        body: JSON.stringify({ nombre: nombre.trim(), adminEmail: adminEmail.trim(), adminPassword, telefono: telefono.trim() || null, direccion: direccion.trim() || null }),
      })
      if (!active.current) return
      setTenants(previous => [tenant, ...previous.filter(item => item.id_veterinaria !== tenant.id_veterinaria)])
      setSuccess(`Veterinaria «${tenant.nombre}» creada. Administrador: ${tenant.adminEmail || adminEmail.trim()}. Ya puede ingresar desde el inicio de sesión habitual.`)
      clearForm()
      setFormOpen(false)
      requestAnimationFrame(() => newButton.current?.focus())
    } catch (cause) {
      if (active.current) setFormError(cause instanceof Error ? cause.message : 'No se pudo registrar la veterinaria.')
    } finally {
      savingRef.current = false
      if (active.current) setSaving(false)
    }
  }

  return (
    <div className="tenants-page">
      <div className="tenants-header">
        <div><span className="eyebrow">Administración global</span><h3>Veterinarias</h3><p>Registra clínicas y crea su cuenta de administrador.</p></div>
        <button type="button" className="primary-button" ref={newButton} disabled={formOpen || saving} onClick={() => { clearForm(); setSuccess(''); setFormOpen(true) }}>+ Nueva veterinaria</button>
      </div>

      {success && <p className="tenants-notice success" role="status">{success}</p>}

      {formOpen && (
        <section className="tenant-form-card" aria-labelledby="tenant-form-title">
          <h3 id="tenant-form-title">Registrar veterinaria</h3>
          <p>El administrador utilizará este correo y su contraseña temporal para ingresar.</p>
          <form onSubmit={save} aria-busy={saving}>
            <fieldset disabled={saving}>
              <div className="tenant-fields">
                <div className="tenant-field"><label htmlFor="tenant-name">Nombre de la veterinaria *</label><input autoFocus id="tenant-name" name="nombre" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={150} required /></div>
                <div className="tenant-field"><label htmlFor="tenant-email">Correo del administrador *</label><input id="tenant-email" name="adminEmail" type="email" autoComplete="off" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} maxLength={100} required /></div>
                <div className="tenant-field"><label htmlFor="tenant-password">Contraseña temporal *</label><input id="tenant-password" name="adminPassword" type="password" autoComplete="new-password" aria-describedby="tenant-password-help" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} minLength={8} required /><small id="tenant-password-help">Al menos 8 caracteres.</small></div>
                <div className="tenant-field"><label htmlFor="tenant-phone">Teléfono</label><input id="tenant-phone" name="telefono" type="tel" value={telefono} onChange={e => setTelefono(e.target.value)} maxLength={20} /></div>
                <div className="tenant-field tenant-field-wide"><label htmlFor="tenant-address">Dirección</label><textarea id="tenant-address" name="direccion" value={direccion} onChange={e => setDireccion(e.target.value)} rows={2} /></div>
              </div>
            </fieldset>
            {formError && <p className="tenants-notice error" role="alert">{formError}</p>}
            <div className="tenant-form-actions">
              <button type="button" className="tenant-secondary-button" onClick={cancel} disabled={saving}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Creando veterinaria…' : 'Crear veterinaria'}</button>
            </div>
          </form>
        </section>
      )}

      <section className="tenants-card" aria-labelledby="tenants-list-title" aria-busy={loading}>
        <div className="tenants-card-header"><div><h3 id="tenants-list-title">Veterinarias registradas</h3><span>{loading ? 'Consultando registros…' : `${tenants.length} ${tenants.length === 1 ? 'veterinaria' : 'veterinarias'}`}</span></div><button type="button" className="tenant-secondary-button" onClick={reload} disabled={loading || saving}>Recargar lista</button></div>
        {loading && <p className="tenants-message" role="status">Cargando veterinarias…</p>}
        {loadError && <p className="tenants-notice error" role="alert">{loadError}</p>}
        {!loading && !loadError && tenants.length === 0 && <div className="tenants-empty"><h4>No hay veterinarias registradas</h4><p>Crea la primera veterinaria para comenzar.</p></div>}
        {tenants.length > 0 && <div className="tenants-table-scroll"><table className="tenants-table"><thead><tr><th scope="col">Veterinaria</th><th scope="col">Administrador</th><th scope="col">Teléfono</th><th scope="col">Dirección</th></tr></thead><tbody>{tenants.map(tenant => <tr key={tenant.id_veterinaria}><th scope="row">{tenant.nombre}</th><td>{tenant.adminEmail || 'Sin administrador registrado'}</td><td>{tenant.telefono || '—'}</td><td>{tenant.direccion || '—'}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  )
}

export default Tenants
