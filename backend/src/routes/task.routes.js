import { Router } from 'express';
import { taskController } from '../controllers/task.controller.js';
import { onshapeController } from '../controllers/onshape.controller.js';
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
  startPrintBatchSchema,
  printBatchParamSchema,
  reminderResponseSchema,
  updatePrioritySchema,
} from '../validators/task.schema.js';

const router = Router();

router.use(authenticate);

// 建立/編輯/刪除：admin 或 member；狀態變更由 service 依擁有權判斷
router.post('/', requireRole(ROLES.ADMIN, ROLES.MEMBER), validate(createTaskSchema), taskController.create);
router.get('/', validate(listTasksSchema), taskController.list);
router.get('/reminders/status', taskController.statusReminders);
router.post('/print-batches/:batchId/complete', validate(printBatchParamSchema), taskController.completePrintBatch);
router.get('/:id/download', validate(getTaskSchema), onshapeController.downloadTaskFile);
router.post('/:id/simulate-timeout', requireRole(ROLES.ADMIN), validate(getTaskSchema), taskController.simulateTimeout);
router.post('/:id/extend-time', requireRole(ROLES.ADMIN), validate(getTaskSchema), taskController.extendMachiningTime);
router.post('/:id/reminder-response', validate(reminderResponseSchema), taskController.respondStatusReminder);
router.patch('/:id/priority', validate(updatePrioritySchema), taskController.updatePriority);
router.get('/:id/print-merge-candidates', validate(getTaskSchema), taskController.printMergeCandidates);
router.post('/:id/print-batch/start', validate(startPrintBatchSchema), taskController.startPrintBatch);
router.get('/:id', validate(getTaskSchema), taskController.getById);
router.put('/:id', requireRole(ROLES.ADMIN, ROLES.MEMBER), validate(updateTaskSchema), taskController.update);
router.post('/:id/claim', validate(getTaskSchema), taskController.claim);
router.patch('/:id/status', validate(updateStatusSchema), taskController.updateStatus);
router.post('/:id/claim-post-process', validate(getTaskSchema), taskController.claimPostProcess);
router.delete('/:id', requireRole(ROLES.ADMIN, ROLES.MEMBER), validate(deleteTaskSchema), taskController.remove);

export default router;
