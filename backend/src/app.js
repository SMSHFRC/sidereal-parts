import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/error.js';
import routes from './routes/index.js';
import { ApiError } from './utils/ApiError.js';

const app = express();

const isAllowedOrigin = (origin) => {
  if (!origin || env.corsOrigins.length === 0) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  return env.corsOrigins.some((allowed) => {
    if (allowed === origin) return true;
    if (allowed.startsWith('*.')) return parsed.hostname.endsWith(allowed.slice(1));
    if (allowed.includes('://*.')) {
      const [protocol, hostPattern] = allowed.split('://*.');
      return parsed.protocol === `${protocol}:` && parsed.hostname.endsWith(`.${hostPattern}`);
    }
    return false;
  });
};

// 反向代理（Render/Nginx）後正確取得 client IP，讓 rate limit 生效
app.set('trust proxy', 1);
app.disable('x-powered-by');

// 安全 HTTP headers；Onshape extension 會以 iframe 方式嵌入前端/流程頁
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'frame-ancestors': ["'self'", 'https://cad.onshape.com', 'https://*.onshape.com'],
      },
    },
    frameguard: false,
  }),
);

// CORS 白名單
app.use(
  cors({
    origin(origin, cb) {
      // 無 origin（如 curl / server-to-server）放行；其餘須在白名單
      if (isAllowedOrigin(origin)) {
        return cb(null, true);
      }
      return cb(new ApiError(403, 'CORS 來源不被允許', 'CORS_FORBIDDEN'));
    },
    credentials: true,
  }),
);

// body 解析 + 大小限制（防超大 payload）
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// 全域流量限制
app.use(globalLimiter);

// 根路由：訪問網站根目錄時的服務資訊（避免直接看到 404）
app.get('/', (_req, res) =>
  res.json({
    name: '零件加工任務管理系統 API',
    status: 'running',
    apiBase: '/api/v1',
    health: '/health',
  }),
);

// 健康檢查（部署平台探針用）
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// API
app.use('/api/v1', routes);

// 404 + 集中錯誤處理（順序必須在最後）
app.use(notFound);
app.use(errorHandler);

export default app;
