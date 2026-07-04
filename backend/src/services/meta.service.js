import { prisma } from '../config/prisma.js';

const orderBy = { id: 'asc' };
const active = { isActive: true };
const select = { id: true, code: true, name: true };

export const metaService = {
  async options() {
    const [systems, methods, materials, postProcesses] = await Promise.all([
      prisma.system.findMany({ where: active, select, orderBy }),
      prisma.manufacturingMethod.findMany({ where: active, select, orderBy }),
      prisma.material.findMany({ where: active, select, orderBy }),
      prisma.postProcess.findMany({ where: active, select, orderBy }),
    ]);

    return { systems, methods, materials, postProcesses };
  },
};
