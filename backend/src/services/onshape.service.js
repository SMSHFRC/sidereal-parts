// M3：Onshape 整合 — 每人 OAuth 綁定 + API 代理
// token 加密落地；access token 過期自動用 refresh token 換新（單次重試）。
import crypto from 'node:crypto';
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

const VENDOR_PART_NUMBER = /^(?:WCP|TTB|REV|SDS|CTR|CTRE|VEX|VEN)[-_]?[A-Z0-9]+|^(?:AM|am)-[A-Z0-9]+|^217-\d+/i;
const VENDOR_TEXT = /\b(?:AndyMark|VEXpro|VEX Robotics|West Coast Products|WCP|REV Robotics|The Thrifty Bot|TTB|CTRE|Cross The Road|Swerve Drive Specialties|SDS|McMaster|McMaster-Carr)\b/i;
const TEAM_PART_NUMBER = /^[A-Z]{2,6}-\d{3,5}$/;
const EMPTY_PROCESS_VALUES = new Set(['', '-', '--', 'n/a', 'na', 'none', 'null']);

const normalizedText = (value) => String(value ?? '').trim();
const hasValue = (value) => {
  const text = normalizedText(value);
  return Boolean(text && !EMPTY_PROCESS_VALUES.has(text.toLowerCase()));
};

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

export const classifyBomRow = (row, rootDid) => {
  const src = row.itemSource ?? {};
  const docId = sourceDocumentId(src);
  const partId = sourcePartId(src);
  const partNo = normalizedText(row.partNumber);
  const description = normalizedText(row.description);
  const externalDoc = docId && docId !== rootDid;
  const vendorPartNumber = partNo && VENDOR_PART_NUMBER.test(partNo);
  const vendorDescription = description && VENDOR_TEXT.test(description);
  const teamPartNumber = partNo && TEAM_PART_NUMBER.test(partNo) && !vendorPartNumber;
  const hasManufacturingProcess = [
    row.preProcess,
    row.process1,
    row.process2,
    row.process,
    row.manufacturingMethod,
  ].some(hasValue);
  const hasMaterial = hasValue(row.material);
  const missingPart = !partId;
  const externalCots = externalDoc && !hasManufacturingProcess && !hasMaterial && !teamPartNumber;
  const cots = Boolean(vendorPartNumber || vendorDescription || externalCots);
  const made = Boolean(!cots && (hasManufacturingProcess || teamPartNumber || hasMaterial || partId));
  const classification = cots ? 'cots' : made ? 'made' : 'unknown';
  const classificationReason = vendorPartNumber
    ? 'vendor_part_number'
    : vendorDescription
      ? 'vendor_description'
      : externalCots
        ? 'external_document'
        : hasManufacturingProcess
          ? 'manufacturing_process'
          : teamPartNumber
            ? 'team_part_number'
            : hasMaterial
              ? 'material_present'
              : partId
                ? 'onshape_part'
                : missingPart
                  ? 'missing_part_id'
                  : null;
  return {
    ...row,
    sourceDocumentId: docId ?? null,
    sourceElementId: sourceElementId(src) ?? null,
    sourcePartId: partId ?? null,
    sourceConfig: sourceConfig(src) ?? null,
    classification,
    classificationReason,
    cotsReason: classification === 'cots' ? classificationReason : null,
  };
};

const thumbnailPathFor = ({ did, wvm, wvmId, eid }) =>
  `/onshape/thumbnail?did=${did}&wvm=${wvm}&wvmId=${wvmId}&eid=${eid}`;

// 每列的穩定識別碼（前端逐件覆寫用）。與陣列順序無關：
// 有 partId 用 partId+config+element；否則用內容雜湊。preview 與 import 兩次呼叫會得到相同 key。
const rowKeyFor = (row) => {
  if (row.sourcePartId) {
    return `p:${row.sourcePartId}:${row.sourceConfig ?? ''}:${row.sourceElementId ?? ''}`;
  }
  const basis = `${row.name ?? ''}|${row.partNumber ?? ''}|${row.description ?? ''}`;
  return `h:${crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12)}`;
};

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

  const hDescription = findHeaderId('description', '??', '說明');
  const hPreProcess = findHeaderId('pre process', 'pre-process', 'preprocess', '前處理');
  const hProcess1 = findHeaderId('process 1', 'process1', '加工 1', '製程 1');
  const hProcess2 = findHeaderId('process 2', 'process2', '加工 2', '製程 2');
  const hProcess = findHeaderId('process', 'manufacturing process', '加工', '製程', '加工方式');

  return (bom.rows ?? []).map((r) => {
    const v = r.headerIdToValue ?? {};
    const material = v[hMaterial];
    return {
      name: v[hName] ?? null,
      quantity: Number(v[hQty] ?? 0) || 0,
      material: (material && typeof material === 'object' ? material.displayName : material) ?? null,
      partNumber: v[hPartNo] ?? null,
      description: v[hDescription] ?? null,
      preProcess: v[hPreProcess] ?? null,
      process1: v[hProcess1] ?? null,
      process2: v[hProcess2] ?? null,
      process: v[hProcess] ?? null,
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
  const classified = rows.map((row) => {
    const c = classifyBomRow(row, ref.did);
    return { ...c, rowKey: rowKeyFor(c) };
  });
  const made = classified.filter((row) => row.classification === 'made');
  const cots = classified.filter((row) => row.classification === 'cots');
  const unknown = classified.filter((row) => row.classification === 'unknown');
  const thumbnailPath = thumbnailPathFor(ref);

  return {
    ref,
    documentName: doc.name,
    ownerName: doc.owner?.name ?? null,
    thumbnailPath,
    made,
    cots,
    unknown,
    summary: {
      total: classified.length,
      madeCount: made.length,
      cotsCount: cots.length,
      unknownCount: unknown.length,
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

  async importBom(userId, { url, systemId, manufacturingMethodId, materialId, postProcessId, items }) {
    const preview = await makeImportPreview(userId, url);
    const system = await prisma.system.findUnique({ where: { id: systemId } });
    if (!system) throw ApiError.badRequest('系統不存在');

    // 逐件覆寫表（key = rowKey）；全域欄位作為未指定時的預設值
    const overrides = new Map((items ?? []).map((it) => [it.rowKey, it]));
    const allRows = [...preview.made, ...preview.cots, ...preview.unknown];

    // 先決定每列最終分類與設定並驗證
    const madePlan = [];
    const cotsPlan = [];
    const missingMethod = [];
    for (const row of allRows) {
      const ov = overrides.get(row.rowKey);
      if (ov?.classification === 'skip') continue;
      const cls = ov?.classification ?? row.classification;
      if (cls === 'unknown') continue; // 未分類且未指定 → 略過（需人工判斷）
      if (cls === 'cots') {
        cotsPlan.push(row);
        continue;
      }
      // made：加工方式逐件可帶，未帶則用全域預設
      const methodId = ov?.manufacturingMethodId ?? manufacturingMethodId ?? null;
      if (!methodId) {
        missingMethod.push(row.name ?? row.partNumber ?? '未命名零件');
        continue;
      }
      madePlan.push({
        row,
        methodId,
        materialOverride: ov?.materialId ?? materialId ?? null,
        itemPostProcessId: ov?.postProcessId ?? postProcessId ?? null,
        quantity: Math.max(1, Number(ov?.quantity ?? row.quantity) || 1),
      });
    }

    if (missingMethod.length) {
      const preview5 = missingMethod.slice(0, 5).join('、');
      throw ApiError.badRequest(
        `有 ${missingMethod.length} 個自製件未選加工方式：${preview5}${missingMethod.length > 5 ? '…' : ''}`,
        'MISSING_METHOD',
      );
    }

    // 驗證用到的 id 存在（一次查詢）
    const methodIds = [...new Set(madePlan.map((p) => p.methodId))];
    const postIds = [...new Set(madePlan.map((p) => p.itemPostProcessId).filter(Boolean))];
    const matIds = [...new Set(madePlan.map((p) => p.materialOverride).filter(Boolean))];
    const [methodRows, postRows, matRows] = await Promise.all([
      prisma.manufacturingMethod.findMany({ where: { id: { in: methodIds } }, select: { id: true } }),
      postIds.length ? prisma.postProcess.findMany({ where: { id: { in: postIds } }, select: { id: true } }) : [],
      matIds.length ? prisma.material.findMany({ where: { id: { in: matIds } }, select: { id: true } }) : [],
    ]);
    const has = (rows, id) => rows.some((r) => r.id === id);
    for (const id of methodIds) if (!has(methodRows, id)) throw ApiError.badRequest('加工方式不存在');
    for (const id of postIds) if (!has(postRows, id)) throw ApiError.badRequest('後處理方式不存在');
    for (const id of matIds) if (!has(matRows, id)) throw ApiError.badRequest('材料不存在');

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

      for (const plan of madePlan) {
        const item = plan.row;
        const quantity = plan.quantity;
        const resolvedMaterialId = await resolveMaterialId(tx, plan.materialOverride, item.material);
        const rewardPoints = (5 + (plan.itemPostProcessId ? 2 : 0)) * quantity;
        const identity = {
          onshapeDid: preview.ref.did,
          onshapeEid: item.sourceElementId ?? preview.ref.eid,
          onshapePartId: item.sourcePartId,
          onshapeConfig: item.sourceConfig,
        };
        const existing = await tx.task.findFirst({ where: identity });
        const taskData = {
          manufacturingMethodId: plan.methodId,
          systemId,
          materialId: resolvedMaterialId,
          postProcessId: plan.itemPostProcessId ?? null,
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

      if (cotsPlan.length) {
        await tx.cotsItem.createMany({
          data: cotsPlan.map((item) => ({
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
      cotsCount: cotsPlan.length,
      imageCount: preview.summary.imageCount,
      imageFailedCount: preview.summary.imageFailedCount,
      tasks: [...result.created, ...result.updated],
      cots: cotsPlan,
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

  // 單一零件縮圖：用 Part Studio 的 shaded view 算出該 part 的等角圖
  async partThumbnail(userId, { did, wvm, wvmId, eid, partId }) {
    const q = new URLSearchParams({
      outputHeight: '170',
      outputWidth: '300',
      pixelSize: '0',
      // 等角視角矩陣（isometric）
      viewMatrix: '0.707,0.707,0,0,-0.408,0.408,0.816,0,0.577,-0.577,0.577,0',
    });
    const data = await apiFetch(
      userId,
      `/parts/d/${did}/${wvm}/${wvmId}/e/${eid}/partid/${encodeURIComponent(partId)}/shadedviews?${q}`,
    );
    const b64 = Array.isArray(data.images) ? data.images[0] : null;
    if (!b64) throw ApiError.notFound('無法產生零件縮圖');
    return { buf: Buffer.from(b64, 'base64'), contentType: 'image/png' };
  },
};
