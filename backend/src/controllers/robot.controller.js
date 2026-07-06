import { robotService } from '../services/robot.service.js';
import { taskService } from '../services/task.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { serialize } from '../utils/serialize.js';

export const robotController = {
  list: asyncHandler(async (_req, res) => {
    res.json({ success: true, data: serialize(await robotService.list()) });
  }),

  get: asyncHandler(async (req, res) => {
    res.json({ success: true, data: serialize(await robotService.get(req.params.id)) });
  }),

  create: asyncHandler(async (req, res) => {
    const result = await robotService.create(req.body, req.user);
    res.status(201).json({ success: true, data: serialize(result) });
  }),

  update: asyncHandler(async (req, res) => {
    res.json({ success: true, data: serialize(await robotService.update(req.params.id, req.body, req.user)) });
  }),

  listSubsystems: asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: serialize(await robotService.listSubsystems(req.params.robotId)),
    });
  }),

  getSubsystem: asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: serialize(await robotService.getSubsystem(req.params.subsystemId)),
    });
  }),

  createSubsystem: asyncHandler(async (req, res) => {
    const result = await robotService.createSubsystem(req.params.robotId, req.body, req.user);
    res.status(201).json({ success: true, data: serialize(result) });
  }),

  updateSubsystem: asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: serialize(await robotService.updateSubsystem(req.params.subsystemId, req.body, req.user)),
    });
  }),

  subsystemTasks: asyncHandler(async (req, res) => {
    const result = await taskService.list(
      { ...req.validatedQuery, subsystemId: req.params.subsystemId, includeSubsystemCompleted: true },
      req.user,
    );
    res.json({ success: true, data: serialize(result) });
  }),
};
