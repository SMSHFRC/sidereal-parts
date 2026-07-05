// 啟動時驗證環境變數；缺關鍵設定就讓程式 fail-fast，而不是上線後才爆
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default(''),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET 至少 32 字元'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET 至少 32 字元'),
  JWT_ACCESS_TTL: z.string().default('1h'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // ---- M3: Onshape OAuth（皆選填；未設定時 Onshape 功能回 503）----
  ONSHAPE_CLIENT_ID: z.string().optional(),
  ONSHAPE_CLIENT_SECRET: z.string().optional(),
  ONSHAPE_API_BASE: z.string().default('https://cad.onshape.com/api/v10'),
  ONSHAPE_OAUTH_BASE: z.string().default('https://oauth.onshape.com'),
  // OAuth callback 的完整網址（須與 Onshape dev portal 設定一致）
  ONSHAPE_REDIRECT_URI: z.string().optional(),
  // 授權完成後把使用者導回前端的網址
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  // token 加密金鑰（選填；預設由 JWT_REFRESH_SECRET 衍生）
  ONSHAPE_TOKEN_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('環境變數設定錯誤：', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  onshapeEnabled: Boolean(raw.ONSHAPE_CLIENT_ID && raw.ONSHAPE_CLIENT_SECRET),
  onshapeRedirectUri:
    raw.ONSHAPE_REDIRECT_URI ?? `http://localhost:${raw.PORT}/api/v1/onshape/callback`,
};
