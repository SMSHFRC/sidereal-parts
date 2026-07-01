// 端到端整合測試：登入 → 建任務 → 狀態流轉 → 完成發分 → 積分轉讓 → 權限/驗證
// 需要 .env 指向可用的 PostgreSQL，並已跑過 migrate + seed。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const api = request(app);
const S = Date.now(); // 讓每次執行的帳號唯一，避免 409
const pw = 'Passw0rd!';

// 共用狀態
const ctx = {};

const auth = (t) => ({ Authorization: `Bearer ${t}` });

before(async () => {
  // 管理員（seed 建立）
  const res = await api.post('/api/v1/auth/login').send({ username: 'admin', password: 'Admin@12345' });
  assert.equal(res.status, 200, 'admin 應能登入');
  ctx.adminToken = res.body.data.accessToken;
});

after(async () => {
  await prisma.$disconnect();
});

test('註冊 designer 與兩位 processor', async () => {
  const d = await api.post('/api/v1/auth/register').send({ username: `designer_${S}`, password: pw, role: 'designer' });
  assert.equal(d.status, 201);
  ctx.designerToken = d.body.data.accessToken;

  const p1 = await api.post('/api/v1/auth/register').send({ username: `proc1_${S}`, password: pw, role: 'processor' });
  assert.equal(p1.status, 201);
  ctx.p1Token = p1.body.data.accessToken;
  ctx.p1Id = p1.body.data.user.id;

  const p2 = await api.post('/api/v1/auth/register').send({ username: `proc2_${S}`, password: pw, role: 'processor' });
  assert.equal(p2.status, 201);
  ctx.p2Token = p2.body.data.accessToken;
  ctx.p2Id = p2.body.data.user.id;
});

test('弱密碼註冊被擋（驗證層）', async () => {
  const res = await api.post('/api/v1/auth/register').send({ username: `weak_${S}`, password: '123', role: 'processor' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('designer 建立任務：編號格式 ARM-####、積分 (5+2)*10=70', async () => {
  const res = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.designerToken))
    .send({ systemId: 1, manufacturingMethodId: 1, quantity: 10, postProcessId: 1, assigneeId: ctx.p1Id });
  assert.equal(res.status, 201);
  assert.match(res.body.data.partNumber, /^ARM-\d{4}$/);
  assert.equal(res.body.data.rewardPoints, 70);
  assert.equal(res.body.data.status, 'pending');
  ctx.taskId = res.body.data.id;
  ctx.firstSeq = Number(res.body.data.partNumber.split('-')[1]);
});

test('第二個任務編號遞增 +1（並發計數器）', async () => {
  const res = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.designerToken))
    .send({ systemId: 1, manufacturingMethodId: 1, quantity: 3 });
  assert.equal(res.status, 201);
  assert.equal(Number(res.body.data.partNumber.split('-')[1]), ctx.firstSeq + 1);
  assert.equal(res.body.data.rewardPoints, 15); // 無後處理：5*3
});

test('並發建立 10 筆任務：編號皆唯一且連號（concurrency-safe）', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      api
        .post('/api/v1/tasks')
        .set(auth(ctx.designerToken))
        .send({ systemId: 1, manufacturingMethodId: 1, quantity: 1 }),
    ),
  );
  const numbers = results.map((r) => r.body.data.partNumber);
  const unique = new Set(numbers);
  assert.equal(unique.size, 10, '10 筆並發不可有重複編號');
  results.forEach((r) => assert.equal(r.status, 201));
});

test('processor 不能建立任務（RBAC 403）', async () => {
  const res = await api
    .post('/api/v1/tasks')
    .set(auth(ctx.p1Token))
    .send({ systemId: 1, manufacturingMethodId: 1, quantity: 1 });
  assert.equal(res.status, 403);
});

test('未帶 token 取任務清單 401', async () => {
  const res = await api.get('/api/v1/tasks');
  assert.equal(res.status, 401);
});

test('非法狀態轉換被擋：pending -> completed 400', async () => {
  const res = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.p1Token))
    .send({ status: 'completed' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_STATUS_TRANSITION');
});

test('非指派者不能變更狀態（403）', async () => {
  const res = await api
    .patch(`/api/v1/tasks/${ctx.taskId}/status`)
    .set(auth(ctx.p2Token))
    .send({ status: 'accepted' });
  assert.equal(res.status, 403);
});

test('加工者流程 accepted -> processing -> completed', async () => {
  for (const status of ['accepted', 'processing', 'completed']) {
    const res = await api
      .patch(`/api/v1/tasks/${ctx.taskId}/status`)
      .set(auth(ctx.p1Token))
      .send({ status });
    assert.equal(res.status, 200, `轉換到 ${status} 應成功`);
    assert.equal(res.body.data.status, status);
  }
});

test('完成後加工者 p1 獲得 70 積分', async () => {
  const res = await api.get('/api/v1/auth/me').set(auth(ctx.p1Token));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.totalPoints, '70');
});

test('積分轉讓：p1 轉 30 給 p2', async () => {
  const res = await api
    .post('/api/v1/points/transfer')
    .set(auth(ctx.p1Token))
    .send({ toUserId: ctx.p2Id, points: 30, note: 'test' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.balance, '40'); // 70 - 30

  const me1 = await api.get('/api/v1/auth/me').set(auth(ctx.p1Token));
  assert.equal(me1.body.data.totalPoints, '40');
  const me2 = await api.get('/api/v1/auth/me').set(auth(ctx.p2Token));
  assert.equal(me2.body.data.totalPoints, '30');
});

test('餘額不足轉讓被擋（400 INSUFFICIENT_POINTS）', async () => {
  const res = await api
    .post('/api/v1/points/transfer')
    .set(auth(ctx.p1Token))
    .send({ toUserId: ctx.p2Id, points: 999999 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INSUFFICIENT_POINTS');
});

test('不可轉給自己（400）', async () => {
  const res = await api
    .post('/api/v1/points/transfer')
    .set(auth(ctx.p1Token))
    .send({ toUserId: ctx.p1Id, points: 1 });
  assert.equal(res.status, 400);
});

test('已完成任務不可刪除（TASK_LOCKED）', async () => {
  const res = await api.delete(`/api/v1/tasks/${ctx.taskId}`).set(auth(ctx.designerToken));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'TASK_LOCKED');
});

test('processor 清單只看得到自己被指派的任務', async () => {
  const res = await api.get('/api/v1/tasks').set(auth(ctx.p1Token));
  assert.equal(res.status, 200);
  for (const t of res.body.data.items) {
    assert.equal(String(t.assignee?.id), String(ctx.p1Id));
  }
});
