import { taskService } from '../services/task.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { serialize } from '../utils/serialize.js';

export const taskController = {
  create: asyncHandler(async (req, res) => {
    const result = await taskService.create(req.body, req.user);
    res.status(201).json({ success: true, data: serialize(result) });
  }),

  list: asyncHandler(async (req, res) => {
    const result = await taskService.list(req.validatedQuery, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  getById: asyncHandler(async (req, res) => {
    const result = await taskService.getById(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  update: asyncHandler(async (req, res) => {
    const result = await taskService.update(req.params.id, req.body, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  updateStatus: asyncHandler(async (req, res) => {
    const result = await taskService.updateStatus(req.params.id, req.body, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  remove: asyncHandler(async (req, res) => {
    const result = await taskService.remove(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),
};
