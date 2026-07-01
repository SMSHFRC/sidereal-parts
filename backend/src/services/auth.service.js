import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../utils/jwt.js';
import { env } from '../config/env.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 與 JWT_REFRESH_TTL 一致（7d）

const issueTokens = async (user) => {
  const payload = { sub: user.id.toString(), role: user.role.name, username: user.username };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ sub: user.id.toString() });

  // 只存 refresh token 的 hash，供撤銷/輪替
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });

  return { accessToken, refreshToken };
};

const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role.name });

export const authService = {
  async register({ username, password, role }) {
    const roleRow = await prisma.role.findUnique({ where: { name: role } });
    if (!roleRow) throw ApiError.badRequest('角色不存在');

    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) throw ApiError.conflict('帳號已被使用');

    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password), roleId: roleRow.id },
      include: { role: true },
    });

    const tokens = await issueTokens(user);
    return { user: publicUser(user), ...tokens };
  },

  async login({ username, password }) {
    const user = await prisma.user.findUnique({ where: { username }, include: { role: true } });
    // 帳號不存在或密碼錯誤回同一訊息，避免帳號枚舉
    const ok = user && user.isActive && (await verifyPassword(password, user.passwordHash));
    if (!ok) throw ApiError.unauthorized('帳號或密碼錯誤', 'INVALID_CREDENTIALS');

    const tokens = await issueTokens(user);
    return { user: publicUser(user), ...tokens };
  },

  async refresh({ refreshToken }) {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw ApiError.unauthorized('Refresh token 無效或已過期', 'REFRESH_INVALID');
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw ApiError.unauthorized('Refresh token 已失效', 'REFRESH_REVOKED');
    }

    const user = await prisma.user.findUnique({
      where: { id: BigInt(payload.sub) },
      include: { role: true },
    });
    if (!user || !user.isActive) throw ApiError.unauthorized('帳號已停用');

    // 輪替：撤銷舊 token，發新的（防重放）
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await issueTokens(user);
    return { user: publicUser(user), ...tokens };
  },

  async logout({ refreshToken }) {
    if (!refreshToken) return;
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async me(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw ApiError.notFound('使用者不存在');
    return { ...publicUser(user), totalPoints: user.totalPoints, createdAt: user.createdAt };
  },
};
