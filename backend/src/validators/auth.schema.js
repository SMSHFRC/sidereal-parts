import { z } from 'zod';

const username = z
  .string()
  .trim()
  .min(3, '帳號至少 3 字元')
  .max(50)
  .regex(/^[a-zA-Z0-9_.-]+$/, '帳號僅能含英數與 _ . -');

// 強密碼：至少 8 碼、含大小寫與數字
const password = z
  .string()
  .min(8, '密碼至少 8 碼')
  .max(128)
  .regex(/[a-z]/, '需含小寫字母')
  .regex(/[A-Z]/, '需含大寫字母')
  .regex(/[0-9]/, '需含數字');

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
