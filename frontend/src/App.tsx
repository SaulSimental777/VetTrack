import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [mensaje, setMensaje] = useState('Conectando con Supabase...')

  useEffect(() => {
    const probarConexion = async () => {
      const { data, error } = await supabase
        .from('veterinaria')
        .select('id_veterinaria, nombre')
        .limit(1)

      if (error) {
        setMensaje(`Error de conexion: ${error.message}`)
        return
      }

      if (data && data.length > 0) {
        setMensaje(`Supabase conectado. Veterinaria: ${data[0].nombre}`)
      } else {
        setMensaje('Supabase conectado. No hay veterinarias registradas.')
      }
    }

    probarConexion()
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f4f7f6',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '15px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          textAlign: 'center',
          maxWidth: '600px',
        }}
      >
        <h1>VetTrack</h1>

        <h2>Prueba de conexion</h2>

        <p>{mensaje}</p>

        <hr />

        <p>Frontend: React + TypeScript + Vite</p>
        <p>Base de datos: Supabase PostgreSQL</p>
        <p>Arquitectura: Multi-Tenant</p>
      </div>
    </div>
  )
}

export default App