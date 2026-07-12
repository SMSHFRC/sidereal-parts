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

  simulateTimeout: asyncHandler(async (req, res) => {
    const result = await taskService.simulateTimeout(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  extendMachiningTime: asyncHandler(async (req, res) => {
    const result = await taskService.extendMachiningTime(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  statusReminders: asyncHandler(async (req, res) => {
    const result = await taskService.statusReminders(req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  respondStatusReminder: asyncHandler(async (req, res) => {
    const result = await taskService.respondStatusReminder(req.params.id, req.body, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  printMergeCandidates: asyncHandler(async (req, res) => {
    const result = await taskService.printMergeCandidates(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  startPrintBatch: asyncHandler(async (req, res) => {
    const result = await taskService.startPrintBatch(req.params.id, req.body, req.user);
    res.status(201).json({ success: true, data: serialize(result) });
  }),

  completePrintBatch: asyncHandler(async (req, res) => {
    const result = await taskService.completePrintBatch(req.params.batchId, req.user);
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

  claim: asyncHandler(async (req, res) => {
    const result = await taskService.claim(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  claimPostProcess: asyncHandler(async (req, res) => {
    const result = await taskService.claimPostProcess(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  remove: asyncHandler(async (req, res) => {
    const result = await taskService.remove(req.params.id, req.user);
    res.json({ success: true, data: serialize(result) });
  }),
};
