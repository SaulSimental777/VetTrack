import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { usePermissions } from '../lib/permissions'
import './Duenos.css'
import OwnerDetail from '../components/OwnerDetail'
import type { PageResult } from '../lib/platform'

interface Dueno {
  id_dueno: string
  nombre: string
  telefono: string | null
  correo: string | null
  direccion: string | null
  total_pacientes?: number | null
  pacientes?: { id_mascota: string; nombre: string }[]
}

function Duenos() {
  const { can } = usePermissions()
  const [duenos, setDuenos] = useState<Dueno[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [busqueda, setBusqueda] = useState('')
  const [offset,setOffset]=useState(0),[hasMore,setHasMore]=useState(false),[serverSummary,setServerSummary]=useState(false)
  const [detail,setDetail]=useState<string|null>(new URLSearchParams(location.hash.split('?')[1]||'').get('propietario'))
  const ownersEndpoint=`/api/duenos?resumen=1&offset=${offset}&q=${encodeURIComponent(busqueda)}`
  const assignOwners=(data:Dueno[]|PageResult<Dueno>)=>{setServerSummary(!Array.isArray(data));setDuenos(Array.isArray(data)?data:data.filas);setHasMore(!Array.isArray(data)&&data.hay_mas)}

  const [modalAbierto, setModalAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [duenoEditando, setDuenoEditando] = useState<Dueno | null>(null)

  const [duenoEliminando, setDuenoEliminando] = useState<Dueno | null>(null)
  const [eliminando, setEliminando] = useState(false)

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [correo, setCorreo] = useState('')
  const [direccion, setDireccion] = useState('')

const cargarDuenos = async () => {
  setLoading(true)
  setError('')

  try {
    const data =
      await apiFetch<Dueno[]|PageResult<Dueno>>(ownersEndpoint)

    assignOwners(data)
  } catch (error) {
    console.error(
      'Error al cargar dueños:',
      error
    )

    setError(
      'No se pudieron cargar los propietarios.'
    )
  } finally {
    setLoading(false)
  }
}

  useEffect(() => {
    const controller = new AbortController()

    apiFetch<Dueno[]|PageResult<Dueno>>(ownersEndpoint, { signal: controller.signal })
      .then(data => {
        { if (!controller.signal.aborted) { setServerSummary(!Array.isArray(data));setDuenos(Array.isArray(data)?data:data.filas);setHasMore(!Array.isArray(data)&&data.hay_mas) } }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('No se pudieron cargar los propietarios.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [ownersEndpoint])

  const limpiarFormulario = () => {
    setNombre('')
    setTelefono('')
    setCorreo('')
    setDireccion('')
  }

  const abrirModal = () => {
  if (!can('propietarios.crear')) return
  setDuenoEditando(null)
  limpiarFormulario()
  setError('')
  setModalAbierto(true)
}

  const abrirModalEditar = (dueno: Dueno) => {
  if (!can('propietarios.editar')) return
  setDuenoEditando(dueno)

  setNombre(dueno.nombre)
  setTelefono(dueno.telefono ?? '')
  setCorreo(dueno.correo ?? '')
  setDireccion(dueno.direccion ?? '')

  setError('')
  setModalAbierto(true)
}

  const cerrarModal = () => {
  if (guardando) return

  setModalAbierto(false)
  setDuenoEditando(null)
  setError('')
  limpiarFormulario()
}

  const duenosFiltrados = serverSummary ? duenos : duenos.filter((dueno) => {
  const texto = busqueda.toLowerCase().trim()

  return (
    dueno.nombre.toLowerCase().includes(texto) ||
    dueno.telefono?.toLowerCase().includes(texto) ||
    dueno.correo?.toLowerCase().includes(texto) ||
    dueno.direccion?.toLowerCase().includes(texto)
  )
})

  const guardarDueno = async (
  e: React.FormEvent
) => {
  e.preventDefault()
  if (!can(duenoEditando ? 'propietarios.editar' : 'propietarios.crear')) return

  if (!nombre.trim()) {
    setError(
      'El nombre del propietario es obligatorio.'
    )
    return
  }

  setGuardando(true)
  setError('')

  const datosDueno = {
    nombre: nombre.trim(),
    telefono: telefono.trim(),
    correo: correo.trim(),
    direccion: direccion.trim(),
  }

  try {
    if (duenoEditando) {
      await apiFetch(
        `/api/duenos/${duenoEditando.id_dueno}`,
        {
          method: 'PUT',
          body: JSON.stringify(datosDueno),
        }
      )
    } else {
      await apiFetch('/api/duenos', {
        method: 'POST',
        body: JSON.stringify(datosDueno),
      })
    }

    setModalAbierto(false)
    setDuenoEditando(null)

    limpiarFormulario()

    await cargarDuenos()
  } catch (error) {
    console.error(
      'Error al guardar dueño:',
      error
    )

    setError(
      error instanceof Error
        ? error.message
        : 'No se pudo guardar el propietario.'
    )
  } finally {
    setGuardando(false)
  }
}

const eliminarDueno = async () => {
  if (!duenoEliminando || !can('propietarios.eliminar')) return

  setEliminando(true)
  setError('')

  try {
    await apiFetch(
      `/api/duenos/${duenoEliminando.id_dueno}`,
      {
        method: 'DELETE',
      }
    )

    setDuenoEliminando(null)

    await cargarDuenos()
  } catch (error) {
    console.error(
      'Error al eliminar dueño:',
      error
    )

    setError(
      error instanceof Error
        ? error.message
        : 'No se pudo eliminar el propietario.'
    )
  } finally {
    setEliminando(false)
  }
}

  return (
    <div className="duenos-page">
      <div className="duenos-header">
        <div>
          <span className="eyebrow">Clínica / Propietarios</span>
          <h3>Propietarios</h3>
          <p>
            Administra los propietarios registrados en tu clínica.
          </p>
        </div>

        {can('propietarios.crear') && <button
          className="primary-button"
          onClick={abrirModal}
        >
          + Nuevo propietario
        </button>}
      </div>

      <div className="duenos-card">
        <div className="duenos-card-header">
          <div>
            <strong>Propietarios registrados</strong>
            <span>{duenos.length} registros</span>
          </div>

             <input
                className="duenos-search"
                type="search"
                aria-label="Buscar propietario o paciente relacionado"
                placeholder="Nombre, teléfono o inicio del nombre de paciente"
                value={busqueda}
                onChange={(e) => {setBusqueda(e.target.value);setOffset(0)}}
                />
            </div>

        {loading && (
          <div className="duenos-message">
            Cargando propietarios...
          </div>
        )}

        {error && !modalAbierto && (
          <div className="duenos-message error">
            {error}
          </div>
        )}

        {!loading && !error && duenos.length === 0 && (
          <div className="duenos-empty">
            <div className="duenos-empty-icon">♙</div>

            <h4>No hay propietarios registrados</h4>

            <p>
              Esta clínica todavía no tiene propietarios registrados.
            </p>

            {can('propietarios.crear') && <button
              className="primary-button"
              onClick={abrirModal}
            >
              + Registrar primer propietario
            </button>}
          </div>
        )}

        {!loading && duenos.length > 0 && (
          <div className="duenos-table-wrapper">
            <table className="duenos-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono</th>
                  <th>Correo</th>
                  <th>Dirección</th>
                  <th>Pacientes</th><th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {duenosFiltrados.map((dueno) => (
                  <tr key={dueno.id_dueno}>
                    <td>
                      <div className="dueno-name">
                        <div className="dueno-avatar">
                          {dueno.nombre.charAt(0).toUpperCase()}
                        </div>

                        <strong>{dueno.nombre}</strong>
                      </div>
                    </td>

                    <td>{dueno.telefono || '—'}</td>
                    <td>{dueno.correo || '—'}</td>
                    <td>{dueno.direccion || '—'}</td>
                    <td className="owner-patient-summary">{dueno.total_pacientes == null ? 'Sin información de pacientes' : dueno.total_pacientes === 0 ? 'Sin pacientes' : <>{dueno.pacientes?.map(p=>p.nombre).join(', ')}{dueno.total_pacientes>2?` + ${dueno.total_pacientes-2} más`:''}<br/><small>{dueno.total_pacientes} {dueno.total_pacientes===1?'paciente':'pacientes'}</small></>}</td>

                    <td>
                      <div className="dueno-actions">
                       <button type="button" onClick={()=>setDetail(dueno.id_dueno)}>Ver</button>{can('propietarios.editar') && <button onClick={() => abrirModalEditar(dueno)}>Editar</button>}

                        {can('propietarios.eliminar') && <button
                        className="danger"
                        onClick={() => setDuenoEliminando(dueno)}
                        >
                        Eliminar
                        </button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

<div className="operations-toolbar"><button type="button" className="users-secondary-button" disabled={!offset||loading} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Anterior</button><span>Página {offset/25+1}</span><button type="button" className="users-secondary-button" disabled={!hasMore||loading} onClick={()=>setOffset(n=>n+25)}>Siguiente</button></div>{detail&&<OwnerDetail id={detail} onClose={()=>setDetail(null)} onChanged={()=>void cargarDuenos()}/>}
      {modalAbierto && (
        <div className="modal-overlay">
          <div className="dueno-modal">

            <div className="modal-header">
              <div>
                <span className="eyebrow">
                    {duenoEditando ? 'Editar registro' : 'Nuevo registro'}
                </span>

                <h3>
                    {duenoEditando ? 'Editar propietario' : 'Registrar propietario'}
                </h3>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={cerrarModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={guardarDueno}>
              <div className="modal-body">

                <div className="form-group">
                  <label>Nombre *</label>

                  <input
                    type="text"
                    placeholder="Nombre completo"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Teléfono</label>

                    <input
                      type="text"
                      placeholder="664 000 0000"
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Correo</label>

                    <input
                      type="email"
                      placeholder="correo@ejemplo.com"
                      value={correo}
                      onChange={(e) => setCorreo(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Dirección</label>

                  <textarea
                    placeholder="Dirección del propietario"
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                  />
                </div>

                {error && (
                  <div className="modal-error">
                    {error}
                  </div>
                )}

              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={cerrarModal}
                  disabled={guardando}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={guardando}
                >
                 {guardando
                    ? 'Guardando...'
                    : duenoEditando
                        ? 'Guardar cambios'
                        : 'Guardar propietario'}
                </button>
              </div>
                      </form>

        </div>
      </div>
    )}

    {duenoEliminando && (
      <div className="modal-overlay">
        <div className="delete-modal">

          <div className="delete-icon">
            !
          </div>

          <h3>Eliminar propietario</h3>

          <p>
            ¿Estás seguro de que deseas eliminar a
            <strong> {duenoEliminando.nombre}</strong>?
          </p>

          <span className="delete-warning">
            Esta acción no se puede deshacer.
          </span>

          <div className="delete-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setDuenoEliminando(null)}
              disabled={eliminando}
            >
              Cancelar
            </button>

            <button
              type="button"
              className="delete-button"
              onClick={eliminarDueno}
              disabled={eliminando}
            >
              {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
            </button>
          </div>

        </div>
      </div>
    )}

  </div>
)
}

export default Duenos
