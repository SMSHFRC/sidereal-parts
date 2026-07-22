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

const blankMachiningProgress = () => ({ pending: 0, active: 0, done: 0, total: 0, percent: 0 });
const blankPartsProgress = () => ({ needed: 0, collected: 0, open: 0, total: 0, percent: 0 });

const toMachiningProgress = (bucket = blankMachiningProgress()) => {
  const total = bucket.pending + bucket.active + bucket.done;
  return {
    ...bucket,
    total,
    percent: total ? Math.round((bucket.done / total) * 100) : 0,
  };
};

const toPartsProgress = (bucket = blankPartsProgress()) => ({
  ...bucket,
  total: bucket.needed,
  percent: bucket.needed ? Math.round((bucket.collected / bucket.needed) * 100) : 0,
});

function mergeProgress(machining, parts) {
  return {
    ...machining,
    machining,
    parts,
    percent: machining.percent,
  };
}

// Progress has two tracks: machining tasks and COTS/material collection.
async function attachProgress(robots) {
  const list = Array.isArray(robots) ? robots : [robots];
  const subsystemIds = list.flatMap((r) => r.subsystems.map((s) => s.id)).filter(Boolean);
  if (subsystemIds.length === 0) return robots;

  const [grouped, cotsRows] = await Promise.all([
    subsystemIds.length
      ? prisma.task.groupBy({
          by: ['subsystemId', 'status'],
          where: { subsystemId: { in: subsystemIds } },
          _count: { _all: true },
        })
      : [],
    subsystemIds.length
      ? prisma.cotsItem.findMany({
          where: { subsystemId: { in: subsystemIds } },
          select: { subsystemId: true, quantity: true, collectedQuantity: true, isCollected: true },
        })
      : [],
  ]);

  const bySubsystem = new Map();
  for (const g of grouped) {
    if (!g.subsystemId) continue;
    const bucket = bySubsystem.get(g.subsystemId) ?? blankMachiningProgress();
    if (g.status === 'pending') bucket.pending += g._count._all;
    else if (g.status === 'completed') bucket.done += g._count._all;
    else if (['accepted', 'processing', 'pending_review', 'post_processing'].includes(g.status)) {
      bucket.active += g._count._all;
    }
    bySubsystem.set(g.subsystemId, bucket);
  }

  const bySubsystemParts = new Map();
  for (const row of cotsRows) {
    if (!row.subsystemId) continue;
    const bucket = bySubsystemParts.get(row.subsystemId) ?? blankPartsProgress();
    const needed = Math.max(0, row.quantity);
    const collected = row.isCollected ? needed : Math.min(Math.max(0, row.collectedQuantity), needed);
    bucket.needed += needed;
    bucket.collected += collected;
    if (collected < needed) bucket.open += 1;
    bySubsystemParts.set(row.subsystemId, bucket);
  }

  for (const robot of list) {
    const machiningSum = blankMachiningProgress();
    const partsSum = blankPartsProgress();
    for (const sub of robot.subsystems) {
      const machining = toMachiningProgress(bySubsystem.get(sub.id));
      const parts = toPartsProgress(bySubsystemParts.get(sub.id));
      sub.progress = mergeProgress(machining, parts);
      machiningSum.pending += machining.pending;
      machiningSum.active += machining.active;
      machiningSum.done += machining.done;
      partsSum.needed += parts.needed;
      partsSum.collected += parts.collected;
      partsSum.open += parts.open;
    }
    robot.progress = mergeProgress(toMachiningProgress(machiningSum), toPartsProgress(partsSum));
  }
  return robots;
}

async function attachSubsystemProgress(subsystem) {
  const robot = { subsystems: [subsystem] };
  await attachProgress(robot);
  return subsystem;
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
    return attachSubsystemProgress(subsystem);
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

  async clearSubsystemContents(id, actor) {
    ensureAdmin(actor);

    return prisma.$transaction(async (tx) => {
      const subsystem = await tx.robotSubsystem.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!subsystem) throw ApiError.notFound('找不到此子系統');

      const [tasks, cotsItems] = await Promise.all([
        tx.task.findMany({
          where: { subsystemId: id },
          select: { id: true, importBatchId: true },
        }),
        tx.cotsItem.findMany({
          where: { subsystemId: id },
          select: { id: true, batchId: true },
        }),
      ]);

      const taskIds = tasks.map((task) => task.id);
      const affectedImportBatchIds = [
        ...new Set([
          ...tasks.map((task) => task.importBatchId).filter(Boolean),
          ...cotsItems.map((item) => item.batchId),
        ]),
      ];

      let removedPointEntries = 0;
      let adjustedUsers = 0;
      let affectedPrintBatchIds = [];

      if (taskIds.length > 0) {
        const [pointAdjustments, printBatchItems] = await Promise.all([
          tx.userPointsLedger.groupBy({
            by: ['userId'],
            where: { taskId: { in: taskIds } },
            _sum: { points: true },
          }),
          tx.printBatchTask.findMany({
            where: { taskId: { in: taskIds } },
            select: { batchId: true },
          }),
        ]);

        affectedPrintBatchIds = [...new Set(printBatchItems.map((item) => item.batchId))];
        const deletedPoints = await tx.userPointsLedger.deleteMany({
          where: { taskId: { in: taskIds } },
        });
        removedPointEntries = deletedPoints.count;

        for (const entry of pointAdjustments) {
          const points = entry._sum.points ?? 0;
          if (points === 0) continue;
          await tx.user.update({
            where: { id: entry.userId },
            data: { totalPoints: { decrement: BigInt(points) } },
          });
          adjustedUsers += 1;
        }
      }

      const [deletedTasks, deletedCotsItems] = await Promise.all([
        tx.task.deleteMany({ where: { subsystemId: id } }),
        tx.cotsItem.deleteMany({ where: { subsystemId: id } }),
      ]);

      if (affectedPrintBatchIds.length > 0) {
        await tx.printBatch.deleteMany({
          where: {
            id: { in: affectedPrintBatchIds },
            items: { none: {} },
          },
        });
      }

      if (affectedImportBatchIds.length > 0) {
        await tx.onshapeImportBatch.deleteMany({
          where: {
            id: { in: affectedImportBatchIds },
            tasks: { none: {} },
            cotsItems: { none: {} },
          },
        });
      }

      return {
        subsystemId: subsystem.id,
        subsystemName: subsystem.name,
        deletedTasks: deletedTasks.count,
        deletedCotsItems: deletedCotsItems.count,
        removedPointEntries,
        adjustedUsers,
      };
    });
  },
};
