// M3 Onshape 整合測試：URL 解析（單元）+ 端點防護（未設定/未連結/亂輸入）
// 不需要真實 Onshape 憑證；OAuth 實連流程須手動驗證（見 PROGRESS.md M3 節）。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';
import { parseOnshapeUrl } from '../src/utils/onshapeUrl.js';
import { encrypt, decrypt } from '../src/utils/cryptoBox.js';

const api = request(app);
const ctx = {};

before(async () => {
  const res = await api
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'Admin@12345' });
  ctx.token = res.body.data.accessToken;
});

after(async () => {
  await prisma.$disconnect();
});

const auth = () => ({ Authorization: `Bearer ${ctx.token}` });

// ---------- 單元：URL 解析 ----------

test('parseOnshapeUrl：workspace 連結', () => {
  const r = parseOnshapeUrl(
    'https://cad.onshape.com/documents/a1b2c3d4e5f6a7b8c9d0e1f2/w/0123456789abcdef01234567/e/fedcba9876543210fedcba98',
  );
  assert.deepEqual(r, {
    did: 'a1b2c3d4e5f6a7b8c9d0e1f2',
    wvm: 'w',
    wvmId: '0123456789abcdef01234567',
    eid: 'fedcba9876543210fedcba98',
  });
});

test('parseOnshapeUrl：version 連結（/v/）與無 element', () => {
  const r = parseOnshapeUrl(
    'https://cad.onshape.com/documents/a1b2c3d4e5f6a7b8c9d0e1f2/v/0123456789abcdef01234567',
  );
  assert.equal(r.wvm, 'v');
  assert.equal(r.eid, null);
});

test('parseOnshapeUrl：非 Onshape 連結回 null', () => {
  assert.equal(parseOnshapeUrl('https://drive.google.com/file/d/xyz'), null);
  assert.equal(parseOnshapeUrl('https://cad.onshape.com/documents/short/w/bad/e/ids'), null);
  assert.equal(parseOnshapeUrl(null), null);
});

// ---------- 單元：token 加密 ----------

test('cryptoBox：加密後可解回原文，且密文不含原文', () => {
  const secret = 'onshape-access-token-abc123';
  const boxed = encrypt(secret);
  assert.notEqual(boxed, secret);
  assert.ok(!boxed.includes(secret));
  assert.equal(decrypt(boxed), secret);
});

// ---------- 端點：未設定 ONSHAPE_CLIENT_ID 時的防護 ----------

test('GET /onshape/status：依環境設定回傳 enabled 狀態', async () => {
  const res = await api.get('/api/v1/onshape/status').set(auth());
  assert.equal(res.status, 200);
  assert.equal(res.body.data.enabled, env.onshapeEnabled);
  assert.equal(typeof res.body.data.connected, 'boolean');
});

test('GET /onshape/auth-url：未設定時回 503，已設定時回授權網址', async () => {
  const res = await api.get('/api/v1/onshape/auth-url').set(auth());
  if (env.onshapeEnabled) {
    assert.equal(res.status, 200);
    assert.match(res.body.data.url, /^https?:\/\//);
    assert.match(res.body.data.url, /oauth\/authorize/);
  } else {
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'ONSHAPE_DISABLED');
  }
});

test('POST /onshape/resolve：非 Onshape 連結回 400 NOT_ONSHAPE_URL', async () => {
  const res = await api
    .post('/api/v1/onshape/resolve')
    .set(auth())
    .send({ url: 'https://drive.google.com/file/d/xyz' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'NOT_ONSHAPE_URL');
});

test('POST /onshape/import/preview：非 Onshape 連結回 400 NOT_ONSHAPE_URL', async () => {
  const res = await api
    .post('/api/v1/onshape/import/preview')
    .set(auth())
    .send({ url: 'https://drive.google.com/file/d/xyz' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'NOT_ONSHAPE_URL');
});

test('POST /onshape/import：非 Onshape 連結回 400 NOT_ONSHAPE_URL', async () => {
  const res = await api.post('/api/v1/onshape/import').set(auth()).send({
    url: 'https://drive.google.com/file/d/xyz',
    systemId: 1,
    manufacturingMethodId: 1,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'NOT_ONSHAPE_URL');
});

test('GET /onshape/parts：參數格式錯誤回 400 驗證失敗', async () => {
  const res = await api
    .get('/api/v1/onshape/parts?did=xxx&wvm=w&wvmId=yyy&eid=zzz')
    .set(auth());
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('未登入打 /onshape/status 回 401', async () => {
  const res = await api.get('/api/v1/onshape/status');
  assert.equal(res.status, 401);
});

// ---------- 任務整合：drawingUrl 自動解析 Onshape 參照 ----------

test('建任務帶 Onshape 連結：自動存入 onshape 參照欄位', async () => {
  const res = await api
    .post('/api/v1/tasks')
    .set(auth())
    .send({
      systemId: 1,
      manufacturingMethodId: 1,
      quantity: 1,
      drawingUrl:
        'https://cad.onshape.com/documents/a1b2c3d4e5f6a7b8c9d0e1f2/w/0123456789abcdef01234567/e/fedcba9876543210fedcba98',
    });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.onshapeDid, 'a1b2c3d4e5f6a7b8c9d0e1f2');
  assert.equal(res.body.data.onshapeWvm, 'w');
  assert.equal(res.body.data.onshapeEid, 'fedcba9876543210fedcba98');
  assert.equal(
    res.body.data.onshapePartStudioUrl,
    'https://cad.onshape.com/documents/a1b2c3d4e5f6a7b8c9d0e1f2/w/0123456789abcdef01234567/e/fedcba9876543210fedcba98',
  );
});

test('建任務帶非 Onshape 連結：onshape 欄位為 null', async () => {
  const res = await api
    .post('/api/v1/tasks')
    .set(auth())
    .send({
      systemId: 1,
      manufacturingMethodId: 1,
      quantity: 1,
      drawingUrl: 'https://drive.google.com/file/d/xyz',
    });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.onshapeDid, null);
});

test('task download rejects unsupported formats before calling Onshape', async () => {
  const created = await api
    .post('/api/v1/tasks')
    .set(auth())
    .send({ systemId: 1, manufacturingMethodId: 1, quantity: 1 });
  assert.equal(created.status, 201);

  const res = await api.get(`/api/v1/tasks/${created.body.data.id}/download`).set(auth());
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'TASK_DOWNLOAD_UNAVAILABLE');
});

test('CORS exposes the download filename header to the frontend', async () => {
  const configured = env.corsOrigins[0];
  const origin = configured?.includes('://*.')
    ? configured.replace('://*.', '://test.')
    : configured?.startsWith('*.')
      ? `https://test.${configured.slice(2)}`
      : configured ?? 'http://localhost:5173';
  const res = await api
    .options('/api/v1/tasks/1/download')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'GET');
  assert.match(res.headers['access-control-expose-headers'] ?? '', /Content-Disposition/i);
});
