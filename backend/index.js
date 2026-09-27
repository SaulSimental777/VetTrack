require('dotenv').config()

const express = require('express')
const cors = require('cors')

const duenosRoutes = require('./routes/duenos.routes')

const app = express()
const PORT = process.env.PORT || 3000

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  })
)

app.use(express.json())

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

app.listen(PORT, () => {
  console.log(`VetTrack Backend ejecutándose en http://localhost:${PORT}`)
})