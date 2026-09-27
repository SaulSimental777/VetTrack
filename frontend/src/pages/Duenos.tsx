import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import './Duenos.css'

interface Dueno {
  id_dueno: string
  nombre: string
  telefono: string | null
  correo: string | null
  direccion: string | null
}

function Duenos() {
  const [duenos, setDuenos] = useState<Dueno[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [busqueda, setBusqueda] = useState('')

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
      await apiFetch<Dueno[]>('/api/duenos')

    setDuenos(data)
  } catch (error) {
    console.error(
      'Error al cargar dueños:',
      error
    )

    setError(
      'No se pudieron cargar los dueños.'
    )
  } finally {
    setLoading(false)
  }
}

  useEffect(() => {
    cargarDuenos()
  }, [])

  const limpiarFormulario = () => {
    setNombre('')
    setTelefono('')
    setCorreo('')
    setDireccion('')
  }

  const abrirModal = () => {
  setDuenoEditando(null)
  limpiarFormulario()
  setError('')
  setModalAbierto(true)
}

  const abrirModalEditar = (dueno: Dueno) => {
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

  const duenosFiltrados = duenos.filter((dueno) => {
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

  if (!nombre.trim()) {
    setError(
      'El nombre del dueño es obligatorio.'
    )
    return
  }

  setGuardando(true)
  setError('')

  const datosDueno = {
    nombre: nombre.trim(),
    telefono: telefono.trim() || null,
    correo: correo.trim() || null,
    direccion: direccion.trim() || null,
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
        : 'No se pudo guardar el dueño.'
    )
  } finally {
    setGuardando(false)
  }
}

const eliminarDueno = async () => {
  if (!duenoEliminando) return

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
        : 'No se pudo eliminar el dueño.'
    )
  } finally {
    setEliminando(false)
  }
}

  return (
    <div className="duenos-page">
      <div className="duenos-header">
        <div>
          <span className="eyebrow">Pacientes / Dueños</span>
          <h3>Dueños</h3>
          <p>
            Administra los propietarios registrados en tu clínica.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={abrirModal}
        >
          + Nuevo dueño
        </button>
      </div>

      <div className="duenos-card">
        <div className="duenos-card-header">
          <div>
            <strong>Dueños registrados</strong>
            <span>{duenos.length} registros</span>
          </div>

             <input
                className="duenos-search"
                type="text"
                placeholder="Buscar dueño..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                />
            </div>

        {loading && (
          <div className="duenos-message">
            Cargando dueños...
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

            <h4>No hay dueños registrados</h4>

            <p>
              Esta clínica todavía no tiene propietarios registrados.
            </p>

            <button
              className="primary-button"
              onClick={abrirModal}
            >
              + Registrar primer dueño
            </button>
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
                  <th>Acciones</th>
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

                    <td>
                      <div className="dueno-actions">
                       <button onClick={() => abrirModalEditar(dueno)}>Editar</button>

                        <button
                        className="danger"
                        onClick={() => setDuenoEliminando(dueno)}
                        >
                        Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalAbierto && (
        <div className="modal-overlay">
          <div className="dueno-modal">

            <div className="modal-header">
              <div>
                <span className="eyebrow">
                    {duenoEditando ? 'Editar registro' : 'Nuevo registro'}
                </span>

                <h3>
                    {duenoEditando ? 'Editar dueño' : 'Registrar dueño'}
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
                        : 'Guardar dueño'}
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

          <h3>Eliminar dueño</h3>

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