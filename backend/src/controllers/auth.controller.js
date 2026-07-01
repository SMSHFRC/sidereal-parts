import { authService } from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { serialize } from '../utils/serialize.js';

export const authController = {
  register: asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    res.status(201).json({ success: true, data: serialize(result) });
  }),

  login: asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.json({ success: true, data: serialize(result) });
  }),

  refresh: asyncHandler(async (req, res) => {
    const result = await authService.refresh(req.body);
    res.json({ success: true, data: serialize(result) });
  }),

  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.body);
    res.json({ success: true, data: { message: '已登出' } });
  }),

  me: asyncHandler(async (req, res) => {
    const result = await authService.me(req.user.id);
    res.json({ success: true, data: serialize(result) });
  }),
};
