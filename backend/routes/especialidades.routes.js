const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const { loadClinicAccess, requirePermission, requireAnyPermission } = require('../middleware/permissions')
const { obtenerEspecialidades, guardarEspecialidad } = require('../controllers/especialidades.controller')

const router = express.Router()
router.use(autenticarUsuario, loadClinicAccess)
// Selectors are also available to a delegated creator/editor without usuarios.ver.
router.get('/', requireAnyPermission('usuarios.ver', 'usuarios.crear', 'usuarios.editar'), obtenerEspecialidades)
router.post('/', requirePermission('usuarios.crear'), guardarEspecialidad)
router.put('/:id', requirePermission('usuarios.editar'), guardarEspecialidad)
module.exports = router
