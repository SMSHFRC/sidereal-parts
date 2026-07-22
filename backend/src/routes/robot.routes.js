import { Router } from 'express';
import { robotController } from '../controllers/robot.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import {
  createRobotSchema,
  updateRobotSchema,
  getRobotSchema,
  listSubsystemsSchema,
  createSubsystemSchema,
  getSubsystemSchema,
  updateSubsystemSchema,
} from '../validators/robot.schema.js';
import { listTasksSchema } from '../validators/task.schema.js';

const router = Router();

router.use(authenticate);

router.get('/', robotController.list);
router.post('/', requireRole(ROLES.ADMIN), validate(createRobotSchema), robotController.create);
router.get('/subsystems/:subsystemId', validate(getSubsystemSchema), robotController.getSubsystem);
router.patch(
  '/subsystems/:subsystemId',
  requireRole(ROLES.ADMIN),
  validate(updateSubsystemSchema),
  robotController.updateSubsystem,
);
router.delete(
  '/subsystems/:subsystemId/contents',
  requireRole(ROLES.ADMIN),
  validate(getSubsystemSchema),
  robotController.clearSubsystemContents,
);
router.get(
  '/subsystems/:subsystemId/tasks',
  validate({ ...getSubsystemSchema, query: listTasksSchema.query }),
  robotController.subsystemTasks,
);
router.get('/:robotId/subsystems', validate(listSubsystemsSchema), robotController.listSubsystems);
router.post(
  '/:robotId/subsystems',
  requireRole(ROLES.ADMIN),
  validate(createSubsystemSchema),
  robotController.createSubsystem,
);
router.get('/:id', validate(getRobotSchema), robotController.get);
router.patch('/:id', requireRole(ROLES.ADMIN), validate(updateRobotSchema), robotController.update);

export default router;
