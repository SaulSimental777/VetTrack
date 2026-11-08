const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const { loadClinicAccess } = require('../middleware/permissions')

const router = express.Router()
router.get('/', autenticarUsuario, loadClinicAccess, async (req, res) => {
  try {
    const { data, error } = await req.supabase.rpc('vettrack_plataforma', { p_operacion: 'sesion_plataforma', p_datos: {} })
    if (error || !data) return res.status(403).json({ error: 'No se pudo obtener la clínica asignada.' })
    return res.json({ ...req.clinicAccess, nombre_veterinaria: data.nombre_veterinaria, estado: data.estado, logo_archivo: data.logo_archivo })
  } catch {
    return res.status(503).json({ error: 'No se pudo cargar la sesión de la clínica.' })
  }
})

module.exports = router
