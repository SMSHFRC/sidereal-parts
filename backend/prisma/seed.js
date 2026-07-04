// 種子資料：角色、預設 admin、主檔
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  // 角色
  const roleNames = ['admin', 'member'];
  for (const name of roleNames) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });

  // 預設 admin（帳密可用環境變數覆蓋）
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

  // 主檔
  const seedList = async (model, rows) => {
    for (const r of rows) {
      await model.upsert({ where: { code: r.code }, update: {}, create: r });
    }
  };
  await seedList(prisma.system, [
    { code: 'ARM', name: '機械手臂' },
    { code: 'CHS', name: '底盤系統' },
    { code: 'PWR', name: '電源模組' },
  ]);
  await seedList(prisma.manufacturingMethod, [
    { code: 'CNC', name: 'CNC 銑削' },
    { code: 'LATHE', name: '車床' },
    { code: '3DP', name: '3D 列印' },
  ]);
  await seedList(prisma.material, [
    { code: 'AL6061', name: '鋁 6061' },
    { code: 'SUS304', name: '不鏽鋼 304' },
    { code: 'PLA', name: 'PLA' },
  ]);
  await seedList(prisma.postProcess, [
    { code: 'ANODIZE', name: '陽極處理' },
    { code: 'SANDBLAST', name: '噴砂' },
    { code: 'POLISH', name: '拋光' },
  ]);

  console.log('Seed 完成。預設 admin：%s / %s（請立即更改）', adminUser, adminPass);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
