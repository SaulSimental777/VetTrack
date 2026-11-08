require('dotenv').config()

const express = require('express')
const cors = require('cors')

const duenosRoutes = require('./routes/duenos.routes')
const tenantsRoutes = require('./routes/tenants.routes')
const pacientesRoutes = require('./routes/pacientes.routes')
const usuariosRoutes = require('./routes/usuarios.routes')
const especialidadesRoutes = require('./routes/especialidades.routes')
const sesionRoutes = require('./routes/sesion.routes')
const medicosRoutes = require('./routes/medicos.routes')
const serviciosRoutes = require('./routes/servicios.routes')
const citasRoutes = require('./routes/citas.routes')
const clinicalRoutes = require('./routes/clinical.routes')

const app = express()
const PORT = process.env.PORT || 3000

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  })
)

app.use(express.json({ limit: '512kb' }))

app.get('/', (req, res) => {
  res.json({
    mensaje: 'Backend de VetTrack funcionando correctamente',
  })
})

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    servicio: 'VetTrack API',
  })
})

app.use('/api/duenos', duenosRoutes)
app.use('/api/tenants', tenantsRoutes)
app.use('/api/pacientes', pacientesRoutes)
app.use('/api/usuarios', usuariosRoutes)
app.use('/api/especialidades', especialidadesRoutes)
app.use('/api/sesion', sesionRoutes)
app.use('/api/medicos', medicosRoutes)
app.use('/api/servicios', serviciosRoutes)
app.use('/api/citas', citasRoutes)
app.use('/api/clinica', clinicalRoutes)
app.use('/api/inventario', require('./routes/inventory.routes'))
app.use('/api/operacion', require('./routes/final-operations.routes'))
app.use('/api/plataforma', require('./routes/platform.routes'))
app.use('/api/archivos', require('./routes/files.routes'))
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Los datos enviados superan el tamaño permitido.' })
  if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'El cuerpo JSON no es válido.' })
  return res.status(500).json({ error: 'Error interno de la API.' })
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`VetTrack Backend ejecutándose en http://localhost:${PORT}`)
  })
}

module.exports = app
