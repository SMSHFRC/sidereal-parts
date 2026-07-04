import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import {
  listUsersSchema,
  getUserSchema,
  updateUserSchema,
  deleteUserSchema,
} from '../validators/user.schema.js';

const router = Router();

router.use(authenticate); // 以下皆需登入

// member 清單：登入即可查（admin 後門指派用）。必須放在 /:id 之前。
router.get('/members', userController.members);
// 舊前端相容 alias。
router.get('/processors', userController.processors);
router.get('/', requireRole(ROLES.ADMIN), validate(listUsersSchema), userController.list);
router.get('/:id', validate(getUserSchema), userController.getById); // 本人或 admin（service 內判斷）
router.put('/:id', validate(updateUserSchema), userController.update);
router.delete('/:id', requireRole(ROLES.ADMIN), validate(deleteUserSchema), userController.remove);

export default router;
