const express = require('express')
const auth = require('../middleware/auth')
const { loadClinicAccess } = require('../middleware/permissions')
const controller = require('../controllers/inventory.controller')
const router = express.Router()
router.use(auth, loadClinicAccess)
router.get('/:operacion', controller.execute)
router.post('/:operacion', controller.execute)
module.exports = router
