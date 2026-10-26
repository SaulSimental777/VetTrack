const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const exigirSuperAdmin = require('../middleware/superAdmin')
const { obtenerTenants, crearTenant } = require('../controllers/tenants.controller')

const router = express.Router()

router.use(autenticarUsuario, exigirSuperAdmin)
router.get('/', obtenerTenants)
router.post('/', crearTenant)

module.exports = router
