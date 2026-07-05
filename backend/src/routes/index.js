import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import taskRoutes from './task.routes.js';
import pointsRoutes from './points.routes.js';
import metaRoutes from './meta.routes.js';
import onshapeRoutes from './onshape.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/tasks', taskRoutes);
router.use('/points', pointsRoutes);
router.use('/meta', metaRoutes);
router.use('/onshape', onshapeRoutes);

export default router;
