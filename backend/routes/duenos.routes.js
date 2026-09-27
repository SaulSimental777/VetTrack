const express = require('express')
const autenticarUsuario = require('../middleware/auth')
const {
  obtenerDuenos,
  crearDueno,
  actualizarDueno,
  eliminarDueno,
} = require('../controllers/duenos.controller')

const router = express.Router()

router.use(autenticarUsuario)

router.get('/', obtenerDuenos)
router.post('/', crearDueno)
router.put('/:id', actualizarDueno)
router.delete('/:id', eliminarDueno)

module.exports = router