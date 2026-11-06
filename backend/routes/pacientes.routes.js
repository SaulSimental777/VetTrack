const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const { obtenerPacientes, crearPaciente, actualizarPaciente, eliminarPaciente } = require('../controllers/pacientes.controller')

const router = express.Router()
router.use(autenticarUsuario)
router.get('/', obtenerPacientes)
router.post('/', crearPaciente)
router.put('/:id', actualizarPaciente)
router.delete('/:id', eliminarPaciente)
module.exports = router
