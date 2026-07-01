import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { nextPartNumber } from '../utils/partNumber.js';
import { ROLES } from '../constants/roles.js';
import {
  TASK_STATUS,
  isValidTransition,
  TRANSITION_ACTORS,
} from '../constants/taskStatus.js';

const BASE_POINTS = 5;
const POST_PROCESS_BONUS = 2;

// 積分規則：(基礎 5 + 有後處理 2) x 數量
const calcRewardPoints = (quantity, hasPostProcess) =>
  (BASE_POINTS + (hasPostProcess ? POST_PROCESS_BONUS : 0)) * quantity;

const taskInclude = {
  system: { select: { code: true, name: true } },
  manufacturingMethod: { select: { code: true, name: true } },
  material: { select: { code: true, name: true } },
  postProcess: { select: { code: true, name: true } },
  creator: { select: { id: true, username: true } },
  assignee: { select: { id: true, username: true } },
};

// 確認被指派者存在、啟用、且為加工者角色
async function assertAssignee(assigneeId) {
  if (assigneeId == null) return;
  const u = await prisma.user.findUnique({ where: { id: assigneeId }, include: { role: true } });
  if (!u || !u.isActive) throw ApiError.badRequest('指派的加工者不存在或已停用');
  if (u.role.name !== ROLES.PROCESSOR) throw ApiError.badRequest('只能指派給 processor 角色');
}

export const taskService = {
  async create(data, actor) {
    await assertAssignee(data.assigneeId ?? null);

    const system = await prisma.system.findUnique({ where: { id: data.systemId } });
    if (!system) throw ApiError.badRequest('系統不存在');

    const rewardPoints = calcRewardPoints(data.quantity, Boolean(data.postProcessId));

    // 交易內取號 + 建任務 + 寫初始狀態歷史（並發安全）
    const task = await prisma.$transaction(async (tx) => {
      const { partNumber, seq } = await nextPartNumber(tx, system.code);
      const created = await tx.task.create({
        data: {
          partNumber,
          partNumberPrefix: system.code,
          partNumberSeq: seq,
          systemId: data.systemId,
          manufacturingMethodId: data.manufacturingMethodId,
          materialId: data.materialId ?? null,
          postProcessId: data.postProcessId ?? null,
          assigneeId: data.assigneeId ?? null,
          quantity: data.quantity,
          rewardPoints,
          drawingUrl: data.drawingUrl ?? null,
          dimensions: data.dimensions ?? null,
          note: data.note ?? null,
          creatorId: actor.id,
          status: TASK_STATUS.PENDING,
        },
        include: taskInclude,
      });
      await tx.taskStatusHistory.create({
        data: {
          taskId: created.id,
          fromStatus: null,
          toStatus: TASK_STATUS.PENDING,
          changedBy: actor.id,
          note: '任務建立',
        },
      });
      return created;
    });

    return task;
  },

  async list(query, actor) {
    const { page, limit, status, systemId, assigneeId, mine } = query;
    const where = {};
    if (status) where.status = status;
    if (systemId) where.systemId = systemId;
    if (assigneeId) where.assigneeId = assigneeId;

    // 授權範圍：processor 預設只看到指派給自己的任務
    if (actor.role === ROLES.PROCESSOR) {
      where.assigneeId = actor.id;
    } else if (mine) {
      where.OR = [{ creatorId: actor.id }, { assigneeId: actor.id }];
    }

    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: taskInclude,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.task.count({ where }),
    ]);
    return { items, page, limit, total };
  },

  async getById(id, actor) {
    const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
    if (!task) throw ApiError.notFound('任務不存在');
    // processor 只能看自己被指派的任務
    if (actor.role === ROLES.PROCESSOR && task.assigneeId !== actor.id) {
      throw ApiError.forbidden('無權檢視此任務');
    }
    return task;
  },

  async update(id, data, actor) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw ApiError.notFound('任務不存在');

    // 只有 admin 或建立者可編輯任務欄位
    if (actor.role !== ROLES.ADMIN && task.creatorId !== actor.id) {
      throw ApiError.forbidden('僅建立者或管理員可編輯任務');
    }
    // 終態任務不可再編輯內容
    if ([TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED, TASK_STATUS.REJECTED].includes(task.status)) {
      throw ApiError.badRequest('已結案的任務不可編輯', 'TASK_LOCKED');
    }
    if (data.assigneeId !== undefined) await assertAssignee(data.assigneeId);

    // 若數量或後處理有變，重算積分
    const quantity = data.quantity ?? task.quantity;
    const postProcessId =
      data.postProcessId !== undefined ? data.postProcessId : task.postProcessId;
    const rewardPoints = calcRewardPoints(quantity, Boolean(postProcessId));

    return prisma.task.update({
      where: { id },
      data: { ...data, rewardPoints },
      include: taskInclude,
    });
  },

  async updateStatus(id, { status: nextStatus, note }, actor) {
    return prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id } });
      if (!task) throw ApiError.notFound('任務不存在');

      // 1) 狀態機合法性
      if (!isValidTransition(task.status, nextStatus)) {
        throw ApiError.badRequest(
          `不允許從 ${task.status} 變更為 ${nextStatus}`,
          'INVALID_STATUS_TRANSITION',
        );
      }

      // 2) 角色/擁有權
      const actors = TRANSITION_ACTORS[nextStatus] || [];
      const isAdmin = actor.role === ROLES.ADMIN;
      const isAssignee = task.assigneeId === actor.id;
      const isCreator = task.creatorId === actor.id;
      const allowed =
        isAdmin ||
        (actors.includes('assignee') && isAssignee) ||
        (actors.includes('creator') && isCreator);
      if (!allowed) {
        throw ApiError.forbidden('無權執行此狀態變更', 'STATUS_FORBIDDEN');
      }
      // 加工者接單/加工前必須已被指派
      if (actors.includes('assignee') && !task.assigneeId) {
        throw ApiError.badRequest('任務尚未指派加工者');
      }

      const updated = await tx.task.update({
        where: { id },
        data: { status: nextStatus },
        include: taskInclude,
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId: id,
          fromStatus: task.status,
          toStatus: nextStatus,
          changedBy: actor.id,
          note: note ?? null,
        },
      });

      // 3) 完成任務 -> 發積分給加工者（唯一鍵防重複發放）
      if (nextStatus === TASK_STATUS.COMPLETED && task.assigneeId) {
        await tx.userPointsLedger.create({
          data: {
            userId: task.assigneeId,
            taskId: id,
            points: task.rewardPoints,
            reason: 'task_completed',
          },
        });
        await tx.user.update({
          where: { id: task.assigneeId },
          data: { totalPoints: { increment: task.rewardPoints } },
        });
      }

      return updated;
    });
  },

  async remove(id, actor) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw ApiError.notFound('任務不存在');
    if (actor.role !== ROLES.ADMIN && task.creatorId !== actor.id) {
      throw ApiError.forbidden('僅建立者或管理員可刪除任務');
    }
    // 已發積分（completed）的任務保留，避免破壞積分帳；改以取消處理
    if (task.status === TASK_STATUS.COMPLETED) {
      throw ApiError.badRequest('已完成任務不可刪除', 'TASK_LOCKED');
    }
    await prisma.task.delete({ where: { id } });
    return { id, deleted: true };
  },
};
