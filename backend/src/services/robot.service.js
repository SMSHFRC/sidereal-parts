import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../constants/roles.js';

const robotInclude = {
  subsystems: {
    orderBy: { id: 'asc' },
    include: {
      _count: { select: { tasks: true } },
    },
  },
  _count: { select: { tasks: true } },
};

const subsystemInclude = {
  robot: { select: { id: true, code: true, name: true } },
  _count: { select: { tasks: true } },
};

function ensureAdmin(actor) {
  if (actor.role !== ROLES.ADMIN) throw ApiError.forbidden('只有管理員可以管理機器人');
}

export const robotService = {
  list() {
    return prisma.robot.findMany({
      orderBy: { id: 'desc' },
      include: robotInclude,
    });
  },

  async get(id) {
    const robot = await prisma.robot.findUnique({ where: { id }, include: robotInclude });
    if (!robot) throw ApiError.notFound('找不到此機器人');
    return robot;
  },

  create(data, actor) {
    ensureAdmin(actor);
    return prisma.robot.create({
      data: {
        code: data.code,
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
    await this.get(robotId);
    return prisma.robotSubsystem.create({
      data: {
        robotId,
        code: data.code,
        name: data.name,
        note: data.note ?? null,
        isActive: data.isActive ?? true,
      },
      include: subsystemInclude,
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
