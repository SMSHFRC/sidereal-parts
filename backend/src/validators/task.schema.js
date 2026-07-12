import { z } from 'zod';

const idParam = z.object({ id: z.coerce.bigint() });

// drawing_url 僅允許 http/https，避免 javascript: 等惡意 scheme
const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .url('必須是合法 URL')
  .refine((u) => /^https?:\/\//i.test(u), '僅允許 http/https 連結');

export const createTaskSchema = {
  body: z.object({
    systemId: z.coerce.number().int().positive(),
    robotId: z.coerce.bigint().optional(),
    subsystemId: z.coerce.bigint().optional(),
    manufacturingMethodId: z.coerce.number().int().positive(),
    materialId: z.coerce.number().int().positive().optional(),
    postProcessId: z.coerce.number().int().positive().optional(),
    assigneeId: z.coerce.bigint().optional(),
    postProcessorId: z.coerce.bigint().optional(),
    quantity: z.coerce.number().int().positive().max(1_000_000),
    drawingUrl: httpUrl.optional(),
    dimensions: z.string().trim().max(255).optional(),
    note: z.string().trim().max(2000).optional(),
  }),
};

export const updateTaskSchema = {
  params: idParam,
  body: z
    .object({
      manufacturingMethodId: z.coerce.number().int().positive().optional(),
      materialId: z.coerce.number().int().positive().nullable().optional(),
      postProcessId: z.coerce.number().int().positive().nullable().optional(),
      systemId: z.coerce.number().int().positive().optional(),
      robotId: z.coerce.bigint().nullable().optional(),
      subsystemId: z.coerce.bigint().nullable().optional(),
      assigneeId: z.coerce.bigint().nullable().optional(),
      postProcessorId: z.coerce.bigint().nullable().optional(),
      quantity: z.coerce.number().int().positive().max(1_000_000).optional(),
      drawingUrl: httpUrl.nullable().optional(),
      dimensions: z.string().trim().max(255).nullable().optional(),
      note: z.string().trim().max(2000).nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: '沒有可更新的欄位' }),
};

export const updateStatusSchema = {
  params: idParam,
  body: z.object({
    status: z.enum([
      'accepted',
      'processing',
      'post_processing',
      'pending_review',
      'completed',
      'rejected',
      'cancelled',
    ]),
    note: z.string().trim().max(2000).optional(),
  }),
};

export const startPrintBatchSchema = {
  params: idParam,
  body: z.object({
    taskIds: z.array(z.coerce.bigint()).max(100).default([]),
    confirmTransfer: z.coerce.boolean().default(false),
  }),
};

export const printBatchParamSchema = {
  params: z.object({ batchId: z.coerce.bigint() }),
};

export const reminderResponseSchema = {
  params: idParam,
  body: z.object({
    response: z.enum(['still_processing', 'problem']),
  }),
};

export const updatePrioritySchema = {
  params: idParam,
  body: z.object({
    isUrgent: z.boolean(),
    reason: z.string().trim().max(500).nullable().optional(),
  }),
};

export const getTaskSchema = { params: idParam };
export const deleteTaskSchema = { params: idParam };

export const listTasksSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z
      .enum([
        'pending',
        'accepted',
        'processing',
        'post_processing',
        'pending_review',
        'completed',
        'rejected',
        'cancelled',
      ])
      .optional(),
    systemId: z.coerce.number().int().positive().optional(),
    robotId: z.coerce.bigint().optional(),
    subsystemId: z.coerce.bigint().optional(),
    includeSubsystemCompleted: z.coerce.boolean().optional(),
    assigneeId: z.coerce.bigint().optional(),
    scope: z.enum(['pool', 'assigned', 'created', 'all']).optional(),
    board: z.coerce.boolean().optional(),
    mine: z.coerce.boolean().optional(), // 只看與我相關的任務
  }),
};
