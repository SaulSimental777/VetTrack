const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const { loadClinicAccess, requirePermission } = require('../middleware/permissions')
const {
  obtenerDuenos,
  crearDueno,
  actualizarDueno,
  eliminarDueno,
} = require('../controllers/duenos.controller')

const router = express.Router()

router.use(autenticarUsuario)
router.use(loadClinicAccess)

router.get('/', requirePermission('propietarios.ver'), obtenerDuenos)
router.post('/', requirePermission('propietarios.crear'), crearDueno)
router.put('/:id', requirePermission('propietarios.editar'), actualizarDueno)
router.delete('/:id', requirePermission('propietarios.eliminar'), eliminarDueno)

module.exports = router
