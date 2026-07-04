import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { nextPartNumber } from '../utils/partNumber.js';
import { ROLES } from '../constants/roles.js';
import { TASK_STATUS, isValidTransition } from '../constants/taskStatus.js';

// 積分規則：加工分 5/件、後處理分 2/件（拆帳發給不同角色）
const MACHINING_POINTS_PER_UNIT = 5;
const POST_PROCESS_POINTS_PER_UNIT = 2;

// 任務總積分（顯示用）= (5 + 有後處理?2:0) x 數量
const calcRewardPoints = (quantity, hasPostProcess) =>
  (MACHINING_POINTS_PER_UNIT + (hasPostProcess ? POST_PROCESS_POINTS_PER_UNIT : 0)) * quantity;

const taskInclude = {
  system: { select: { code: true, name: true } },
  manufacturingMethod: { select: { code: true, name: true } },
  material: { select: { code: true, name: true } },
  postProcess: { select: { code: true, name: true } },
  creator: { select: { id: true, username: true } },
  assignee: { select: { id: true, username: true } },
  postProcessor: { select: { id: true, username: true } },
};

// 確認使用者存在、啟用、且為 member 角色（assignee / postProcessor 共用）
async function assertMember(userId, label) {
  if (userId == null) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!u || !u.isActive) throw ApiError.badRequest(`指派的${label}不存在或已停用`);
  if (u.role.name !== ROLES.MEMBER) throw ApiError.badRequest(`${label}必須為 member 角色`);
}

// 發積分：明細帳 + 總分（在交易內呼叫）
async function awardPoints(tx, userId, taskId, points, reason) {
  await tx.userPointsLedger.create({ data: { userId, taskId, points, reason } });
  await tx.user.update({ where: { id: userId }, data: { totalPoints: { increment: points } } });
}

export const taskService = {
  async create(data, actor) {
    // 接單制：任務預設進任務池，僅 admin 可預先指派
    if (
      (data.assigneeId != null || data.postProcessorId != null) &&
      actor.role !== ROLES.ADMIN
    ) {
      throw ApiError.forbidden('僅管理員可指派人員，一般任務由隊員自行接單');
    }
    await assertMember(data.assigneeId ?? null, '加工者');
    await assertMember(data.postProcessorId ?? null, '後處理者');
    if (data.postProcessorId != null && data.postProcessId == null) {
      throw ApiError.badRequest('未選擇後處理方式，不需指派後處理者');
    }

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
          postProcessorId: data.postProcessorId ?? null,
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

    // M1：小隊透明，所有 member 可見全部任務；mine 僅作為視角篩選。
    if (mine) {
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
    return task;
  },

  async update(id, data, actor) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw ApiError.notFound('任務不存在');

    if (actor.role !== ROLES.ADMIN && task.creatorId !== actor.id) {
      throw ApiError.forbidden('僅建立者或管理員可編輯任務');
    }
    if ([TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED, TASK_STATUS.REJECTED].includes(task.status)) {
      throw ApiError.badRequest('已結案的任務不可編輯', 'TASK_LOCKED');
    }
    // 接單制：指派/改派僅 admin（member 只能編輯任務內容）
    if (
      (data.assigneeId !== undefined || data.postProcessorId !== undefined) &&
      actor.role !== ROLES.ADMIN
    ) {
      throw ApiError.forbidden('僅管理員可指派或改派人員');
    }
    if (data.assigneeId !== undefined) await assertMember(data.assigneeId, '加工者');
    if (data.postProcessorId !== undefined)
      await assertMember(data.postProcessorId, '後處理者');

    const quantity = data.quantity ?? task.quantity;
    const postProcessId =
      data.postProcessId !== undefined ? data.postProcessId : task.postProcessId;
    const postProcessorId =
      data.postProcessorId !== undefined ? data.postProcessorId : task.postProcessorId;
    if (postProcessorId != null && postProcessId == null) {
      throw ApiError.badRequest('未選擇後處理方式，不需指派後處理者');
    }
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

      const hasPost = task.postProcessId != null;

      // 1) 狀態機合法性（結構）
      if (!isValidTransition(task.status, nextStatus)) {
        throw ApiError.badRequest(
          `不允許從 ${task.status} 變更為 ${nextStatus}`,
          'INVALID_STATUS_TRANSITION',
        );
      }
      // 1b) 條件式限制：依任務是否有後處理
      if (nextStatus === TASK_STATUS.POST_PROCESSING && !hasPost) {
        throw ApiError.badRequest('此任務不需後處理', 'NO_POST_PROCESS');
      }
      if (
        nextStatus === TASK_STATUS.COMPLETED &&
        task.status === TASK_STATUS.PROCESSING &&
        hasPost
      ) {
        throw ApiError.badRequest(
          '此任務有後處理，需先交後處理並由後處理者完成',
          'POST_PROCESS_REQUIRED',
        );
      }

      // 2) 角色/擁有權
      const isAdmin = actor.role === ROLES.ADMIN;
      const isAssignee = task.assigneeId === actor.id;
      const isCreator = task.creatorId === actor.id;
      const isPostProcessor = task.postProcessorId === actor.id;

      // 後處理池：沒人接後處理前，誰都不能結案（先於權限檢查，訊息較明確）
      if (
        nextStatus === TASK_STATUS.COMPLETED &&
        task.status === TASK_STATUS.POST_PROCESSING &&
        !task.postProcessorId
      ) {
        throw ApiError.badRequest('尚未有人接後處理', 'POST_PROCESSOR_REQUIRED');
      }

      // 接單：未指派的 pending 任務，任何 member 按「接受」即認領（claim）
      const claiming =
        nextStatus === TASK_STATUS.ACCEPTED &&
        !task.assigneeId &&
        actor.role === ROLES.MEMBER;

      let allowed = isAdmin;
      if (!allowed) {
        switch (nextStatus) {
          case TASK_STATUS.ACCEPTED:
            allowed = isAssignee || claiming;
            break;
          case TASK_STATUS.REJECTED:
          case TASK_STATUS.PROCESSING:
          case TASK_STATUS.POST_PROCESSING:
            allowed = isAssignee;
            break;
          case TASK_STATUS.COMPLETED:
            // 後處理階段由後處理者結案；無後處理由加工者結案
            allowed =
              task.status === TASK_STATUS.POST_PROCESSING ? isPostProcessor : isAssignee;
            break;
          case TASK_STATUS.CANCELLED:
            allowed = isCreator;
            break;
          default:
            allowed = false;
        }
      }
      if (!allowed) throw ApiError.forbidden('無權執行此狀態變更', 'STATUS_FORBIDDEN');

      // 前置指派檢查
      if (nextStatus === TASK_STATUS.ACCEPTED && !task.assigneeId && !claiming) {
        // admin 對任務池按接受沒有意義（他不是接單者），須先指派
        throw ApiError.badRequest('任務池任務由隊員接單，或先指派隊員');
      }
      if (
        [TASK_STATUS.REJECTED, TASK_STATUS.PROCESSING].includes(nextStatus) &&
        !task.assigneeId
      ) {
        throw ApiError.badRequest('任務尚未有隊員接單');
      }

      // claim 用條件式更新防搶單競爭：兩人同時接，只有一人成功
      if (claiming) {
        const r = await tx.task.updateMany({
          where: { id, status: TASK_STATUS.PENDING, assigneeId: null },
          data: { assigneeId: actor.id },
        });
        if (r.count === 0) {
          throw ApiError.conflict('此任務剛被其他隊員接走', 'ALREADY_CLAIMED');
        }
      }

      const updated = await tx.task.update({
        where: { id },
        data:
          nextStatus === TASK_STATUS.REJECTED
            ? {
                status: TASK_STATUS.PENDING,
                assigneeId: null,
              }
            : { status: nextStatus },
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

      // 3) 積分拆帳（唯一鍵 (task,user,reason) 防重複發放）
      const machiningPts = MACHINING_POINTS_PER_UNIT * task.quantity;
      const postPts = POST_PROCESS_POINTS_PER_UNIT * task.quantity;

      // 加工者交棒後處理 -> 加工分入帳
      if (nextStatus === TASK_STATUS.POST_PROCESSING && task.assigneeId) {
        await awardPoints(tx, task.assigneeId, id, machiningPts, 'machining_completed');
      }
      if (nextStatus === TASK_STATUS.COMPLETED) {
        if (hasPost) {
          // 後處理完成 -> 後處理分給後處理者（加工分已於交棒時發放）
          if (task.postProcessorId) {
            await awardPoints(tx, task.postProcessorId, id, postPts, 'post_process_completed');
          }
        } else if (task.assigneeId) {
          // 無後處理 -> 全額給加工者
          await awardPoints(tx, task.assigneeId, id, machiningPts, 'task_completed');
        }
      }

      return updated;
    });
  },

  async claim(id, actor) {
    if (actor.role !== ROLES.MEMBER) {
      throw ApiError.forbidden('僅 member 可接單');
    }
    return prisma.$transaction(async (tx) => {
      const r = await tx.task.updateMany({
        where: { id, status: TASK_STATUS.PENDING, assigneeId: null },
        data: { assigneeId: actor.id, status: TASK_STATUS.ACCEPTED },
      });
      if (r.count === 0) {
        throw ApiError.conflict('此任務已被認領', 'ALREADY_CLAIMED');
      }
      await tx.taskStatusHistory.create({
        data: {
          taskId: id,
          fromStatus: TASK_STATUS.PENDING,
          toStatus: TASK_STATUS.ACCEPTED,
          changedBy: actor.id,
          note: '接單',
        },
      });
      return tx.task.findUnique({ where: { id }, include: taskInclude });
    });
  },

  // 接後處理：post_processing 且尚無後處理者的任務，member 可認領
  async claimPostProcess(id, actor) {
    if (actor.role !== ROLES.MEMBER) {
      throw ApiError.forbidden('僅 member 可接後處理');
    }
    // 條件式原子更新防搶單競爭
    const r = await prisma.task.updateMany({
      where: { id, status: TASK_STATUS.POST_PROCESSING, postProcessorId: null },
      data: { postProcessorId: actor.id },
    });
    if (r.count === 0) {
      throw ApiError.badRequest('此任務目前不可接後處理（已被接走或狀態不符）', 'CLAIM_FAILED');
    }
    return prisma.task.findUnique({ where: { id }, include: taskInclude });
  },

  async remove(id, actor) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw ApiError.notFound('任務不存在');
    if (actor.role !== ROLES.ADMIN && task.creatorId !== actor.id) {
      throw ApiError.forbidden('僅建立者或管理員可刪除任務');
    }
    if (task.status === TASK_STATUS.COMPLETED) {
      throw ApiError.badRequest('已完成任務不可刪除', 'TASK_LOCKED');
    }
    await prisma.task.delete({ where: { id } });
    return { id, deleted: true };
  },
};
