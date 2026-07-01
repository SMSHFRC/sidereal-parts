import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

export const pointsService = {
  // 加工者之間轉讓積分。並發安全：以條件式 updateMany 原子扣款，餘額不足則不扣。
  async transfer(fromUserId, { toUserId, points, note }) {
    if (fromUserId === toUserId) throw ApiError.badRequest('不可轉給自己');

    const recipient = await prisma.user.findUnique({ where: { id: toUserId } });
    if (!recipient || !recipient.isActive) {
      throw ApiError.badRequest('收款帳號不存在或已停用');
    }

    return prisma.$transaction(async (tx) => {
      // 只有在 totalPoints >= points 時才扣款；count=0 代表餘額不足或帳號不存在
      const debited = await tx.user.updateMany({
        where: { id: fromUserId, totalPoints: { gte: points } },
        data: { totalPoints: { decrement: points } },
      });
      if (debited.count === 0) {
        throw ApiError.badRequest('積分不足', 'INSUFFICIENT_POINTS');
      }

      await tx.user.update({
        where: { id: toUserId },
        data: { totalPoints: { increment: points } },
      });

      const transfer = await tx.pointTransfer.create({
        data: { fromUserId, toUserId, points, note: note ?? null },
      });

      // 雙方明細帳（task_id 為 NULL，不受 completed 的唯一鍵限制）
      await tx.userPointsLedger.createMany({
        data: [
          { userId: fromUserId, taskId: null, points: -points, reason: 'transfer_out' },
          { userId: toUserId, taskId: null, points, reason: 'transfer_in' },
        ],
      });

      const from = await tx.user.findUnique({
        where: { id: fromUserId },
        select: { id: true, totalPoints: true },
      });
      return { transfer, balance: from.totalPoints };
    });
  },

  async myLedger(userId, { page, limit }) {
    const where = { userId };
    const [items, total] = await Promise.all([
      prisma.userPointsLedger.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.userPointsLedger.count({ where }),
    ]);
    return { items, page, limit, total };
  },

  async myTransfers(userId, { page, limit, direction }) {
    let where;
    if (direction === 'sent') where = { fromUserId: userId };
    else if (direction === 'received') where = { toUserId: userId };
    else where = { OR: [{ fromUserId: userId }, { toUserId: userId }] };

    const [items, total] = await Promise.all([
      prisma.pointTransfer.findMany({
        where,
        include: {
          fromUser: { select: { id: true, username: true } },
          toUser: { select: { id: true, username: true } },
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.pointTransfer.count({ where }),
    ]);
    return { items, page, limit, total };
  },
};
