import { Router } from 'express';
import { metaController } from '../controllers/meta.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.get('/options', metaController.options);

export default router;
