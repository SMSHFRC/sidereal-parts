import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { nextPartNumber } from '../utils/partNumber.js';
import { ROLES } from '../constants/roles.js';
import { TASK_STATUS, isValidTransition } from '../constants/taskStatus.js';
import { parseOnshapeUrl } from '../utils/onshapeUrl.js';

// M3：drawingUrl 為 Onshape 連結時自動解析出參照欄位（縮圖/零件查詢用）
const onshapeFields = (drawingUrl) => {
  const r = drawingUrl ? parseOnshapeUrl(drawingUrl) : null;
  return {
    onshapeDid: r?.did ?? null,
    onshapeWvm: r?.wvm ?? null,
    onshapeWvmId: r?.wvmId ?? null,
    onshapeEid: r?.eid ?? null,
  };
};

// 積分規則：加工分 = 加工方式的 basePoints/件（CNC/車床 5、3D列印/雷切 1）；後處理分 2/件
const POST_PROCESS_POINTS_PER_UNIT = 2;
const METHOD_OCCUPANCY = {
  BLOCKING: 'blocking',
  AUTOMATIC: 'automatic',
};
const PRINT_BATCH_STATUS = {
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};
const ACTIVE_OPERATOR_STATUSES = [TASK_STATUS.ACCEPTED, TASK_STATUS.PROCESSING];
const ACTIVE_BLOCKING_STATUSES = [TASK_STATUS.PROCESSING];
const ACTIVE_MACHINE_STATUSES = [TASK_STATUS.PROCESSING];
const MERGE_PRINT_TRANSFER_REASON = 'merge_print_batch';

// 任務總積分（顯示用）= (基礎分 + 有後處理?2:0) x 數量
const calcRewardPoints = (basePoints, quantity, hasPostProcess) =>
  (basePoints + (hasPostProcess ? POST_PROCESS_POINTS_PER_UNIT : 0)) * quantity;

const taskInclude = {
  system: { select: { code: true, name: true } },
  manufacturingMethod: {
    select: {
      code: true,
      name: true,
      basePoints: true,
      requiresReview: true,
      occupancy: true,
      reminderMinutes: true,
    },
  },
  material: { select: { code: true, name: true } },
  postProcess: { select: { code: true, name: true } },
  robot: { select: { id: true, code: true, name: true } },
  subsystem: { select: { id: true, code: true, name: true, robotId: true } },
  creator: { select: { id: true, username: true } },
  assignee: { select: { id: true, username: true } },
  postProcessor: { select: { id: true, username: true } },
  urgentBy: { select: { id: true, username: true } },
  statusHistory: {
    orderBy: { changedAt: 'desc' },
    take: 20,
    select: { fromStatus: true, toStatus: true, changedAt: true },
  },
  printBatchItems: {
    orderBy: { id: 'desc' },
    take: 5,
    include: {
      batch: {
        select: {
          id: true,
          ownerId: true,
          status: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  },
};

function withTaskFlags(task) {
  if (!task) return task;
  const latestStatusChange =
    task.statusHistory?.find((entry) => entry.toStatus === task.status) ?? task.statusHistory?.[0];
  const activePrintBatch = task.printBatchItems?.find((item) => item.batch?.status === PRINT_BATCH_STATUS.PROCESSING)?.batch ?? null;
  const { statusHistory, printBatchItems, ...publicTask } = task;
  return {
    ...publicTask,
    activePrintBatch,
    reviewRejected:
      task.status === TASK_STATUS.PROCESSING &&
      latestStatusChange?.fromStatus === TASK_STATUS.PENDING_REVIEW &&
      latestStatusChange?.toStatus === TASK_STATUS.PROCESSING,
    processingStartedAt:
      task.status === TASK_STATUS.PROCESSING && latestStatusChange?.toStatus === TASK_STATUS.PROCESSING
        ? latestStatusChange.changedAt
        : null,
    currentStatusChangedAt: latestStatusChange?.changedAt ?? null,
    nextStatusReminderAt: [TASK_STATUS.ACCEPTED, TASK_STATUS.PROCESSING].includes(task.status)
      ? nextReminderAt(task)
      : null,
  };
}

const isAutomaticMethod = (method) => method?.occupancy === METHOD_OCCUPANCY.AUTOMATIC;

function sourceName(task) {
  return (
    task.note?.split('\n').find((line) => line.startsWith('Onshape: '))?.slice('Onshape: '.length).trim() ||
    task.partNumber
  );
}

async function assertNoBlockingWork(tx, actorId, method, currentTaskId = null) {
  if (isAutomaticMethod(method)) return;
  const active = await tx.task.findFirst({
    where: {
      assigneeId: actorId,
      status: { in: ACTIVE_BLOCKING_STATUSES },
      ...(currentTaskId ? { id: { not: currentTaskId } } : {}),
      manufacturingMethod: { occupancy: METHOD_OCCUPANCY.BLOCKING },
    },
    select: {
      id: true,
      partNumber: true,
      status: true,
      manufacturingMethod: { select: { name: true } },
    },
  });
  if (active) {
    throw ApiError.conflict(
      `你目前仍有尚未完成的加工任務（${sourceName(active)}，${active.manufacturingMethod.name}）。請先完成或結束目前的 Blocking 工作。`,
      'BLOCKING_WORK_ACTIVE',
    );
  }
}

async function assertMachineAvailable(tx, task) {
  if (isAutomaticMethod(task.manufacturingMethod)) return;
  const active = await tx.task.findFirst({
    where: {
      id: { not: task.id },
      manufacturingMethodId: task.manufacturingMethodId,
      status: { in: ACTIVE_MACHINE_STATUSES },
    },
    select: {
      id: true,
      partNumber: true,
      assignee: { select: { username: true } },
      manufacturingMethod: { select: { name: true } },
    },
  });
  if (active) {
    throw ApiError.conflict(
      `${active.manufacturingMethod.name} 目前已有任務 ${sourceName(active)} 加工中（${active.assignee?.username ?? '未指派'}），請等設備空出後再開始。`,
      'MACHINE_BUSY',
    );
  }
}

async function hasActivePrintBatch(tx, taskId) {
  const item = await tx.printBatchTask.findFirst({
    where: { taskId, batch: { status: PRINT_BATCH_STATUS.PROCESSING } },
    select: { id: true },
  });
  return Boolean(item);
}

function nextReminderAt(task) {
  const changedAt =
    task.statusHistory?.find((entry) => entry.toStatus === task.status)?.changedAt ?? task.statusHistory?.[0]?.changedAt;
  const base = changedAt ?? task.updatedAt;
  const minutes =
    (task.manufacturingMethod?.reminderMinutes ?? 30) +
    (task.status === TASK_STATUS.PROCESSING ? task.machiningExtensionMinutes ?? 0 : 0);
  const natural = new Date(base.getTime() + minutes * 60_000);
  const snoozedUntil = task.statusReminderSnoozedUntil;
  return snoozedUntil && snoozedUntil > natural ? snoozedUntil : natural;
}

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

async function resolveRobotScope(tx, { robotId, subsystemId }) {
  if (subsystemId === undefined && robotId === undefined) return {};
  if (subsystemId === null) return { robotId: robotId ?? null, subsystemId: null };
  if (subsystemId != null) {
    const subsystem = await tx.robotSubsystem.findUnique({
      where: { id: subsystemId },
      select: { id: true, robotId: true, isActive: true },
    });
    if (!subsystem || !subsystem.isActive) throw ApiError.badRequest('子系統不存在或已停用');
    if (robotId != null && subsystem.robotId !== robotId) {
      throw ApiError.badRequest('子系統不屬於指定機器人');
    }
    return { robotId: subsystem.robotId, subsystemId: subsystem.id };
  }
  if (robotId === null) return { robotId: null, subsystemId: null };
  const robot = await tx.robot.findUnique({ where: { id: robotId }, select: { id: true, isActive: true } });
  if (!robot || !robot.isActive) throw ApiError.badRequest('機器人不存在或已停用');
  return { robotId: robot.id, subsystemId: null };
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

    const [system, method, robotScope] = await Promise.all([
      prisma.system.findUnique({ where: { id: data.systemId } }),
      prisma.manufacturingMethod.findUnique({ where: { id: data.manufacturingMethodId } }),
      resolveRobotScope(prisma, { robotId: data.robotId, subsystemId: data.subsystemId }),
    ]);
    if (!system) throw ApiError.badRequest('系統不存在');
    if (!method) throw ApiError.badRequest('加工方式不存在');

    const rewardPoints = calcRewardPoints(method.basePoints, data.quantity, Boolean(data.postProcessId));

    // 交易內取號 + 建任務 + 寫初始狀態歷史（並發安全）
    const task = await prisma.$transaction(async (tx) => {
      const { partNumber, seq } = await nextPartNumber(tx, system.code);
      const created = await tx.task.create({
        data: {
          partNumber,
          partNumberPrefix: system.code,
          partNumberSeq: seq,
          systemId: data.systemId,
          ...robotScope,
          manufacturingMethodId: data.manufacturingMethodId,
          materialId: data.materialId ?? null,
          postProcessId: data.postProcessId ?? null,
          assigneeId: data.assigneeId ?? null,
          postProcessorId: data.postProcessorId ?? null,
          quantity: data.quantity,
          rewardPoints,
          drawingUrl: data.drawingUrl ?? null,
          ...onshapeFields(data.drawingUrl),
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

    return withTaskFlags(task);
  },

  async list(query, actor) {
    const {
      page,
      limit,
      status,
      systemId,
      robotId,
      subsystemId,
      assigneeId,
      mine,
      scope,
      board,
      includeSubsystemCompleted,
    } = query;
    const where = {};
    if (status) where.status = status;
    if (systemId) where.systemId = systemId;
    if (robotId) where.robotId = robotId;
    if (subsystemId) where.subsystemId = subsystemId;
    if (assigneeId) where.assigneeId = assigneeId;
    if (!subsystemId && !includeSubsystemCompleted) {
      where.NOT = { status: TASK_STATUS.COMPLETED, subsystemId: { not: null } };
    }

    if (board) {
      const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      where.AND = [{
        OR: [
          { status: { notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.REJECTED, TASK_STATUS.CANCELLED] } },
          {
            status: { in: [TASK_STATUS.COMPLETED, TASK_STATUS.REJECTED, TASK_STATUS.CANCELLED] },
            updatedAt: { gte: recentCutoff },
          },
        ],
      }];
    }

    if (scope === 'pool') {
      where.status = TASK_STATUS.PENDING;
      where.assigneeId = null;
    } else if (scope === 'assigned') {
      where.OR = [{ assigneeId: actor.id }, { postProcessorId: actor.id }];
    } else if (scope === 'created') {
      where.creatorId = actor.id;
    }

    // M1：小隊透明，所有 member 可見全部任務；mine 僅作為視角篩選。
    if (!scope && mine) {
      where.OR = [{ creatorId: actor.id }, { assigneeId: actor.id }];
    }

    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: taskInclude,
        orderBy: [{ isUrgent: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.task.count({ where }),
    ]);
    return { items: items.map(withTaskFlags), page, limit, total };
  },

  async getById(id, actor) {
    const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
    if (!task) throw ApiError.notFound('任務不存在');
    return withTaskFlags(task);
  },

  async updatePriority(id, { isUrgent, reason }, actor) {
    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, creatorId: true, status: true },
    });
    if (!task) throw ApiError.notFound('任務不存在');
    if (actor.role !== ROLES.ADMIN && task.creatorId !== actor.id) {
      throw ApiError.forbidden('僅建立者或管理員可調整急件狀態');
    }
    // 已開始加工（processing 以後）就不能再變更急件
    if (![TASK_STATUS.PENDING, TASK_STATUS.ACCEPTED].includes(task.status)) {
      throw ApiError.badRequest('任務已開始加工，不可變更急件標記', 'URGENT_LOCKED');
    }

    return withTaskFlags(await prisma.task.update({
      where: { id },
      data: isUrgent
        ? {
            isUrgent: true,
            urgentById: actor.id,
            urgentAt: new Date(),
            urgentReason: reason?.trim() || null,
          }
        : { isUrgent: false },
      include: taskInclude,
    }));
  },

  async simulateTimeout(id, actor) {
    if (actor.role !== ROLES.ADMIN) throw ApiError.forbidden('僅 admin 可模擬加工逾時');
    const task = await prisma.task.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!task) throw ApiError.notFound('任務不存在');
    if (task.status !== TASK_STATUS.PROCESSING) {
      throw ApiError.badRequest('只有加工中的任務可以模擬逾時', 'TASK_NOT_PROCESSING');
    }
    const history = await prisma.taskStatusHistory.findFirst({
      where: { taskId: id, toStatus: TASK_STATUS.PROCESSING },
      orderBy: { changedAt: 'desc' },
      select: { id: true },
    });
    if (!history) throw ApiError.badRequest('找不到開始加工紀錄', 'PROCESSING_HISTORY_MISSING');
    await prisma.taskStatusHistory.update({
      where: { id: history.id },
      data: { changedAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    return withTaskFlags(await prisma.task.findUnique({ where: { id }, include: taskInclude }));
  },

  async extendMachiningTime(id, actor) {
    if (actor.role !== ROLES.ADMIN) throw ApiError.forbidden('僅 admin 可延長加工時間');
    const task = await prisma.task.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!task) throw ApiError.notFound('任務不存在');
    if (task.status !== TASK_STATUS.PROCESSING) {
      throw ApiError.badRequest('只有加工中的任務可以延長時間', 'TASK_NOT_PROCESSING');
    }
    const updated = await prisma.task.update({
      where: { id },
      data: { machiningExtensionMinutes: { increment: 20 } },
      include: taskInclude,
    });
    return withTaskFlags(updated);
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
    // 加工方式可能被改，重新取 basePoints 算積分
    const methodId = data.manufacturingMethodId ?? task.manufacturingMethodId;
    const method = await prisma.manufacturingMethod.findUnique({ where: { id: methodId } });
    if (!method) throw ApiError.badRequest('加工方式不存在');
    const rewardPoints = calcRewardPoints(method.basePoints, quantity, Boolean(postProcessId));

    // drawingUrl 有變動時，重新解析 Onshape 參照
    const osPatch = data.drawingUrl !== undefined ? onshapeFields(data.drawingUrl) : {};
    const robotScope =
      data.robotId !== undefined || data.subsystemId !== undefined
        ? await resolveRobotScope(prisma, {
            robotId: data.robotId !== undefined ? data.robotId : task.robotId,
            subsystemId: data.subsystemId !== undefined ? data.subsystemId : task.subsystemId,
          })
        : {};

    return withTaskFlags(await prisma.task.update({
      where: { id },
      data: { ...data, ...robotScope, ...osPatch, rewardPoints },
      include: taskInclude,
    }));
  },

  async updateStatus(id, { status: nextStatus, note }, actor) {
    return prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id },
        include: {
          manufacturingMethod: {
            select: {
              id: true,
              code: true,
              name: true,
              basePoints: true,
              requiresReview: true,
              occupancy: true,
              reminderMinutes: true,
            },
          },
          assignee: { select: { username: true } },
        },
      });
      if (!task) throw ApiError.notFound('任務不存在');

      const hasPost = task.postProcessId != null;
      const requiresReview = Boolean(task.manufacturingMethod?.requiresReview);

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
        [TASK_STATUS.PROCESSING, TASK_STATUS.PENDING_REVIEW].includes(task.status) &&
        hasPost
      ) {
        throw ApiError.badRequest(
          '此任務有後處理，需先交後處理並由後處理者完成',
          'POST_PROCESS_REQUIRED',
        );
      }
      // 1c) 驗收關卡：需驗收的加工方式，加工者不可從加工中直接完成/交後處理，須先送審
      if (
        requiresReview &&
        task.status === TASK_STATUS.PROCESSING &&
        [TASK_STATUS.COMPLETED, TASK_STATUS.POST_PROCESSING].includes(nextStatus)
      ) {
        throw ApiError.badRequest('此加工方式需管理員驗收，請先送審', 'REVIEW_REQUIRED');
      }
      if (nextStatus === TASK_STATUS.PENDING_REVIEW && !requiresReview) {
        throw ApiError.badRequest('此加工方式不需送審驗收', 'NO_REVIEW');
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

      // 每種轉換只屬於特定角色。管理員只負責「驗收決定（由 pending_review）」與「取消」，
      // 其餘工作流程動作（接單/開始加工/送審/放棄/完成/交後處理）都由對應的加工者/後處理者執行。
      const fromReview = task.status === TASK_STATUS.PENDING_REVIEW;
      let allowed;
      switch (nextStatus) {
        case TASK_STATUS.ACCEPTED:
          allowed = isAssignee || claiming;
          break;
        case TASK_STATUS.REJECTED:
          allowed = isAssignee; // 放棄回池
          break;
        case TASK_STATUS.PENDING_REVIEW:
          allowed = isAssignee; // 送審
          break;
        case TASK_STATUS.PROCESSING:
          // 開始加工（加工者）；退回重做（管理員，由 pending_review）
          allowed = fromReview ? isAdmin : isAssignee;
          break;
        case TASK_STATUS.POST_PROCESSING:
          // 交後處理（加工者）；驗收通過交後處理（管理員，由 pending_review）
          allowed = fromReview ? isAdmin : isAssignee;
          break;
        case TASK_STATUS.COMPLETED:
          // 後處理階段由後處理者結案；pending_review 由管理員驗收；否則加工者結案
          if (task.status === TASK_STATUS.POST_PROCESSING) allowed = isPostProcessor;
          else if (fromReview) allowed = isAdmin;
          else allowed = isAssignee;
          break;
        case TASK_STATUS.CANCELLED:
          allowed = isCreator || isAdmin;
          break;
        default:
          allowed = false;
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

      if (nextStatus === TASK_STATUS.PROCESSING) {
        await assertNoBlockingWork(tx, actor.id, task.manufacturingMethod, id);
        await assertMachineAvailable(tx, task);
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

      const statusChangedAt = new Date();
      const updated = await tx.task.update({
        where: { id },
        data:
          nextStatus === TASK_STATUS.REJECTED
            ? {
                status: TASK_STATUS.PENDING,
                assigneeId: null,
              }
            : {
                status: nextStatus,
                ...(nextStatus === TASK_STATUS.PROCESSING
                  ? {
                      machiningExtensionMinutes: 0,
                      statusReminderSnoozedUntil: null,
                      lastStatusReminderResponse: null,
                    }
                  : {}),
              },
        include: taskInclude,
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId: id,
          fromStatus: task.status,
          toStatus: nextStatus,
          changedBy: actor.id,
          note: note ?? null,
          changedAt: statusChangedAt,
        },
      });

      // 3) 積分拆帳（唯一鍵 (task,user,reason) 防重複發放）
      // 加工分 = 加工方式 basePoints/件（驗收流程於管理員核准的那次轉換才會走到這裡）
      const machiningPts = (task.manufacturingMethod?.basePoints ?? 5) * task.quantity;
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

      return withTaskFlags({
        ...updated,
        statusHistory: [{ fromStatus: task.status, toStatus: nextStatus, changedAt: statusChangedAt }],
      });
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
      return withTaskFlags(await tx.task.findUnique({ where: { id }, include: taskInclude }));
    });
  },

  async printMergeCandidates(id, actor) {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        manufacturingMethod: { select: { id: true, code: true, name: true } },
      },
    });
    if (!task) throw ApiError.notFound('任務不存在');
    if (task.manufacturingMethod.code !== '3DP') {
      throw ApiError.badRequest('只有 3D 列印任務可以合併列印', 'NOT_3D_PRINT');
    }
    if (![TASK_STATUS.PENDING, TASK_STATUS.ACCEPTED].includes(task.status)) {
      throw ApiError.badRequest('已開始或已完成的 3D 列印任務不可再合併', 'PRINT_TASK_NOT_MERGEABLE');
    }
    if (await hasActivePrintBatch(prisma, id)) {
      throw ApiError.conflict('此任務已在進行中的列印批次內', 'PRINT_BATCH_ACTIVE');
    }

    const candidates = await prisma.task.findMany({
      where: {
        id: { not: id },
        manufacturingMethodId: task.manufacturingMethodId,
        status: { in: [TASK_STATUS.PENDING, TASK_STATUS.ACCEPTED] },
        NOT: { printBatchItems: { some: { batch: { status: PRINT_BATCH_STATUS.PROCESSING } } } },
      },
      include: taskInclude,
      orderBy: { id: 'asc' },
      take: 100,
    });

    return candidates.map((candidate) => ({
      ...withTaskFlags(candidate),
      transferRequired: Boolean(candidate.assigneeId && candidate.assigneeId !== actor.id),
    }));
  },

  async startPrintBatch(id, { taskIds = [], confirmTransfer = false }, actor) {
    if (actor.role !== ROLES.MEMBER) {
      throw ApiError.forbidden('僅 member 可開始列印批次');
    }
    const uniqueIds = [...new Set([id, ...taskIds].map((value) => BigInt(value)))];

    return prisma.$transaction(async (tx) => {
      const tasks = await tx.task.findMany({
        where: { id: { in: uniqueIds } },
        include: {
          manufacturingMethod: {
            select: {
              id: true,
              code: true,
              name: true,
              basePoints: true,
              requiresReview: true,
              occupancy: true,
              reminderMinutes: true,
            },
          },
          assignee: { select: { id: true, username: true } },
        },
      });
      if (tasks.length !== uniqueIds.length) throw ApiError.notFound('部分列印任務不存在');

      const byId = new Map(tasks.map((task) => [task.id.toString(), task]));
      const mainTask = byId.get(id.toString());
      if (!mainTask) throw ApiError.notFound('任務不存在');
      if (mainTask.manufacturingMethod.code !== '3DP') {
        throw ApiError.badRequest('只有 3D 列印任務可以建立列印批次', 'NOT_3D_PRINT');
      }
      if (mainTask.assigneeId && mainTask.assigneeId !== actor.id) {
        throw ApiError.forbidden('此列印任務已由其他人負責，不能直接開始');
      }

      for (const task of tasks) {
        if (task.manufacturingMethodId !== mainTask.manufacturingMethodId || task.manufacturingMethod.code !== '3DP') {
          throw ApiError.badRequest(`${sourceName(task)} 不是可合併的 3D 列印任務`, 'PRINT_TASK_NOT_MERGEABLE');
        }
        if (![TASK_STATUS.PENDING, TASK_STATUS.ACCEPTED].includes(task.status)) {
          throw ApiError.badRequest(`${sourceName(task)} 已開始或已完成，不能加入新的列印批次`, 'PRINT_TASK_NOT_MERGEABLE');
        }
        if (await hasActivePrintBatch(tx, task.id)) {
          throw ApiError.conflict(`${sourceName(task)} 已屬於其他進行中的列印批次`, 'PRINT_BATCH_ACTIVE');
        }
      }

      const transferTasks = tasks.filter((task) => task.assigneeId && task.assigneeId !== actor.id);
      if (transferTasks.length > 0 && !confirmTransfer) {
        throw new ApiError(
          409,
          '選取的任務包含其他負責人的 3D 列印任務，需確認轉移後才能加入批次',
          'TRANSFER_CONFIRMATION_REQUIRED',
          transferTasks.map((task) => ({
            taskId: task.id.toString(),
            partNumber: task.partNumber,
            name: sourceName(task),
            assignee: task.assignee
              ? { id: task.assignee.id.toString(), username: task.assignee.username }
              : null,
          })),
        );
      }

      const statusChangedAt = new Date();
      const batch = await tx.printBatch.create({
        data: {
          manufacturingMethodId: mainTask.manufacturingMethodId,
          ownerId: actor.id,
          status: PRINT_BATCH_STATUS.PROCESSING,
          startedAt: statusChangedAt,
          items: {
            create: uniqueIds.map((taskId) => ({
              taskId,
              addedBy: actor.id,
            })),
          },
        },
        include: {
          items: { include: { task: { include: taskInclude } } },
        },
      });

      for (const task of tasks) {
        const fromStatus = task.status;
        const fromAssigneeId = task.assigneeId;
        await tx.task.update({
          where: { id: task.id },
          data: {
            assigneeId: actor.id,
            status: TASK_STATUS.PROCESSING,
            machiningExtensionMinutes: 0,
            statusReminderSnoozedUntil: null,
            lastStatusReminderResponse: null,
          },
        });
        await tx.taskStatusHistory.create({
          data: {
            taskId: task.id,
            fromStatus,
            toStatus: TASK_STATUS.PROCESSING,
            changedBy: actor.id,
            note: `合併列印批次 #${batch.id}`,
            changedAt: statusChangedAt,
          },
        });
        if (fromAssigneeId && fromAssigneeId !== actor.id) {
          await tx.taskAssignmentTransfer.create({
            data: {
              taskId: task.id,
              fromAssigneeId,
              toAssigneeId: actor.id,
              changedBy: actor.id,
              reason: MERGE_PRINT_TRANSFER_REASON,
              createdAt: statusChangedAt,
            },
          });
        }
      }

      const refreshed = await tx.printBatch.findUnique({
        where: { id: batch.id },
        include: { items: { include: { task: { include: taskInclude } } } },
      });
      return {
        ...refreshed,
        items: refreshed.items.map((item) => ({ ...item, task: withTaskFlags(item.task) })),
      };
    });
  },

  async completePrintBatch(batchId, actor) {
    return prisma.$transaction(async (tx) => {
      const batch = await tx.printBatch.findUnique({
        where: { id: batchId },
        include: {
          items: {
            include: {
              task: {
                include: {
                  manufacturingMethod: { select: { basePoints: true, requiresReview: true } },
                  assignee: { select: { username: true } },
                },
              },
            },
          },
        },
      });
      if (!batch) throw ApiError.notFound('列印批次不存在');
      if (batch.status !== PRINT_BATCH_STATUS.PROCESSING) {
        throw ApiError.badRequest('此列印批次已結束', 'PRINT_BATCH_CLOSED');
      }
      if (batch.ownerId !== actor.id && actor.role !== ROLES.ADMIN) {
        throw ApiError.forbidden('只有批次負責人或管理員可以完成列印批次');
      }

      const statusChangedAt = new Date();
      for (const item of batch.items) {
        const task = item.task;
        if (task.status !== TASK_STATUS.PROCESSING) continue;
        const nextStatus = task.postProcessId ? TASK_STATUS.POST_PROCESSING : TASK_STATUS.COMPLETED;
        await tx.task.update({
          where: { id: task.id },
          data: { status: nextStatus },
        });
        await tx.taskStatusHistory.create({
          data: {
            taskId: task.id,
            fromStatus: TASK_STATUS.PROCESSING,
            toStatus: nextStatus,
            changedBy: actor.id,
            note: `列印批次 #${batch.id} 完成`,
            changedAt: statusChangedAt,
          },
        });
        const machiningPts = (task.manufacturingMethod?.basePoints ?? 1) * task.quantity;
        if (nextStatus === TASK_STATUS.POST_PROCESSING && task.assigneeId) {
          await awardPoints(tx, task.assigneeId, task.id, machiningPts, 'machining_completed');
        } else if (nextStatus === TASK_STATUS.COMPLETED && task.assigneeId) {
          await awardPoints(tx, task.assigneeId, task.id, machiningPts, 'task_completed');
        }
      }

      await tx.printBatch.update({
        where: { id: batch.id },
        data: { status: PRINT_BATCH_STATUS.COMPLETED, completedAt: statusChangedAt },
      });

      const refreshed = await tx.printBatch.findUnique({
        where: { id: batch.id },
        include: { items: { include: { task: { include: taskInclude } } } },
      });
      return {
        ...refreshed,
        items: refreshed.items.map((item) => ({ ...item, task: withTaskFlags(item.task) })),
      };
    });
  },

  async statusReminders(actor) {
    const now = new Date();
    const tasks = await prisma.task.findMany({
      where: {
        assigneeId: actor.id,
        status: { in: ACTIVE_OPERATOR_STATUSES },
      },
      include: taskInclude,
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
    return tasks
      .filter((task) => nextReminderAt(task) <= now)
      .map((task) => withTaskFlags(task));
  },

  async respondStatusReminder(id, { response }, actor) {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        manufacturingMethod: { select: { reminderMinutes: true } },
      },
    });
    if (!task) throw ApiError.notFound('任務不存在');
    if (task.assigneeId !== actor.id) throw ApiError.forbidden('只有目前負責人可以回覆提醒');
    if (!ACTIVE_OPERATOR_STATUSES.includes(task.status)) {
      throw ApiError.badRequest('只有已接單或加工中的任務可以回覆提醒', 'REMINDER_NOT_ACTIVE');
    }
    const minutes =
      (task.manufacturingMethod?.reminderMinutes ?? 30) +
      (task.status === TASK_STATUS.PROCESSING ? task.machiningExtensionMinutes ?? 0 : 0);
    const snoozeMultiplier = response === 'problem' ? 2 : 1;
    const updated = await prisma.task.update({
      where: { id },
      data: {
        lastStatusReminderResponse: response,
        statusReminderSnoozedUntil: new Date(Date.now() + minutes * snoozeMultiplier * 60_000),
      },
      include: taskInclude,
    });
    return withTaskFlags(updated);
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
    return withTaskFlags(await prisma.task.findUnique({ where: { id }, include: taskInclude }));
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
