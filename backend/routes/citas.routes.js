const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const { loadClinicAccess, requirePermission, requireAnyPermission } = require('../middleware/permissions')
const { obtenerCitas, obtenerSelectoresCitas, guardarCita, cancelarCita } = require('../controllers/citas.controller')

const router = express.Router()
router.use(autenticarUsuario, loadClinicAccess)
router.get('/selectores', requireAnyPermission('citas.crear', 'citas.editar'), obtenerSelectoresCitas)
router.get('/', requirePermission('citas.ver'), obtenerCitas)
router.post('/', requirePermission('citas.crear'), guardarCita)
router.put('/:id', requirePermission('citas.editar'), guardarCita)
router.patch('/:id/cancelar', requirePermission('citas.cancelar'), cancelarCita)
module.exports = router
