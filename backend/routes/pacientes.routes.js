const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const { loadClinicAccess, requirePermission, requireAnyPermission } = require('../middleware/permissions')
const { obtenerPacientes, obtenerPropietariosPacientes, crearPaciente, actualizarPaciente, eliminarPaciente } = require('../controllers/pacientes.controller')

const router = express.Router()
router.use(autenticarUsuario)
router.use(loadClinicAccess)
router.get('/propietarios', requireAnyPermission('pacientes.ver', 'pacientes.crear', 'pacientes.editar'), obtenerPropietariosPacientes)
router.get('/', requirePermission('pacientes.ver'), obtenerPacientes)
router.post('/', requirePermission('pacientes.crear'), crearPaciente)
router.put('/:id', requirePermission('pacientes.editar'), actualizarPaciente)
router.delete('/:id', requirePermission('pacientes.eliminar'), eliminarPaciente)
module.exports = router
