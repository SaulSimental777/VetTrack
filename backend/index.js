require('dotenv').config()

const express = require('express')
const cors = require('cors')
const supabase = require('./config/supabase')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.json({
    mensaje: 'Backend de VetTrack funcionando correctamente',
  })
})

app.get('/api/prueba-supabase', async (req, res) => {
  const { data, error } = await supabase
    .from('veterinaria')
    .select('id_veterinaria, nombre')
    .limit(10)

  if (error) {
    return res.status(500).json({
      error: error.message,
    })
  }

  res.json({
    mensaje: 'Node.js conectado correctamente con Supabase',
    veterinarias: data,
  })
})

app.listen(PORT, () => {
  console.log(`VetTrack Backend ejecutándose en http://localhost:${PORT}`)
})