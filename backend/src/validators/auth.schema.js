import { z } from 'zod';

const username = z
  .string()
  .trim()
  .min(2, '使用者名稱至少 2 字元')
  .max(50)
  .regex(/^[a-zA-Z0-9_.-]+$/, '使用者名稱只能包含英數字、_、.、-');

// 放寬密碼限制：只保留長度上限，避免註冊/改密碼被複雜規則卡住
const password = z.string().min(1, '密碼不可為空').max(128);

export const registerSchema = {
  body: z.object({
    username,
    password,
    // 開放註冊只允許 member；建立 admin 須由既有 admin 操作
    role: z.enum(['member']).default('member'),
  }),
};

export const loginSchema = {
  body: z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
  }),
};

export const refreshSchema = {
  body: z.object({ refreshToken: z.string().min(1) }),
};
