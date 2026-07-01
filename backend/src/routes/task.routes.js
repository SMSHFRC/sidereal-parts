import { Router } from 'express';
import { taskController } from '../controllers/task.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import {
  createTaskSchema,
  listTasksSchema,
  getTaskSchema,
  updateTaskSchema,
  updateStatusSchema,
  deleteTaskSchema,
} from '../validators/task.schema.js';

const router = Router();

router.use(authenticate);

// 建立/編輯/刪除：admin 或 designer；狀態變更由 service 依擁有權判斷（processor 走此路由）
router.post('/', requireRole(ROLES.ADMIN, ROLES.DESIGNER), validate(createTaskSchema), taskController.create);
router.get('/', validate(listTasksSchema), taskController.list);
router.get('/:id', validate(getTaskSchema), taskController.getById);
router.put('/:id', requireRole(ROLES.ADMIN, ROLES.DESIGNER), validate(updateTaskSchema), taskController.update);
router.patch('/:id/status', validate(updateStatusSchema), taskController.updateStatus);
router.delete('/:id', requireRole(ROLES.ADMIN, ROLES.DESIGNER), validate(deleteTaskSchema), taskController.remove);

export default router;
