// 集中式錯誤處理：統一格式、絕不外洩 DB 內部錯誤
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export const notFound = (_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '找不到此路由' } });
};

// eslint-disable-next-line no-unused-vars — Express 靠 4 個參數辨識 error handler
export const errorHandler = (err, _req, res, _next) => {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = '伺服器發生錯誤';
  let details;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    code = err.code || code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // 將已知的 DB 錯誤映射成安全的訊息，不回傳原始 SQL/欄位細節
    if (err.code === 'P2002') {
      statusCode = 409;
      code = 'DUPLICATE';
      message = '資料已存在（唯一鍵衝突）';
    } else if (err.code === 'P2025') {
      statusCode = 404;
      code = 'NOT_FOUND';
      message = '資源不存在';
    } else if (err.code === 'P2003') {
      statusCode = 400;
      code = 'FK_CONSTRAINT';
      message = '關聯資料不存在或無法刪除';
    } else {
      statusCode = 400;
      code = 'DB_REQUEST_ERROR';
      message = '資料庫請求錯誤';
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    code = 'DB_VALIDATION_ERROR';
    message = '資料格式錯誤';
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'JSON 格式錯誤';
  }

  // 未預期的 500：完整記到伺服器 log，回應端只給通用訊息
  if (statusCode >= 500) {
    console.error('[UNHANDLED ERROR]', err);
  }

  const body = { success: false, error: { code, message } };
  if (details) body.error.details = details;
  // 僅開發環境附上 stack，正式環境絕不外洩
  if (!env.isProd && statusCode >= 500) body.error.stack = err.stack;

  res.status(statusCode).json(body);
};
