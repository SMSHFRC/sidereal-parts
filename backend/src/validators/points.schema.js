import { z } from 'zod';

export const transferSchema = {
  body: z.object({
    toUserId: z.coerce.bigint(),
    points: z.coerce.number().int().positive().max(1_000_000),
    note: z.string().trim().max(255).optional(),
  }),
};

export const ledgerQuerySchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
};

export const transfersQuerySchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    direction: z.enum(['sent', 'received', 'all']).default('all'),
  }),
};
