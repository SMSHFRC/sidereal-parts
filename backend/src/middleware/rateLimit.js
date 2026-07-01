import rateLimit from 'express-rate-limit';

// 全域：一般 API 流量上限
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '請求過於頻繁，請稍後再試' } },
});

// 登入/註冊：防暴力破解，較嚴格；以 IP + username 計數
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${(req.body && req.body.username) || ''}`,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '嘗試次數過多，請 15 分鐘後再試' } },
});
