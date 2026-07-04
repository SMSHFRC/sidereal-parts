import { Router } from 'express';
import { pointsController } from '../controllers/points.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import {
  transferSchema,
  ledgerQuerySchema,
  transfersQuerySchema,
} from '../validators/points.schema.js';

const router = Router();

router.use(authenticate);

// 轉讓：member 本人發起（admin 也可）
router.post(
  '/transfer',
  requireRole(ROLES.MEMBER, ROLES.ADMIN),
  validate(transferSchema),
  pointsController.transfer,
);

// 我的積分明細 / 轉讓紀錄
router.get('/me/ledger', validate(ledgerQuerySchema), pointsController.myLedger);
router.get('/me/transfers', validate(transfersQuerySchema), pointsController.myTransfers);

export default router;
