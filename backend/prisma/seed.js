import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

const methods = [
  { code: 'CNC', name: 'CNC Router', isActive: true },
  { code: 'LATHE', name: '車床', isActive: true },
  { code: 'MANUAL_MILL', name: '手動銑床', isActive: true },
  { code: 'LASER', name: '雷切機', isActive: true },
  { code: 'CUTOFF', name: '切斷機', isActive: true },
  { code: '3DP', name: '3D 列印', isActive: true },
];

const materials = [
  { code: 'PLA', name: 'PLA', isActive: true },
  { code: 'ABS', name: 'ABS', isActive: true },
  { code: 'PACF', name: 'PA-CF', isActive: true },
  { code: 'MDF_3MM', name: '密集板 3mm', isActive: true },
  { code: 'MDF_6MM', name: '密集板 6mm', isActive: true },
  { code: 'SRPP_6MM', name: 'SRPP 6mm', isActive: true },
  { code: 'PC_3MM', name: 'PC 3mm', isActive: true },
  { code: 'PC_6MM', name: 'PC 6mm', isActive: true },
  { code: 'AL6061_PLATE_3MM', name: '6061 鋁板 3mm', isActive: true },
  { code: 'AL6061_PLATE_5MM', name: '6061 鋁板 5mm', isActive: true },
  { code: 'HEX_SHAFT_0_5IN', name: '六角軸 1/2in', isActive: true },
  { code: 'ROUND_SHAFT_10MM', name: '圓軸 10mm', isActive: true },
  { code: 'ROUND_SHAFT_15MM', name: '圓軸 15mm', isActive: true },
];

const postProcesses = [
  { code: 'TAP', name: '攻牙', isActive: true },
  { code: 'CHAMFER', name: '倒角', isActive: true },
];

async function seedList(model, rows) {
  for (const row of rows) {
    await model.upsert({
      where: { code: row.code },
      update: row,
      create: row,
    });
  }
}

async function main() {
  for (const name of ['admin', 'member']) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });

  const adminUser = process.env.SEED_ADMIN_USER || 'admin';
  const adminPass = process.env.SEED_ADMIN_PASS || 'Admin@12345';
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  await prisma.user.upsert({
    where: { username: adminUser },
    update: {},
    create: {
      username: adminUser,
      passwordHash: await bcrypt.hash(adminPass, rounds),
      roleId: adminRole.id,
    },
  });

  await seedList(prisma.system, [
    { code: 'ARM', name: '機械手臂', isActive: true },
    { code: 'CHS', name: '底盤系統', isActive: true },
    { code: 'PWR', name: '電源模組', isActive: true },
  ]);

  await seedList(prisma.manufacturingMethod, methods);
  await seedList(prisma.material, materials);
  await seedList(prisma.postProcess, postProcesses);

  console.log('Seed completed. Admin: %s / %s', adminUser, adminPass);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
