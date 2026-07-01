import { pointsService } from '../services/points.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { serialize } from '../utils/serialize.js';

export const pointsController = {
  transfer: asyncHandler(async (req, res) => {
    const result = await pointsService.transfer(req.user.id, req.body);
    res.status(201).json({ success: true, data: serialize(result) });
  }),

  myLedger: asyncHandler(async (req, res) => {
    const result = await pointsService.myLedger(req.user.id, req.validatedQuery);
    res.json({ success: true, data: serialize(result) });
  }),

  myTransfers: asyncHandler(async (req, res) => {
    const result = await pointsService.myTransfers(req.user.id, req.validatedQuery);
    res.json({ success: true, data: serialize(result) });
  }),
};
