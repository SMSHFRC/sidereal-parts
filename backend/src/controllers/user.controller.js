import { userService } from '../services/user.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { serialize } from '../utils/serialize.js';

export const userController = {
  members: asyncHandler(async (_req, res) => {
    const result = await userService.listMembers();
    res.json({ success: true, data: serialize(result) });
  }),

  processors: asyncHandler(async (_req, res) => {
    const result = await userService.listProcessors();
    res.json({ success: true, data: serialize(result) });
  }),

  list: asyncHandler(async (req, res) => {
    const result = await userService.list(req.validatedQuery);
    res.json({ success: true, data: serialize(result) });
  }),

  getById: asyncHandler(async (req, res) => {
    const result = await userService.getById(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  update: asyncHandler(async (req, res) => {
    const result = await userService.update(req.params.id, req.body, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  remove: asyncHandler(async (req, res) => {
    const result = await userService.remove(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),
};
