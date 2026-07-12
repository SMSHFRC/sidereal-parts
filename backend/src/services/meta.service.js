import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

const orderBy = { id: 'asc' };
const active = { isActive: true };
const select = { id: true, code: true, name: true };
const methodSelect = {
  id: true,
  code: true,
  name: true,
  basePoints: true,
  requiresReview: true,
  occupancy: true,
  reminderMinutes: true,
};
const adminSelect = { id: true, code: true, name: true, isActive: true };

const masterModels = {
  methods: prisma.manufacturingMethod,
  materials: prisma.material,
  postProcesses: prisma.postProcess,
};

const modelFor = (type) => {
  const model = masterModels[type];
  if (!model) throw ApiError.badRequest('Unknown master data type', 'INVALID_MASTER_TYPE');
  return model;
};

const normalizeCode = (code) => code.trim().toUpperCase();

async function assertUniqueCode(model, code, id = null) {
  const found = await model.findUnique({ where: { code } });
  if (found && found.id !== id) {
    throw ApiError.conflict('Code already exists', 'MASTER_CODE_EXISTS');
  }
}

export const metaService = {
  async options() {
    const [systems, methods, materials, postProcesses] = await Promise.all([
      prisma.system.findMany({ where: active, select, orderBy }),
      prisma.manufacturingMethod.findMany({ where: active, select: methodSelect, orderBy }),
      prisma.material.findMany({ where: active, select, orderBy }),
      prisma.postProcess.findMany({ where: active, select, orderBy }),
    ]);

    return { systems, methods, materials, postProcesses };
  },

  async listMaster(type) {
    return modelFor(type).findMany({ select: adminSelect, orderBy });
  },

  async createMaster(type, data) {
    const model = modelFor(type);
    const code = normalizeCode(data.code);
    await assertUniqueCode(model, code);
    return model.create({
      data: {
        code,
        name: data.name.trim(),
        isActive: data.isActive ?? true,
      },
      select: adminSelect,
    });
  },

  async updateMaster(type, id, data) {
    const model = modelFor(type);
    const existing = await model.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Master data item not found', 'MASTER_NOT_FOUND');

    const patch = {};
    if (data.code !== undefined) {
      patch.code = normalizeCode(data.code);
      await assertUniqueCode(model, patch.code, id);
    }
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.isActive !== undefined) patch.isActive = data.isActive;

    return model.update({ where: { id }, data: patch, select: adminSelect });
  },
};
