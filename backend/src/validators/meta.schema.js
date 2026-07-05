import { z } from 'zod';

const masterType = z.enum(['methods', 'materials', 'postProcesses']);
const code = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z0-9_]+$/, 'code can only contain uppercase letters, numbers, and underscore');

export const masterTypeSchema = {
  params: z.object({ type: masterType }),
};

export const createMasterDataSchema = {
  params: z.object({ type: masterType }),
  body: z.object({
    code,
    name: z.string().trim().min(1).max(80),
    isActive: z.boolean().optional(),
  }),
};

export const updateMasterDataSchema = {
  params: z.object({
    type: masterType,
    id: z.coerce.number().int().positive(),
  }),
  body: z
    .object({
      code: code.optional(),
      name: z.string().trim().min(1).max(80).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, { message: 'No update fields provided' }),
};
