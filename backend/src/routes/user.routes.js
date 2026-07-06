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

router.use(authenticate);

router.get('/members', userController.members);
router.get('/processors', userController.processors);
router.get('/leaderboard', userController.leaderboard);
router.get('/', requireRole(ROLES.ADMIN), validate(listUsersSchema), userController.list);
router.get('/:id', validate(getUserSchema), userController.getById);
router.put('/:id', validate(updateUserSchema), userController.update);
router.delete('/:id', requireRole(ROLES.ADMIN), validate(deleteUserSchema), userController.remove);

export default router;
