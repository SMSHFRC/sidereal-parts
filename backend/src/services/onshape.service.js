// M3：Onshape 整合 — 每人 OAuth 綁定 + API 代理
// token 加密落地；access token 過期自動用 refresh token 換新（單次重試）。
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { encrypt, decrypt } from '../utils/cryptoBox.js';
import { parseOnshapeUrl } from '../utils/onshapeUrl.js';
import { nextPartNumber } from '../utils/partNumber.js';
import { TASK_STATUS } from '../constants/taskStatus.js';

const assertEnabled = () => {
  if (!env.onshapeEnabled) {
    throw new ApiError(503, '尚未設定 Onshape 整合（缺 ONSHAPE_CLIENT_ID/SECRET）', 'ONSHAPE_DISABLED');
  }
};

// ---------- OAuth ----------

// state 用短效 JWT：callback 是瀏覽器 redirect（無 Authorization header），
// 靠簽名的 state 識別使用者並防 CSRF。
const signState = (userId) =>
  jwt.sign({ sub: userId.toString(), purpose: 'onshape_oauth' }, env.JWT_ACCESS_SECRET, {
    expiresIn: '30m',
  });

const verifyState = (state) => {
  try {
    const p = jwt.verify(state, env.JWT_ACCESS_SECRET);
    if (p.purpose !== 'onshape_oauth') throw new Error('bad purpose');
    return BigInt(p.sub);
  } catch {
    throw ApiError.badRequest('OAuth state 無效或已過期', 'BAD_STATE');
  }
};

async function tokenRequest(params) {
  const res = await fetch(`${env.ONSHAPE_OAUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.ONSHAPE_CLIENT_ID,
      client_secret: env.ONSHAPE_CLIENT_SECRET,
      ...params,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[onshape token] %s %s', res.status, body.slice(0, 300));
    throw new ApiError(502, 'Onshape 授權失敗，請重新連結', 'ONSHAPE_TOKEN_ERROR');
  }
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function saveTokens(userId, tok) {
  const data = {
    accessToken: encrypt(tok.access_token),
    refreshToken: encrypt(tok.refresh_token),
    // 提前 60 秒視為過期，避免邊界失效
    expiresAt: new Date(Date.now() + (tok.expires_in - 60) * 1000),
  };
  await prisma.onshapeAccount.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

// 取得有效 access token（過期自動 refresh）
async function getValidToken(userId) {
  const acc = await prisma.onshapeAccount.findUnique({ where: { userId } });
  if (!acc) throw new ApiError(428, '尚未連結 Onshape 帳號', 'ONSHAPE_NOT_CONNECTED');

  if (acc.expiresAt > new Date()) return decrypt(acc.accessToken);

  const tok = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: decrypt(acc.refreshToken),
  });
  await saveTokens(userId, tok);
  return tok.access_token;
}

// ---------- API 代理 ----------

async function apiFetch(userId, path, { raw = false } = {}) {
  assertEnabled();
  const token = await getValidToken(userId);
  const res = await fetch(`${env.ONSHAPE_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? '*/*' : 'application/json;charset=UTF-8; qs=0.09',
    },
  });
  if (res.status === 401) {
    // token 被撤銷等情況：要求使用者重新連結
    throw new ApiError(428, 'Onshape 授權已失效，請重新連結', 'ONSHAPE_NOT_CONNECTED');
  }
  if (res.status === 403) throw ApiError.forbidden('你的 Onshape 帳號無權存取此文件');
  if (res.status === 404) throw ApiError.notFound('Onshape 找不到此文件或元素');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[onshape api] %s %s %s', res.status, path, body.slice(0, 300));
    throw new ApiError(502, 'Onshape API 呼叫失敗', 'ONSHAPE_API_ERROR');
  }
  return raw ? res : res.json();
}

const COTS_PART_PREFIX = /^(WCP|217|AM|REV|TTB|VEX|ANDYMARK|CTR|CTRE|REV-)/i;

const valueAt = (obj, keys) => {
  for (const key of keys) {
    if (obj && obj[key] != null) return obj[key];
  }
  return null;
};

const sourceValue = (source, keys) => valueAt(source, keys) ?? valueAt(source?.part, keys);

const sourceDocumentId = (source) =>
  sourceValue(source, ['documentId', 'documentID', 'documentid', 'did', 'sourceDocumentId']);

const sourceElementId = (source) =>
  sourceValue(source, ['elementId', 'elementID', 'elementid', 'eid', 'sourceElementId']);

const sourcePartId = (source) =>
  sourceValue(source, ['partId', 'partID', 'partid', 'pid', 'sourcePartId']);

const sourceConfig = (source) =>
  sourceValue(source, ['configuration', 'configurationId', 'config', 'sourceConfiguration']);

const classifyBomRow = (row, rootDid) => {
  const src = row.itemSource ?? {};
  const docId = sourceDocumentId(src);
  const partId = sourcePartId(src);
  const partNo = (row.partNumber ?? '').trim();
  const externalDoc = docId && docId !== rootDid;
  const vendorPrefix = partNo && COTS_PART_PREFIX.test(partNo);
  const missingPart = !partId;
  const cots = Boolean(externalDoc || vendorPrefix || missingPart);
  return {
    ...row,
    sourceDocumentId: docId ?? null,
    sourceElementId: sourceElementId(src) ?? null,
    sourcePartId: partId ?? null,
    sourceConfig: sourceConfig(src) ?? null,
    classification: cots ? 'cots' : 'made',
    cotsReason: externalDoc
      ? 'external_document'
      : vendorPrefix
        ? 'vendor_part_number'
        : missingPart
          ? 'missing_part_id'
          : null,
  };
};

const thumbnailPathFor = ({ did, wvm, wvmId, eid }) =>
  `/onshape/thumbnail?did=${did}&wvm=${wvm}&wvmId=${wvmId}&eid=${eid}`;

async function resolveMaterialId(db, selectedMaterialId, materialName) {
  if (selectedMaterialId) return selectedMaterialId;
  if (!materialName) return null;
  const material = await db.material.findFirst({
    where: {
      OR: [
        { code: { equals: materialName, mode: 'insensitive' } },
        { name: { equals: materialName, mode: 'insensitive' } },
        { name: { contains: materialName, mode: 'insensitive' } },
      ],
    },
  });
  return material?.id ?? null;
}

async function fetchAssemblyBomRows(userId, { did, wvm, wvmId, eid }) {
  const bom = await apiFetch(
    userId,
    `/assemblies/d/${did}/${wvm}/${wvmId}/e/${eid}/bom?indented=false&multiLevel=false`,
  );
  const headers = bom.headers ?? [];
  const findHeaderId = (...names) =>
    headers.find((h) => names.includes((h.name ?? '').toLowerCase()))?.id ?? null;
  const hName = findHeaderId('name', '名稱');
  const hQty = findHeaderId('quantity', '數量');
  const hMaterial = findHeaderId('material', '材料');
  const hPartNo = findHeaderId('part number', '零件編號');

  return (bom.rows ?? []).map((r) => {
    const v = r.headerIdToValue ?? {};
    const material = v[hMaterial];
    return {
      name: v[hName] ?? null,
      quantity: Number(v[hQty] ?? 0) || 0,
      material: (material && typeof material === 'object' ? material.displayName : material) ?? null,
      partNumber: v[hPartNo] ?? null,
      itemSource: r.itemSource ?? null,
    };
  });
}

async function makeImportPreview(userId, url) {
  const ref = parseOnshapeUrl(url);
  if (!ref) throw ApiError.badRequest('不是有效的 Onshape 文件連結', 'NOT_ONSHAPE_URL');
  if (!ref.eid) {
    throw ApiError.badRequest('Onshape 匯入需要包含 element id 的 Assembly 連結', 'ONSHAPE_ELEMENT_REQUIRED');
  }

  const [doc, rows] = await Promise.all([
    apiFetch(userId, `/documents/${ref.did}`),
    fetchAssemblyBomRows(userId, ref),
  ]);
  const classified = rows.map((row) => classifyBomRow(row, ref.did));
  const made = classified.filter((row) => row.classification === 'made');
  const cots = classified.filter((row) => row.classification === 'cots');
  const thumbnailPath = thumbnailPathFor(ref);

  return {
    ref,
    documentName: doc.name,
    ownerName: doc.owner?.name ?? null,
    thumbnailPath,
    made,
    cots,
    summary: {
      total: classified.length,
      madeCount: made.length,
      cotsCount: cots.length,
      imageCount: thumbnailPath ? classified.length : 0,
      imageFailedCount: thumbnailPath ? 0 : classified.length,
    },
  };
}

// ---------- 對外服務 ----------

export const onshapeService = {
  // 前端跳轉用的授權網址
  authUrl(userId) {
    assertEnabled();
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env.ONSHAPE_CLIENT_ID,
      redirect_uri: env.onshapeRedirectUri,
      scope: 'OAuth2Read',
      state: signState(userId),
    });
    return `${env.ONSHAPE_OAUTH_BASE}/oauth/authorize?${q}`;
  },

  // OAuth callback：驗 state → 換 token → 存（加密）
  async handleCallback({ code, state }) {
    assertEnabled();
    if (!code) throw ApiError.badRequest('缺少授權碼');
    const userId = verifyState(state);
    const tok = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.onshapeRedirectUri,
    });
    await saveTokens(userId, tok);
    return userId;
  },

  async status(userId) {
    if (!env.onshapeEnabled) return { enabled: false, connected: false };
    const acc = await prisma.onshapeAccount.findUnique({ where: { userId } });
    return { enabled: true, connected: Boolean(acc), connectedAt: acc?.createdAt ?? null };
  },

  async disconnect(userId) {
    await prisma.onshapeAccount.deleteMany({ where: { userId } });
    return { disconnected: true };
  },

  // 解析連結 + 驗證可存取，回傳 ref 與文件名稱
  async resolve(userId, url) {
    const ref = parseOnshapeUrl(url);
    if (!ref) throw ApiError.badRequest('不是有效的 Onshape 文件連結', 'NOT_ONSHAPE_URL');
    const doc = await apiFetch(userId, `/documents/${ref.did}`);
    return {
      ref,
      documentName: doc.name,
      ownerName: doc.owner?.name ?? null,
      // 前端顯示縮圖走我們的 proxy（Onshape 縮圖需帶授權）
      thumbnailPath: ref.eid
        ? `/onshape/thumbnail?did=${ref.did}&wvm=${ref.wvm}&wvmId=${ref.wvmId}&eid=${ref.eid}`
        : null,
    };
  },

  // Part Studio 內的零件清單（名稱/材料，給自動帶入用）
  async elementParts(userId, { did, wvm, wvmId, eid }) {
    const parts = await apiFetch(userId, `/parts/d/${did}/${wvm}/${wvmId}/e/${eid}`);
    return (Array.isArray(parts) ? parts : []).map((p) => ({
      partId: p.partId,
      name: p.name,
      material: p.material?.displayName ?? p.material?.id ?? null,
      appearance: p.appearance?.color ?? null,
    }));
  },

  // Assembly 的 BOM（給整批匯入用）；best-effort 解析標準欄位
  async assemblyBom(userId, { did, wvm, wvmId, eid }) {
    return fetchAssemblyBomRows(userId, { did, wvm, wvmId, eid });
  },

  async importPreview(userId, { url }) {
    return makeImportPreview(userId, url);
  },

  async importBom(userId, { url, systemId, manufacturingMethodId, materialId, postProcessId }) {
    const preview = await makeImportPreview(userId, url);
    const [system, method, postProcess, selectedMaterial] = await Promise.all([
      prisma.system.findUnique({ where: { id: systemId } }),
      prisma.manufacturingMethod.findUnique({ where: { id: manufacturingMethodId } }),
      postProcessId ? prisma.postProcess.findUnique({ where: { id: postProcessId } }) : null,
      materialId ? prisma.material.findUnique({ where: { id: materialId } }) : null,
    ]);
    if (!system) throw ApiError.badRequest('系統不存在');
    if (!method) throw ApiError.badRequest('加工方式不存在');
    if (postProcessId && !postProcess) throw ApiError.badRequest('後處理方式不存在');
    if (materialId && !selectedMaterial) throw ApiError.badRequest('材料不存在');

    const thumbnailUrl = preview.thumbnailPath;
    const imageMeta = thumbnailUrl
      ? {
          source: 'onshape-thumbnail-proxy',
          width: 300,
          height: 170,
          fetchedAt: new Date().toISOString(),
        }
      : null;
    const revision = preview.ref.wvm === 'v' ? preview.ref.wvmId : null;

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.onshapeImportBatch.create({
        data: {
          userId,
          sourceUrl: url,
          documentId: preview.ref.did,
          wvm: preview.ref.wvm,
          wvmId: preview.ref.wvmId,
          elementId: preview.ref.eid,
          summary: preview.summary,
        },
      });

      const created = [];
      const updated = [];

      for (const item of preview.made) {
        const quantity = Math.max(1, Number(item.quantity) || 1);
        const resolvedMaterialId = await resolveMaterialId(tx, materialId, item.material);
        const rewardPoints = (5 + (postProcessId ? 2 : 0)) * quantity;
        const identity = {
          onshapeDid: preview.ref.did,
          onshapeEid: item.sourceElementId ?? preview.ref.eid,
          onshapePartId: item.sourcePartId,
          onshapeConfig: item.sourceConfig,
        };
        const existing = await tx.task.findFirst({ where: identity });
        const taskData = {
          manufacturingMethodId,
          systemId,
          materialId: resolvedMaterialId,
          postProcessId: postProcessId ?? null,
          quantity,
          rewardPoints,
          drawingUrl: url,
          onshapeDid: preview.ref.did,
          onshapeWvm: preview.ref.wvm,
          onshapeWvmId: preview.ref.wvmId,
          onshapeEid: identity.onshapeEid,
          onshapePartId: identity.onshapePartId,
          onshapeConfig: identity.onshapeConfig,
          onshapeRevision: revision,
          onshapeThumbnailUrl: thumbnailUrl,
          onshapeImageMeta: imageMeta,
          importBatchId: batch.id,
          note:
            [
              item.name ? `Onshape: ${item.name}` : null,
              item.partNumber ? `Part number: ${item.partNumber}` : null,
              item.material ? `Material: ${item.material}` : null,
            ]
              .filter(Boolean)
              .join('\n') || null,
        };

        if (existing) {
          const task = await tx.task.update({
            where: { id: existing.id },
            data: {
              quantity: taskData.quantity,
              rewardPoints: taskData.rewardPoints,
              materialId: taskData.materialId,
              postProcessId: taskData.postProcessId,
              drawingUrl: taskData.drawingUrl,
              onshapeWvm: taskData.onshapeWvm,
              onshapeWvmId: taskData.onshapeWvmId,
              onshapeRevision: taskData.onshapeRevision,
              onshapeThumbnailUrl: taskData.onshapeThumbnailUrl,
              onshapeImageMeta: taskData.onshapeImageMeta,
              importBatchId: taskData.importBatchId,
              note: taskData.note,
            },
            select: { id: true, partNumber: true, status: true },
          });
          updated.push(task);
        } else {
          const { partNumber, seq } = await nextPartNumber(tx, system.code);
          const task = await tx.task.create({
            data: {
              ...taskData,
              partNumber,
              partNumberPrefix: system.code,
              partNumberSeq: seq,
              creatorId: userId,
              status: TASK_STATUS.PENDING,
            },
            select: { id: true, partNumber: true, status: true },
          });
          await tx.taskStatusHistory.create({
            data: {
              taskId: task.id,
              fromStatus: null,
              toStatus: TASK_STATUS.PENDING,
              changedBy: userId,
              note: 'Onshape BOM 匯入',
            },
          });
          created.push(task);
        }
      }

      if (preview.cots.length) {
        await tx.cotsItem.createMany({
          data: preview.cots.map((item) => ({
            batchId: batch.id,
            name: item.name,
            partNumber: item.partNumber,
            quantity: Math.max(0, Number(item.quantity) || 0),
            material: item.material,
            sourceDocumentId: item.sourceDocumentId,
            sourceElementId: item.sourceElementId,
            thumbnailUrl,
            raw: item,
          })),
        });
      }

      return { batch, created, updated };
    });

    return {
      batchId: result.batch.id,
      created: result.created.length,
      updated: result.updated.length,
      cotsCount: preview.cots.length,
      imageCount: preview.summary.imageCount,
      imageFailedCount: preview.summary.imageFailedCount,
      tasks: [...result.created, ...result.updated],
      cots: preview.cots,
      documentName: preview.documentName,
    };
  },

  // 縮圖代理：Onshape 縮圖端點需帶授權，前端 <img> 無法直接取
  async thumbnail(userId, { did, wvm, wvmId, eid }) {
    const res = await apiFetch(
      userId,
      `/thumbnails/d/${did}/${wvm}/${wvmId}/e/${eid}/s/300x170`,
      { raw: true },
    );
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, contentType: res.headers.get('content-type') ?? 'image/png' };
  },
};
