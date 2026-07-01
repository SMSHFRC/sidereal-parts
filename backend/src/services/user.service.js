import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword } from '../utils/password.js';
import { ROLES } from '../constants/roles.js';

const publicUser = {
  id: true,
  username: true,
  isActive: true,
  totalPoints: true,
  createdAt: true,
  role: { select: { name: true } },
};

export const userService = {
  async list({ page, limit }) {
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        select: publicUser,
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count(),
    ]);
    return { items, page, limit, total };
  },

  async getById(id, actor) {
    // 非 admin 只能查自己
    if (actor.role !== ROLES.ADMIN && actor.id !== id) {
      throw ApiError.forbidden('僅能查詢自己的資料');
    }
    const user = await prisma.user.findUnique({ where: { id }, select: publicUser });
    if (!user) throw ApiError.notFound('使用者不存在');
    return user;
  },

  async update(id, data, actor) {
    const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw ApiError.notFound('使用者不存在');

    const isAdmin = actor.role === ROLES.ADMIN;
    const isSelf = actor.id === id;

    // 只有 admin 能改角色或啟用狀態；本人只能改自己的密碼
    if ((data.role || data.isActive !== undefined) && !isAdmin) {
      throw ApiError.forbidden('僅管理員可變更角色或啟用狀態');
    }
    if (!isAdmin && !isSelf) throw ApiError.forbidden('僅能修改自己的資料');

    const patch = {};
    if (data.password) patch.passwordHash = await hashPassword(data.password);
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.role) {
      const roleRow = await prisma.role.findUnique({ where: { name: data.role } });
      if (!roleRow) throw ApiError.badRequest('角色不存在');
      patch.roleId = roleRow.id;
    }

    const updated = await prisma.user.update({ where: { id }, data: patch, select: publicUser });
    // 變更密碼或停權時，撤銷所有 refresh token 強制重新登入
    if (patch.passwordHash || patch.isActive === false) {
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return updated;
  },

  async remove(id, actor) {
    if (actor.id === id) throw ApiError.badRequest('不可刪除自己的帳號');
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw ApiError.notFound('使用者不存在');
    // 保留歷史資料：停用而非硬刪（tasks 有 FK 指向 user）
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    await prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { id, deactivated: true };
  },
};
