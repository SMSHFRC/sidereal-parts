import { metaService } from '../services/meta.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const metaController = {
  options: asyncHandler(async (_req, res) => {
    const result = await metaService.options();
    res.json({ success: true, data: result });
  }),

  listMaster: asyncHandler(async (req, res) => {
    const result = await metaService.listMaster(req.params.type);
    res.json({ success: true, data: result });
  }),

  createMaster: asyncHandler(async (req, res) => {
    const result = await metaService.createMaster(req.params.type, req.body);
    res.status(201).json({ success: true, data: result });
  }),

  updateMaster: asyncHandler(async (req, res) => {
    const result = await metaService.updateMaster(req.params.type, req.params.id, req.body);
    res.json({ success: true, data: result });
  }),
};
