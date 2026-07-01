// JWT 驗證：解析 Bearer token，附上 req.user，並確認帳號仍啟用
import { verifyAccessToken } from '../utils/jwt.js';
import { ApiError } from '../utils/ApiError.js';
import { prisma } from '../config/prisma.js';

export const authenticate = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('缺少或格式錯誤的授權標頭');
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw ApiError.unauthorized('Token 無效或已過期', 'TOKEN_INVALID');
    }

    // 確認使用者存在且未被停用（token 尚未過期但帳號已停用的情況）
    const user = await prisma.user.findUnique({
      where: { id: BigInt(payload.sub) },
      select: { id: true, username: true, isActive: true, role: { select: { name: true } } },
    });
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('帳號不存在或已停用', 'ACCOUNT_DISABLED');
    }

    req.user = { id: user.id, username: user.username, role: user.role.name };
    next();
  } catch (err) {
    next(err);
  }
};
