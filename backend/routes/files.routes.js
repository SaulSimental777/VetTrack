const express=require('express'),router=express.Router()
const auth=require('../middleware/auth'),c=require('../controllers/files.controller')
router.use(auth)
router.post('/',c.prepare)
router.post('/:id/contenido',express.raw({type:'*/*',limit:'10mb'}),c.upload)
router.get('/:id',c.view)
router.get('/:id/info',c.info)
router.delete('/:id',c.remove)
module.exports=router
