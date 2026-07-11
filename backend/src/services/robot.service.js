import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../constants/roles.js';

const robotInclude = {
  subsystems: {
    orderBy: { id: 'asc' },
    include: {
      system: { select: { id: true, code: true, name: true } },
      _count: { select: { tasks: true } },
    },
  },
  _count: { select: { tasks: true } },
};

const subsystemInclude = {
  robot: { select: { id: true, code: true, name: true } },
  system: { select: { id: true, code: true, name: true } },
  _count: { select: { tasks: true } },
};

function ensureAdmin(actor) {
  if (actor.role !== ROLES.ADMIN) throw ApiError.forbidden('只有管理員可以管理機器人');
}

function sanitizeCode(value, fallback) {
  const base = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return base || fallback;
}

async function uniqueCode(model, desired, fallback) {
  const base = sanitizeCode(desired, fallback);
  for (let i = 0; i < 1000; i += 1) {
    const suffix = i === 0 ? '' : `_${i}`;
    const code = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    const exists = await model.findUnique({ where: { code } });
    if (!exists) return code;
  }
  return `${fallback}_${Date.now().toString(36).toUpperCase()}`.slice(0, 32);
}

async function uniqueSubsystemCode(tx, robotId, desired) {
  const base = sanitizeCode(desired, 'SUBSYS');
  for (let i = 0; i < 1000; i += 1) {
    const suffix = i === 0 ? '' : `_${i}`;
    const code = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    const exists = await tx.robotSubsystem.findUnique({
      where: { robotId_code: { robotId, code } },
    });
    if (!exists) return code;
  }
  return `SUBSYS_${Date.now().toString(36).toUpperCase()}`.slice(0, 32);
}

// 依 systemId 統計任務狀態，附到每個 subsystem 上（進度顯示用）
// pending=待接單、active=進行中(accepted/processing/pending_review/post_processing)、
// done=completed；cancelled 不列入分母。percent = done/total。
async function attachProgress(robots) {
  const list = Array.isArray(robots) ? robots : [robots];
  const systemIds = list.flatMap((r) => r.subsystems.map((s) => s.systemId)).filter(Boolean);
  if (systemIds.length === 0) return robots;

  const grouped = await prisma.task.groupBy({
    by: ['systemId', 'status'],
    where: { systemId: { in: systemIds } },
    _count: { _all: true },
  });
  const bySystem = new Map();
  for (const g of grouped) {
    const bucket = bySystem.get(g.systemId) ?? { pending: 0, active: 0, done: 0 };
    if (g.status === 'pending') bucket.pending += g._count._all;
    else if (g.status === 'completed') bucket.done += g._count._all;
    else if (['accepted', 'processing', 'pending_review', 'post_processing'].includes(g.status))
      bucket.active += g._count._all;
    bySystem.set(g.systemId, bucket);
  }

  for (const robot of list) {
    const sum = { pending: 0, active: 0, done: 0 };
    for (const sub of robot.subsystems) {
      const b = bySystem.get(sub.systemId) ?? { pending: 0, active: 0, done: 0 };
      const total = b.pending + b.active + b.done;
      sub.progress = { ...b, total, percent: total ? Math.round((b.done / total) * 100) : 0 };
      sum.pending += b.pending;
      sum.active += b.active;
      sum.done += b.done;
    }
    const total = sum.pending + sum.active + sum.done;
    robot.progress = { ...sum, total, percent: total ? Math.round((sum.done / total) * 100) : 0 };
  }
  return robots;
}

export const robotService = {
  async list() {
    const robots = await prisma.robot.findMany({
      orderBy: { id: 'desc' },
      include: robotInclude,
    });
    return attachProgress(robots);
  },

  async get(id) {
    const robot = await prisma.robot.findUnique({ where: { id }, include: robotInclude });
    if (!robot) throw ApiError.notFound('找不到此機器人');
    await attachProgress(robot);
    return robot;
  },

  async create(data, actor) {
    ensureAdmin(actor);
    const code = await uniqueCode(prisma.robot, data.code ?? data.name, 'ROBOT');
    return prisma.robot.create({
      data: {
        code,
        name: data.name,
        note: data.note ?? null,
        isActive: data.isActive ?? true,
      },
      include: robotInclude,
    });
  },

  async update(id, data, actor) {
    ensureAdmin(actor);
    await this.get(id);
    return prisma.robot.update({
      where: { id },
      data,
      include: robotInclude,
    });
  },

  async listSubsystems(robotId) {
    await this.get(robotId);
    return prisma.robotSubsystem.findMany({
      where: { robotId },
      orderBy: { id: 'asc' },
      include: subsystemInclude,
    });
  },

  async getSubsystem(id) {
    const subsystem = await prisma.robotSubsystem.findUnique({
      where: { id },
      include: subsystemInclude,
    });
    if (!subsystem) throw ApiError.notFound('找不到此子系統');
    return subsystem;
  },

  async createSubsystem(robotId, data, actor) {
    ensureAdmin(actor);
    const robot = await this.get(robotId);
    return prisma.$transaction(async (tx) => {
      const subsystemCode = await uniqueSubsystemCode(tx, robotId, data.code ?? data.name);
      const systemCode = await uniqueCode(
        tx.system,
        `${robot.code}_${subsystemCode}`,
        `SYS_${robotId}`,
      );
      const system = await tx.system.create({
        data: {
          code: systemCode,
          name: data.name,
          isActive: data.isActive ?? true,
        },
      });
      return tx.robotSubsystem.create({
        data: {
          robotId,
          systemId: system.id,
          code: subsystemCode,
          name: data.name,
          note: data.note ?? null,
          isActive: data.isActive ?? true,
        },
        include: subsystemInclude,
      });
    });
  },

  async updateSubsystem(id, data, actor) {
    ensureAdmin(actor);
    await this.getSubsystem(id);
    return prisma.robotSubsystem.update({
      where: { id },
      data,
      include: subsystemInclude,
    });
  },
};
