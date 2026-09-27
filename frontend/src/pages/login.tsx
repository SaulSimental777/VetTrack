import { useState } from 'react'
import { supabase } from '../lib/supabase'
import './login.css'

interface LoginProps {
  onLogin: () => void
}

function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError('Correo o contraseña incorrectos.')
      setLoading(false)
      return
    }

    setLoading(false)
    onLogin()
  }

  return (
    <div className="login-page">
      <div className="login-container">

        <div className="login-brand">
          <div className="login-logo">V</div>

          <h1>VetTrack</h1>

          <p>
            Sistema Multi-Tenant para la gestión
            de clínicas veterinarias.
          </p>

          <div className="login-feature">
            <span>✓</span>
            Gestión de pacientes
          </div>

          <div className="login-feature">
            <span>✓</span>
            Control de citas
          </div>

          <div className="login-feature">
            <span>✓</span>
            Historial médico
          </div>

          <div className="login-feature">
            <span>✓</span>
            Arquitectura Multi-Tenant
          </div>
        </div>

        <div className="login-card">

          <div className="login-header">
            <span>Bienvenido</span>
            <h2>Iniciar sesión</h2>

            <p>
              Ingresa tus credenciales para acceder
              a tu clínica veterinaria.
            </p>
          </div>

          <form onSubmit={handleLogin}>

            <div className="form-group">
              <label>Correo electrónico</label>

              <input
                type="email"
                placeholder="correo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Contraseña</label>

              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            <button
              className="login-button"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </button>

          </form>

          <div className="login-footer">
            <span>VetTrack</span>
            <p>Gestión veterinaria segura y centralizada</p>
          </div>

        </div>

      </div>
    </div>
  )
}

export default Login