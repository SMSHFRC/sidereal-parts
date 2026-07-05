import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const api = request(app);
const ctx = {};
const suffix = Date.now().toString().slice(-6);

before(async () => {
  const admin = await api
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'Admin@12345' });
  ctx.adminToken = admin.body.data.accessToken;

  const memberUsername = `meta_member_${suffix}`;
  await api.post('/api/v1/auth/register').send({
    username: memberUsername,
    password: 'Password1!',
    role: 'member',
  });
  const member = await api
    .post('/api/v1/auth/login')
    .send({ username: memberUsername, password: 'Password1!' });
  ctx.memberToken = member.body.data.accessToken;
});

after(async () => {
  await prisma.$disconnect();
});

const adminAuth = () => ({ Authorization: `Bearer ${ctx.adminToken}` });
const memberAuth = () => ({ Authorization: `Bearer ${ctx.memberToken}` });

test('admin can create and update material master data', async () => {
  const code = `TEST_MAT_${suffix}`;
  const created = await api
    .post('/api/v1/meta/admin/materials')
    .set(adminAuth())
    .send({ code, name: 'Test material' });

  assert.equal(created.status, 201);
  assert.equal(created.body.data.code, code);
  assert.equal(created.body.data.name, 'Test material');
  assert.equal(created.body.data.isActive, true);

  const updated = await api
    .patch(`/api/v1/meta/admin/materials/${created.body.data.id}`)
    .set(adminAuth())
    .send({ name: 'Updated material', isActive: false });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, 'Updated material');
  assert.equal(updated.body.data.isActive, false);
});

test('member cannot manage master data', async () => {
  const res = await api
    .post('/api/v1/meta/admin/methods')
    .set(memberAuth())
    .send({ code: `NOPE_${suffix}`, name: 'Should fail' });

  assert.equal(res.status, 403);
});
