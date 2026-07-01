import { z } from 'zod';

const idParam = z.object({
  id: z.coerce.bigint({ invalid_type_error: 'id 必須為數字' }),
});

export const getUserSchema = { params: idParam };
export const deleteUserSchema = { params: idParam };

export const updateUserSchema = {
  params: idParam,
  body: z
    .object({
      password: z.string().min(8).max(128).optional(),
      role: z.enum(['admin', 'designer', 'processor']).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: '沒有可更新的欄位' }),
};

export const listUsersSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
};
