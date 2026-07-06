import { z } from 'zod';

const idParam = z.object({ id: z.coerce.bigint() });
const robotIdParam = z.object({ robotId: z.coerce.bigint() });
const subsystemIdParam = z.object({ subsystemId: z.coerce.bigint() });

const code = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/, 'code 只能包含英文、數字、底線與連字號');
const name = z.string().trim().min(1).max(120);
const note = z.string().trim().max(2000).nullable().optional();

export const createRobotSchema = {
  body: z.object({
    code: code.optional(),
    name,
    note,
    isActive: z.boolean().optional(),
  }),
};

export const updateRobotSchema = {
  params: idParam,
  body: z
    .object({
      code: code.optional(),
      name: name.optional(),
      note,
      isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: '沒有可更新欄位' }),
};

export const createSubsystemSchema = {
  params: robotIdParam,
  body: z.object({
    code: code.optional(),
    name,
    note,
    isActive: z.boolean().optional(),
  }),
};

export const updateSubsystemSchema = {
  params: subsystemIdParam,
  body: z
    .object({
      code: code.optional(),
      name: name.optional(),
      note,
      isActive: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: '沒有可更新欄位' }),
};

export const getRobotSchema = { params: idParam };
export const listSubsystemsSchema = { params: robotIdParam };
export const getSubsystemSchema = { params: subsystemIdParam };
