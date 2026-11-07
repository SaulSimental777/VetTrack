const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const { loadClinicAccess, requireAnyPermission } = require('../middleware/permissions')
const { obtenerEspecialidades, guardarEspecialidad } = require('../controllers/especialidades.controller')

const router = express.Router()
router.use(autenticarUsuario, loadClinicAccess)
// Selectors are also available to a delegated creator/editor without usuarios.ver.
router.get('/', requireAnyPermission('usuarios.ver', 'usuarios.crear', 'usuarios.editar', 'medicos.ver', 'medicos.administrar', 'servicios.ver', 'servicios.crear', 'servicios.editar'), obtenerEspecialidades)
router.post('/', requireAnyPermission('usuarios.crear', 'medicos.administrar'), guardarEspecialidad)
router.put('/:id', requireAnyPermission('usuarios.editar', 'medicos.administrar'), guardarEspecialidad)
module.exports = router
