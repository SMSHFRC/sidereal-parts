// 角色授權：需搭配 authenticate 使用
import { ApiError } from '../utils/ApiError.js';

export const requireRole =
  (...allowed) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(ApiError.forbidden('角色權限不足'));
    }
    next();
  };
