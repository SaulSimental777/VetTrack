const express = require('express')
const auth = require('../middleware/auth')
const { loadClinicAccess } = require('../middleware/permissions')
const { execute } = require('../controllers/final-operations.controller')
const router = express.Router()
router.use(auth, loadClinicAccess)
router.get('/:operacion', execute)
router.post('/:operacion', execute)
module.exports = router
