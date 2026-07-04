import { metaService } from '../services/meta.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const metaController = {
  options: asyncHandler(async (_req, res) => {
    const result = await metaService.options();
    res.json({ success: true, data: result });
  }),
};
