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
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('主檔列表端點回傳四組 options', async () => {
  const res = await api.get('/api/v1/meta/options').set(auth(ctx.memberAToken));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.systems.length >= 1);
  assert.ok(res.body.data.methods.length >= 1);
  assert.ok(res.body.data.materials.length >= 1);
  assert.ok(res.body.data.postProcesses.length >= 1);
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
      manufacturingMethodId: 1,
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
    .send({ systemId: 1, manufacturingMethodId: 1, quantity: 3 });
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

test('未帶 token 取任務清單 401', async () => {
  const res = await api.get('/api/v1/tasks');
  assert.equal(res.status, 401);
});

test('所有 member 可見全部任務', async () => {
  const res = await api.get('/api/v1/tasks').set(auth(ctx.memberBToken));
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
