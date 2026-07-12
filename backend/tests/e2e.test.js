// 端到端整合測試：member 建任務 → 任務池接單 → 狀態流轉 → 完成發分 → 積分轉讓。
// 需要 .env 指向可用的 PostgreSQL，並已跑過 migrate + seed。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const api = request(app);
const S = Date.now();
const pw = 'Passw0rd!';
const ctx = {};

const auth = (t) => ({ Authorization: `Bearer ${t}` });

before(async () => {
  const res = await api.post('/api/v1/auth/login').send({ username: 'admin', password: 'Admin@12345' });
  assert.equal(res.status, 200, 'admin 應能登入');
  ctx.adminToken = res.body.data.accessToken;
  // 方法 id 依 code 查（DB id 順序未必等於 seed 陣列順序）
  const opts = await api.get('/api/v1/meta/options').set(auth(ctx.adminToken));
  ctx.methodId = Object.fromEntries(opts.body.data.methods.map((m) => [m.code, m.id]));

  const testUserPrefixes = [
    'member_a_',
    'member_b_',
    'member_c_',
    'robot_worker_',
    'blocking_worker_',
    'auto_worker_',
    'machine_a_',
    'machine_b_',
    'batch_owner_',
    'batch_other_',
  ];
  const staleUsers = await prisma.user.findMany({
    where: { OR: testUserPrefixes.map((prefix) => ({ username: { startsWith: prefix } })) },
    select: { id: true },
  });
  await prisma.task.updateMany({
    where: {
      status: { in: ['accepted', 'processing'] },
      ...(staleUsers.length > 0
        ? {
            OR: [
              { assigneeId: { in: staleUsers.map((user) => user.id) } },
              { creator: { username: 'admin' } },
            ],
          }
        : {}),
    },
    data: { status: 'cancelled' },
  });
});

after(async () => {
  await prisma.$disconnect();
});

test('註冊三位 member', async () => {
  const a = await api.post('/api/v1/auth/register').send({ username: `member_a_${S}`, password: pw, role: 'member' });
  assert.equal(a.status, 201);
  assert.equal(a.body.data.user.role, 'member');
  ctx.memberAToken = a.body.data.accessToken;
  ctx.memberAId = a.body.data.user.id;

  const b = await api.post('/api/v1/auth/register').send({ username: `member_b_${S}`, password: pw, role: 'member' });
  assert.equal(b.status, 201);
  ctx.memberBToken = b.body.data.accessToken;
  ctx.memberBId = b.body.data.user.id;

  const c = await api.post('/api/v1/auth/register').send({ username: `member_c_${S}`, password: pw, role: 'member' });
  assert.equal(c.status, 201);
  ctx.memberCToken = c.body.data.accessToken;
  ctx.memberCId = c.body.data.user.id;
});

test('舊 designer / processor 角色不可再註冊', async () => {
  const res = await api.post('/api/v1/auth/register').send({ username: `old_role_${S}`, password: pw, role: 'processor' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('弱密碼註冊被擋（驗證層）', async () => {
  const res = await api.post('/api/v1/auth/register').send({ username: `weak_${S}`, password: '123', role: 'member' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.role, 'member');
});

test('member 帳號可保留中間空白', async () => {
  const username = `space user ${S}`;
  const res = await api.post('/api/v1/auth/register').send({ username, password: '123', role: 'member' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.username, username);

  const login = await api.post('/api/v1/auth/login').send({ username, password: '123' });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.username, username);
});

test('主檔列表端點回傳四組 options', async () => {
  const res = await api.get('/api/v1/meta/options').set(auth(ctx.memberAToken));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.systems.length >= 1);
  assert.ok(res.body.data.methods.length >= 1);
  assert.ok(res.body.data.materials.length >= 1);
  assert.ok(res.body.data.postProcesses.length >= 1);
});

test('機器人子系統任務完成後只留在子系統清單', async () => {
  const worker = await api
    .post('/api/v1/auth/register')
    .send({ username: `robot_worker_${S}`, password: pw, role: 'member' });
  assert.equal(worker.status, 201);
  const workerToken = worker.body.data.accessToken;

  const robot = await api
    .post('/api/v1/robots')
    .set(auth(ctx.adminToken))
    .send({ name: `Test Robot ${S}` });
  assert.equal(robot.status, 201);
  const subsystem = await api
    .post(`/api/v1/robots/${robot.body.data.id}/subsystems`)
    .set(auth(ctx.adminToken))
    .send({ name: 'Arm' });
  assert.equal(subsystem.status, 201);
  assert.ok(subsystem.body.data.system?.id);

  const created = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({
      systemId: 1,
      robotId: robot.body.data.id,
      subsystemId: subsystem.body.data.id,
      manufacturingMethodId: ctx.methodId['3DP'],
      quantity: 1,
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.subsystem.id, subsystem.body.data.id);

  const taskId = created.body.data.id;
  await api.post(`/api/v1/tasks/${taskId}/claim`).set(auth(workerToken));
  await api.patch(`/api/v1/tasks/${taskId}/status`).set(auth(workerToken)).send({ status: 'processing' });
  const completed = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(workerToken))
    .send({ status: 'completed' });
  assert.equal(completed.status, 200);

  const global = await api.get('/api/v1/tasks?limit=100').set(auth(ctx.memberAToken));
  assert.equal(global.status, 200);
  assert.equal(global.body.data.items.some((t) => t.id === taskId), false);

  const scoped = await api
    .get(`/api/v1/robots/subsystems/${subsystem.body.data.id}/tasks?limit=100`)
    .set(auth(ctx.memberAToken));
  assert.equal(scoped.status, 200);
  assert.equal(scoped.body.data.items.some((t) => t.id === taskId && t.status === 'completed'), true);
});

test('member 不可預先指派人員（接單制，403）', async () => {
  const res = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: 1, quantity: 1, assigneeId: ctx.memberBId });
  assert.equal(res.status, 403);
});

test('member 建立任務（進任務池）：編號格式 ARM-####、積分 (5+2)*10=70', async () => {
  const res = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({
      systemId: 1,
      manufacturingMethodId: ctx.methodId.MANUAL_MILL, // base 5、免驗收（走標準流程）
      quantity: 10,
      postProcessId: 1,
    });
  assert.equal(res.status, 201);
  assert.match(res.body.data.partNumber, /^ARM-\d{4}$/);
  assert.equal(res.body.data.rewardPoints, 70);
  assert.equal(res.body.data.status, 'pending');
  assert.equal(res.body.data.assignee, null);
  ctx.taskId = res.body.data.id;
  ctx.firstSeq = Number(res.body.data.partNumber.split('-')[1]);
});

test('第二個任務編號遞增 +1（並發計數器）', async () => {
  const res = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId.MANUAL_MILL, quantity: 3 });
  assert.equal(res.status, 201);
  assert.equal(Number(res.body.data.partNumber.split('-')[1]), ctx.firstSeq + 1);
  assert.equal(res.body.data.rewardPoints, 15);
  ctx.selfTaskId = res.body.data.id;
});

test('並發建立 10 筆任務：編號皆唯一', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      api
        .post('/api/v1/tasks')
        .set(auth(ctx.memberAToken))
        .send({ systemId: 1, manufacturingMethodId: 1, quantity: 1 }),
    ),
  );
  results.forEach((r) => assert.equal(r.status, 201));
  const numbers = results.map((r) => r.body.data.partNumber);
  assert.equal(new Set(numbers).size, 10, '10 筆並發不可有重複編號');
});

test('急件可由建立者標記與取消，且在清單中優先排序', async () => {
  const forbidden = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/priority`)
    .set(auth(ctx.memberBToken))
    .send({ isUrgent: true, reason: '不應成功' });
  assert.equal(forbidden.status, 403);

  const marked = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/priority`)
    .set(auth(ctx.memberAToken))
    .send({ isUrgent: true, reason: '阻擋組裝進度' });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.data.isUrgent, true);
  assert.equal(marked.body.data.urgentReason, '阻擋組裝進度');
  assert.equal(marked.body.data.urgentBy.id, ctx.memberAId);
  assert.ok(marked.body.data.urgentAt);

  const created = await api
    .get('/api/v1/tasks?scope=created&limit=100')
    .set(auth(ctx.memberAToken));
  assert.equal(created.status, 200);
  assert.equal(created.body.data.items[0].id, ctx.taskId);

  const cleared = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/priority`)
    .set(auth(ctx.memberAToken))
    .send({ isUrgent: false });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.isUrgent, false);
  assert.equal(cleared.body.data.urgentReason, '阻擋組裝進度');
  assert.equal(cleared.body.data.urgentBy.id, ctx.memberAId);
  assert.ok(cleared.body.data.urgentAt);
});

test('未帶 token 取任務清單 401', async () => {
  const res = await api.get('/api/v1/tasks');
  assert.equal(res.status, 401);
});

test('所有 member 可見全部任務', async () => {
  const res = await api.get('/api/v1/tasks?limit=100').set(auth(ctx.memberBToken));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.items.some((t) => t.id === ctx.taskId));
});

test('非法狀態轉換被擋：pending -> completed 400', async () => {
  const res = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'completed' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_STATUS_TRANSITION');
});

test('兩個 member 同時接同一任務，恰一人成功、另一人 409', async () => {
  const [r1, r2] = await Promise.all([
    api.post(`/api/v1/tasks/${ctx.taskId}/claim`).set(auth(ctx.memberBToken)),
    api.post(`/api/v1/tasks/${ctx.taskId}/claim`).set(auth(ctx.memberCToken)),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409]);

  const winner = r1.status === 200 ? r1 : r2;
  ctx.claimWinnerToken = r1.status === 200 ? ctx.memberBToken : ctx.memberCToken;
  ctx.claimWinnerId = winner.body.data.assignee.id;
  assert.equal(winner.body.data.status, 'accepted');
});

test('放棄任務會清空 assignee 並退回 pending 任務池', async () => {
  const res = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.claimWinnerToken))
    .send({ status: 'rejected' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'pending');
  assert.equal(res.body.data.assignee, null);

  const history = await prisma.taskStatusHistory.findMany({
    where: { taskId: BigInt(ctx.taskId), toStatus: 'rejected' },
  });
  assert.equal(history.length, 1);
});

test('接單制完整流程：member B 接單 -> 加工 -> 交棒 -> member B 接後處理 -> 完成', async () => {
  const claim = await api.post(`/api/v1/tasks/${ctx.taskId}/claim`).set(auth(ctx.memberBToken));
  assert.equal(claim.status, 200);
  assert.equal(claim.body.data.assignee.username, `member_b_${S}`);

  const p2try = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.memberCToken))
    .send({ status: 'processing' });
  assert.equal(p2try.status, 403);

  const proc = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'processing' });
  assert.equal(proc.status, 200);
  assert.ok(proc.body.data.processingStartedAt);

  const simulated = await api
    .post(`/api/v1/tasks/${ctx.taskId}/simulate-timeout`)
    .set(auth(ctx.adminToken));
  assert.equal(simulated.status, 200);
  assert.ok(Date.now() - new Date(simulated.body.data.processingStartedAt).getTime() >= 30 * 60 * 1000);

  const extended = await api
    .post(`/api/v1/tasks/${ctx.taskId}/extend-time`)
    .set(auth(ctx.adminToken));
  assert.equal(extended.status, 200);
  assert.equal(extended.body.data.machiningExtensionMinutes, 20);

  const skip = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'completed' });
  assert.equal(skip.status, 400);
  assert.equal(skip.body.error.code, 'POST_PROCESS_REQUIRED');

  const hand = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'post_processing' });
  assert.equal(hand.status, 200);
  assert.equal(hand.body.data.postProcessor, null);

  const early = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'completed' });
  assert.equal(early.status, 400);
  assert.equal(early.body.error.code, 'POST_PROCESSOR_REQUIRED');

  const cp = await api
    .post(`/api/v1/tasks/${ctx.taskId}/claim-post-process`)
    .set(auth(ctx.memberBToken));
  assert.equal(cp.status, 200);
  assert.equal(cp.body.data.postProcessor.username, `member_b_${S}`);

  const done = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'completed' });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.status, 'completed');
});

test('完成後 member B 獲得 70 積分（加工 50 + 後處理 20，兩筆明細）', async () => {
  const res = await api.get('/api/v1/auth/me').set(auth(ctx.memberBToken));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.totalPoints, '70');

  const ledger = await api.get('/api/v1/points/me/ledger').set(auth(ctx.memberBToken));
  const reasons = ledger.body.data.items.map((i) => i.reason);
  assert.ok(reasons.includes('machining_completed'), '應有加工分明細');
  assert.ok(reasons.includes('post_process_completed'), '應有後處理分明細');
});

test('同一帳號建任務並自己接單，可完整完成且積分正確', async () => {
  const claim = await api.post(`/api/v1/tasks/${ctx.selfTaskId}/claim`).set(auth(ctx.memberAToken));
  assert.equal(claim.status, 200);
  assert.equal(claim.body.data.assignee.id, ctx.memberAId);

  const proc = await api
    .patch(`/api/v1/tasks/${ctx.selfTaskId}/status`)
    .set(auth(ctx.memberAToken))
    .send({ status: 'processing' });
  assert.equal(proc.status, 200);

  const done = await api
    .patch(`/api/v1/tasks/${ctx.selfTaskId}/status`)
    .set(auth(ctx.memberAToken))
    .send({ status: 'completed' });
  assert.equal(done.status, 200);

  const me = await api.get('/api/v1/auth/me').set(auth(ctx.memberAToken));
  assert.equal(me.body.data.totalPoints, '15');
});

test('看板分頁會各自回傳最新完成任務', async () => {
  const [pool, assigned, created, all] = await Promise.all([
    api.get('/api/v1/tasks?scope=pool&board=true&limit=100').set(auth(ctx.memberBToken)),
    api.get('/api/v1/tasks?scope=assigned&board=true&limit=100').set(auth(ctx.memberBToken)),
    api.get('/api/v1/tasks?scope=created&board=true&limit=100').set(auth(ctx.memberAToken)),
    api.get('/api/v1/tasks?scope=all&board=true&limit=100').set(auth(ctx.memberCToken)),
  ]);

  for (const response of [pool, assigned, created, all]) assert.equal(response.status, 200);
  assert.equal(pool.body.data.items.some((task) => task.id === ctx.taskId), false);
  assert.equal(assigned.body.data.items.some((task) => task.id === ctx.taskId && task.status === 'completed'), true);
  assert.equal(created.body.data.items.some((task) => task.id === ctx.taskId && task.status === 'completed'), true);
  assert.equal(all.body.data.items.some((task) => task.id === ctx.taskId && task.status === 'completed'), true);
});

test('積分轉讓：member B 轉 30 給 member C', async () => {
  const res = await api
    .post('/api/v1/points/transfer')
    .set(auth(ctx.memberBToken))
    .send({ toUserId: ctx.memberCId, points: 30, note: 'test' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.balance, '40');

  const me1 = await api.get('/api/v1/auth/me').set(auth(ctx.memberBToken));
  assert.equal(me1.body.data.totalPoints, '40');
  const me2 = await api.get('/api/v1/auth/me').set(auth(ctx.memberCToken));
  assert.equal(me2.body.data.totalPoints, '30');
});

test('加工者積分排行榜依積分排序，member 可讀取', async () => {
  const res = await api.get('/api/v1/users/leaderboard').set(auth(ctx.memberAToken));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 3);
  const points = res.body.data.map((u) => Number(u.totalPoints));
  assert.deepEqual(points, [...points].sort((a, b) => b - a));
  assert.equal(res.body.data[0].rank, 1);
});

test('餘額不足轉讓被擋（400 INSUFFICIENT_POINTS）', async () => {
  const res = await api
    .post('/api/v1/points/transfer')
    .set(auth(ctx.memberBToken))
    .send({ toUserId: ctx.memberCId, points: 999999 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INSUFFICIENT_POINTS');
});

test('不可轉給自己（400）', async () => {
  const res = await api
    .post('/api/v1/points/transfer')
    .set(auth(ctx.memberBToken))
    .send({ toUserId: ctx.memberBId, points: 1 });
  assert.equal(res.status, 400);
});

test('已完成任務不可刪除（TASK_LOCKED）', async () => {
  const res = await api.delete(`/api/v1/tasks/${ctx.taskId}`).set(auth(ctx.memberAToken));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'TASK_LOCKED');
});

test('驗收制：CNC 任務需管理員驗收才完成並發積分', async () => {
  const opts = await api.get('/api/v1/meta/options').set(auth(ctx.adminToken));
  const cnc = opts.body.data.methods.find((m) => m.code === 'CNC');
  assert.ok(cnc?.requiresReview, 'CNC 應需驗收');

  const created = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: cnc.id, quantity: 2 });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.rewardPoints, 10); // 5 * 2
  const taskId = created.body.data.id;

  await api.post(`/api/v1/tasks/${taskId}/claim`).set(auth(ctx.memberCToken));
  await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberCToken))
    .send({ status: 'processing' });

  // 直接完成被擋（需送審）
  const direct = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberCToken))
    .send({ status: 'completed' });
  assert.equal(direct.status, 400);
  assert.equal(direct.body.error.code, 'REVIEW_REQUIRED');

  // 送審
  const submit = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberCToken))
    .send({ status: 'pending_review' });
  assert.equal(submit.status, 200);
  assert.equal(submit.body.data.status, 'pending_review');

  // 加工者不能自己驗收
  const selfApprove = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberCToken))
    .send({ status: 'completed' });
  assert.equal(selfApprove.status, 403);

  const before = Number(
    (await api.get('/api/v1/auth/me').set(auth(ctx.memberCToken))).body.data.totalPoints,
  );
  // admin 驗收通過 → 完成 + 發加工分
  const approve = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.adminToken))
    .send({ status: 'completed' });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.data.status, 'completed');
  const after = Number(
    (await api.get('/api/v1/auth/me').set(auth(ctx.memberCToken))).body.data.totalPoints,
  );
  assert.equal(after - before, 10, '驗收通過後加工者得 10 分（5x2）');
});

test('3D 列印基礎積分為 1（免驗收，直接完成）', async () => {
  const opts = await api.get('/api/v1/meta/options').set(auth(ctx.adminToken));
  const tdp = opts.body.data.methods.find((m) => m.code === '3DP');
  assert.equal(tdp.basePoints, 1);
  assert.equal(tdp.requiresReview, false);

  const created = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: tdp.id, quantity: 3 });
  assert.equal(created.body.data.rewardPoints, 3); // 1 * 3
  const taskId = created.body.data.id;

  const before = Number(
    (await api.get('/api/v1/auth/me').set(auth(ctx.memberAToken))).body.data.totalPoints,
  );
  await api.post(`/api/v1/tasks/${taskId}/claim`).set(auth(ctx.memberAToken));
  await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberAToken))
    .send({ status: 'processing' });
  const done = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberAToken))
    .send({ status: 'completed' });
  assert.equal(done.status, 200);
  const after = Number(
    (await api.get('/api/v1/auth/me').set(auth(ctx.memberAToken))).body.data.totalPoints,
  );
  assert.equal(after - before, 3, '3DP 完成得 1 分/件 x3 = 3');
});

test('管理員不能替加工者標記完成（免驗收任務）', async () => {
  const opts = await api.get('/api/v1/meta/options').set(auth(ctx.adminToken));
  const manual = opts.body.data.methods.find((m) => m.code === 'MANUAL_MILL'); // 免驗收
  const created = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: manual.id, quantity: 1 });
  const taskId = created.body.data.id;
  await api.post(`/api/v1/tasks/${taskId}/claim`).set(auth(ctx.memberBToken));
  await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'processing' });

  // 管理員不能直接標記完成
  const adminDone = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.adminToken))
    .send({ status: 'completed' });
  assert.equal(adminDone.status, 403);

  // 加工者可以完成
  const done = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'completed' });
  assert.equal(done.status, 200);
});

test('退回重做後：管理員不可送審/放棄，加工者可重新送審', async () => {
  const opts = await api.get('/api/v1/meta/options').set(auth(ctx.adminToken));
  const cnc = opts.body.data.methods.find((m) => m.code === 'CNC');
  const created = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: cnc.id, quantity: 1 });
  const taskId = created.body.data.id;
  await api.post(`/api/v1/tasks/${taskId}/claim`).set(auth(ctx.memberBToken));
  await api.patch(`/api/v1/tasks/${taskId}/status`).set(auth(ctx.memberBToken)).send({ status: 'processing' });
  await api.patch(`/api/v1/tasks/${taskId}/status`).set(auth(ctx.memberBToken)).send({ status: 'pending_review' });

  // 管理員退回重做
  const back = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.adminToken))
    .send({ status: 'processing' });
  assert.equal(back.status, 200);
  assert.equal(back.body.data.status, 'processing');
  assert.equal(back.body.data.reviewRejected, true);

  // 管理員不能替加工者送審或放棄
  const adminSubmit = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.adminToken))
    .send({ status: 'pending_review' });
  assert.equal(adminSubmit.status, 403);
  const adminReject = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.adminToken))
    .send({ status: 'rejected' });
  assert.equal(adminReject.status, 403);

  // 加工者可重新送審
  const resubmit = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(ctx.memberBToken))
    .send({ status: 'pending_review' });
  assert.equal(resubmit.status, 200);
});

test('subsystem progress counts pending tasks by subsystem ownership', async () => {
  const robot = await api
    .post('/api/v1/robots')
    .set(auth(ctx.adminToken))
    .send({ name: `Progress Robot ${S}` });
  assert.equal(robot.status, 201);

  const subsystem = await api
    .post(`/api/v1/robots/${robot.body.data.id}/subsystems`)
    .set(auth(ctx.adminToken))
    .send({ name: 'Progress Subsystem' });
  assert.equal(subsystem.status, 201);

  const task = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({
      systemId: subsystem.body.data.system.id,
      robotId: robot.body.data.id,
      subsystemId: subsystem.body.data.id,
      manufacturingMethodId: ctx.methodId['3DP'],
      quantity: 1,
    });
  assert.equal(task.status, 201);
  assert.equal(task.body.data.status, 'pending');

  const current = await api.get(`/api/v1/robots/${robot.body.data.id}`).set(auth(ctx.memberAToken));
  assert.equal(current.status, 200);
  assert.equal(current.body.data.subsystems[0].progress.machining.pending, 1);
  assert.equal(current.body.data.progress.machining.pending, 1);
});

test('blocking 加工者可先接多件，但開始加工時不可同時做兩件 blocking 任務', async () => {
  await prisma.task.updateMany({
    where: {
      manufacturingMethodId: ctx.methodId.CUTOFF,
      status: 'processing',
    },
    data: { status: 'cancelled' },
  });

  const worker = await api
    .post('/api/v1/auth/register')
    .send({ username: `blocking_worker_${S}`, password: pw, role: 'member' });
  assert.equal(worker.status, 201);
  const token = worker.body.data.accessToken;

  const first = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId.CUTOFF, quantity: 1 });
  const second = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId.CUTOFF, quantity: 1 });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const claimFirst = await api.post(`/api/v1/tasks/${first.body.data.id}/claim`).set(auth(token));
  assert.equal(claimFirst.status, 200);

  const claimSecond = await api.post(`/api/v1/tasks/${second.body.data.id}/claim`).set(auth(token));
  assert.equal(claimSecond.status, 200);

  const startFirst = await api
    .patch(`/api/v1/tasks/${first.body.data.id}/status`)
    .set(auth(token))
    .send({ status: 'processing' });
  assert.equal(startFirst.status, 200);

  const startSecond = await api
    .patch(`/api/v1/tasks/${second.body.data.id}/status`)
    .set(auth(token))
    .send({ status: 'processing' });
  assert.equal(startSecond.status, 409);
  assert.equal(startSecond.body.error.code, 'BLOCKING_WORK_ACTIVE');
});

test('automatic 3D 列印不阻擋同一加工者接 blocking 任務', async () => {
  const worker = await api
    .post('/api/v1/auth/register')
    .send({ username: `auto_worker_${S}`, password: pw, role: 'member' });
  assert.equal(worker.status, 201);
  const token = worker.body.data.accessToken;

  const printTask = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId['3DP'], quantity: 1 });
  assert.equal(printTask.status, 201);
  await api.post(`/api/v1/tasks/${printTask.body.data.id}/claim`).set(auth(token));
  const startPrint = await api
    .patch(`/api/v1/tasks/${printTask.body.data.id}/status`)
    .set(auth(token))
    .send({ status: 'processing' });
  assert.equal(startPrint.status, 200);

  const blockingTask = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId.CNC, quantity: 1 });
  assert.equal(blockingTask.status, 201);
  const claimBlocking = await api.post(`/api/v1/tasks/${blockingTask.body.data.id}/claim`).set(auth(token));
  assert.equal(claimBlocking.status, 200);
});

test('一般設備同時只能有一個 processing 任務', async () => {
  const a = await api
    .post('/api/v1/auth/register')
    .send({ username: `machine_a_${S}`, password: pw, role: 'member' });
  const b = await api
    .post('/api/v1/auth/register')
    .send({ username: `machine_b_${S}`, password: pw, role: 'member' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const first = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId.MANUAL_MILL, quantity: 1 });
  const second = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId.MANUAL_MILL, quantity: 1 });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  await api.post(`/api/v1/tasks/${first.body.data.id}/claim`).set(auth(a.body.data.accessToken));
  const startFirst = await api
    .patch(`/api/v1/tasks/${first.body.data.id}/status`)
    .set(auth(a.body.data.accessToken))
    .send({ status: 'processing' });
  assert.equal(startFirst.status, 200);

  await api.post(`/api/v1/tasks/${second.body.data.id}/claim`).set(auth(b.body.data.accessToken));
  const startSecond = await api
    .patch(`/api/v1/tasks/${second.body.data.id}/status`)
    .set(auth(b.body.data.accessToken))
    .send({ status: 'processing' });
  assert.equal(startSecond.status, 409);
  assert.equal(startSecond.body.error.code, 'MACHINE_BUSY');
});

test('3D 合併列印需確認他人任務轉移並保留轉移紀錄', async () => {
  const owner = await api
    .post('/api/v1/auth/register')
    .send({ username: `batch_owner_${S}`, password: pw, role: 'member' });
  const other = await api
    .post('/api/v1/auth/register')
    .send({ username: `batch_other_${S}`, password: pw, role: 'member' });
  assert.equal(owner.status, 201);
  assert.equal(other.status, 201);
  const ownerToken = owner.body.data.accessToken;
  const otherToken = other.body.data.accessToken;

  const main = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId['3DP'], quantity: 1 });
  const mine = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId['3DP'], quantity: 1 });
  const transferred = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId['3DP'], quantity: 1 });
  assert.equal(main.status, 201);
  assert.equal(mine.status, 201);
  assert.equal(transferred.status, 201);

  await api.post(`/api/v1/tasks/${main.body.data.id}/claim`).set(auth(ownerToken));
  await api.post(`/api/v1/tasks/${mine.body.data.id}/claim`).set(auth(ownerToken));
  await api.post(`/api/v1/tasks/${transferred.body.data.id}/claim`).set(auth(otherToken));

  const needsConfirm = await api
    .post(`/api/v1/tasks/${main.body.data.id}/print-batch/start`)
    .set(auth(ownerToken))
    .send({ taskIds: [mine.body.data.id, transferred.body.data.id] });
  assert.equal(needsConfirm.status, 409);
  assert.equal(needsConfirm.body.error.code, 'TRANSFER_CONFIRMATION_REQUIRED');

  const started = await api
    .post(`/api/v1/tasks/${main.body.data.id}/print-batch/start`)
    .set(auth(ownerToken))
    .send({ taskIds: [mine.body.data.id, transferred.body.data.id], confirmTransfer: true });
  assert.equal(started.status, 201);
  assert.equal(started.body.data.items.length, 3);
  assert.ok(started.body.data.items.every((item) => item.task.status === 'processing'));
  assert.ok(started.body.data.items.every((item) => item.task.assignee.id === owner.body.data.user.id));

  const transferRows = await prisma.taskAssignmentTransfer.findMany({
    where: { taskId: BigInt(transferred.body.data.id), reason: 'merge_print_batch' },
  });
  assert.equal(transferRows.length, 1);
  assert.equal(transferRows[0].fromAssigneeId.toString(), other.body.data.user.id);
  assert.equal(transferRows[0].toAssigneeId.toString(), owner.body.data.user.id);
});

test('急件：開始加工後不可再變更（URGENT_LOCKED）', async () => {
  // 3DP：非阻斷式設備，可同時多個 processing，避免與其他測試互卡
  const worker = await api
    .post('/api/v1/auth/register')
    .send({ username: `urgent_worker_${Date.now()}`, password: pw, role: 'member' });
  assert.equal(worker.status, 201);
  const workerToken = worker.body.data.accessToken;

  const created = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId['3DP'], quantity: 1 });
  assert.equal(created.status, 201);
  const taskId = created.body.data.id;

  // pending 階段：建立者可標急件
  const mark = await api
    .patch(`/api/v1/tasks/${taskId}/priority`)
    .set(auth(ctx.memberAToken))
    .send({ isUrgent: true, reason: '比賽在即' });
  assert.equal(mark.status, 200);
  assert.equal(mark.body.data.isUrgent, true);

  // 接單 → 開始加工（用全新 member 避免「同時只能一個 processing」衝突）
  const claim = await api.post(`/api/v1/tasks/${taskId}/claim`).set(auth(workerToken));
  assert.equal(claim.status, 200);
  const proc = await api
    .patch(`/api/v1/tasks/${taskId}/status`)
    .set(auth(workerToken))
    .send({ status: 'processing' });
  assert.equal(proc.status, 200);
  assert.equal(proc.body.data.status, 'processing');

  // 開始加工後：不可再變更急件（連 admin 也不行）
  const locked = await api
    .patch(`/api/v1/tasks/${taskId}/priority`)
    .set(auth(ctx.adminToken))
    .send({ isUrgent: false });
  assert.equal(locked.status, 400);
  assert.equal(locked.body.error.code, 'URGENT_LOCKED');
});

test('版本管理：Create Revision 建立下一版並封存舊版', async () => {
  const created = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.memberAToken))
    .send({ systemId: 1, manufacturingMethodId: ctx.methodId['3DP'], quantity: 2 });
  assert.equal(created.status, 201);
  const rev1 = created.body.data;
  assert.equal(rev1.revision, 1);
  assert.equal(rev1.revisionStatus, 'current');
  const partNumber = rev1.partNumber;

  // 非建立者、非管理員 → 403
  const forbidden = await api
    .post(`/api/v1/tasks/${rev1.id}/revision`)
    .set(auth(ctx.memberBToken));
  assert.equal(forbidden.status, 403);

  // 建立者建立新版本
  const revved = await api.post(`/api/v1/tasks/${rev1.id}/revision`).set(auth(ctx.memberAToken));
  assert.equal(revved.status, 201);
  const rev2 = revved.body.data;
  assert.equal(rev2.revision, 2);
  assert.equal(rev2.revisionStatus, 'current');
  assert.equal(rev2.partNumber, partNumber, '版本沿用相同 Part Number');
  assert.equal(rev2.status, 'pending', '新版本回到任務池');
  assert.notEqual(rev2.id, rev1.id);

  // 舊版本已封存
  const oldTask = await api.get(`/api/v1/tasks/${rev1.id}`).set(auth(ctx.memberAToken));
  assert.equal(oldTask.body.data.revisionStatus, 'archived');
  assert.equal(oldTask.body.data.supersededById, rev2.id);

  // 版本清單：新到舊，兩版都在
  const list = await api.get(`/api/v1/tasks/${rev2.id}/revisions`).set(auth(ctx.memberAToken));
  assert.equal(list.status, 200);
  const revs = list.body.data.map((t) => t.revision);
  assert.deepEqual(revs, [2, 1]);

  // 不可從已封存的舊版本再建立版本
  const again = await api.post(`/api/v1/tasks/${rev1.id}/revision`).set(auth(ctx.memberAToken));
  assert.equal(again.status, 400);
  assert.equal(again.body.error.code, 'NOT_CURRENT_REVISION');
});
