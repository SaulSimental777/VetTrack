const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const { loadClinicAccess, requirePermission, requireAnyPermission } = require('../middleware/permissions')
const { obtenerServicios, guardarServicio, eliminarServicio } = require('../controllers/servicios.controller')

const router = express.Router()
router.use(autenticarUsuario, loadClinicAccess)
router.get('/', requirePermission('servicios.ver'), obtenerServicios)
router.post('/', requirePermission('servicios.crear'), guardarServicio)
router.put('/:id', requireAnyPermission('servicios.editar', 'servicios.editar_precio'), guardarServicio)
router.delete('/:id', requirePermission('servicios.eliminar'), eliminarServicio)
module.exports = router
