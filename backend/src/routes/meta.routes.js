import { Router } from 'express';
import { metaController } from '../controllers/meta.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import {
  createMasterDataSchema,
  masterTypeSchema,
  updateMasterDataSchema,
} from '../validators/meta.schema.js';

const router = Router();

router.use(authenticate);
router.get('/options', metaController.options);
router.get(
  '/admin/:type',
  requireRole(ROLES.ADMIN),
  validate(masterTypeSchema),
  metaController.listMaster,
);
router.post(
  '/admin/:type',
  requireRole(ROLES.ADMIN),
  validate(createMasterDataSchema),
  metaController.createMaster,
);
router.patch(
  '/admin/:type/:id',
  requireRole(ROLES.ADMIN),
  validate(updateMasterDataSchema),
  metaController.updateMaster,
);

export default router;
