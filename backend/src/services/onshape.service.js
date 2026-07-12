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
import { assertDownloadPermission, downloadSpecForTask } from '../utils/taskDownload.js';
import { assertValidStep, stepToDxf } from '../utils/stepToDxf.js';

const assertEnabled = () => {
  if (!env.onshapeEnabled) {
    throw new ApiError(503, '尚未設定 Onshape 整合（缺 ONSHAPE_CLIENT_ID/SECRET）', 'ONSHAPE_DISABLED');
  }
};

// ---------- OAuth ----------

// state 用短效 JWT：callback 是瀏覽器 redirect（無 Authorization header），
// 靠簽名的 state 識別使用者並防 CSRF。
const normalizeReturnTo = (value) => {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return '/';
  }
  return value;
};

const signState = (userId, returnTo) =>
  jwt.sign({ sub: userId.toString(), purpose: 'onshape_oauth', returnTo: normalizeReturnTo(returnTo) }, env.JWT_ACCESS_SECRET, {
    expiresIn: '30m',
  });

const verifyState = (state) => {
  try {
    const p = jwt.verify(state, env.JWT_ACCESS_SECRET);
    if (p.purpose !== 'onshape_oauth') throw new Error('bad purpose');
    return { userId: BigInt(p.sub), returnTo: normalizeReturnTo(p.returnTo) };
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

const summarizeOnshapeBody = (body) => {
  if (!body) return null;
  try {
    const data = JSON.parse(body);
    const candidates = [
      data.message,
      data.error,
      data.error_description,
      data.moreInfo,
      data.cause,
      data.details,
      data.name,
    ];
    const message = candidates.find((value) => typeof value === 'string' && value.trim());
    if (message) return message.trim();
  } catch {
    // Non-JSON responses are common for proxy and gateway errors.
  }
  const plain = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain || null;
};

async function apiFetch(userId, path, { raw = false, label = 'Onshape API' } = {}) {
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
    const summary = summarizeOnshapeBody(body);
    console.error('[onshape api] %s %s %s', res.status, path, body.slice(0, 500));
    throw new ApiError(
      502,
      `${label}失敗（${res.status}）${summary ? `：${summary.slice(0, 180)}` : ''}`,
      'ONSHAPE_API_ERROR',
      {
        onshapeStatus: res.status,
        path,
        response: body.slice(0, 500),
      },
    );
  }
  return raw ? res : res.json();
}

const isOnshapeHost = (hostname) => hostname === 'onshape.com' || hostname.endsWith('.onshape.com');

async function apiDownloadFetch(userId, path, { method = 'GET', body, label = 'Onshape export' } = {}) {
  assertEnabled();
  const token = await getValidToken(userId);
  let url = `${env.ONSHAPE_API_BASE}${path}`;

  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    const res = await fetch(url, {
      method,
      body: body == null ? undefined : JSON.stringify(body),
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json;charset=UTF-8; qs=0.09, application/octet-stream;q=0.9, */*;q=0.8',
        ...(body == null ? {} : { 'Content-Type': 'application/json;charset=UTF-8; qs=0.09' }),
      },
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new ApiError(502, `${label} 重新導向失敗`, 'ONSHAPE_EXPORT_REDIRECT');
      const next = new URL(location, url);
      if (!isOnshapeHost(next.hostname)) {
        throw new ApiError(502, `${label} 重新導向到不受信任的網域`, 'ONSHAPE_EXPORT_REDIRECT');
      }
      url = next.toString();
      continue;
    }

    if (res.status === 401) throw new ApiError(428, '請重新連結 Onshape 後再下載', 'ONSHAPE_NOT_CONNECTED');
    if (res.status === 403) throw ApiError.forbidden('你的 Onshape 帳號沒有此零件的存取權');
    if (res.status === 404) throw ApiError.notFound('Onshape 找不到此零件或匯出檔案');
    if (!res.ok) {
      const response = await res.text().catch(() => '');
      const summary = summarizeOnshapeBody(response);
      console.error('[onshape export] %s %s %s', res.status, url, response.slice(0, 500));
      throw new ApiError(
        502,
        `${label} 失敗（${res.status}）${summary ? `：${summary.slice(0, 180)}` : ''}`,
        'ONSHAPE_EXPORT_ERROR',
      );
    }
    return res;
  }

  throw new ApiError(502, `${label} 重新導向次數過多`, 'ONSHAPE_EXPORT_REDIRECT');
}

const originalPartName = (task) => {
  const sourceLine = task.note?.split('\n').find((line) => line.startsWith('Onshape: '));
  return sourceLine?.slice('Onshape: '.length).trim() || task.partNumber;
};

export const downloadFilename = (task, format) => {
  const base = originalPartName(task)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\.(?:stl|dxf|step|stp)$/i, '')
    .trim();
  return `${base || task.partNumber}.${format}`;
};

export const stepExportPayload = (task) => ({
  format: 'STEP',
  destinationName: originalPartName(task),
  triggerAutoDownload: true,
  storeInDocument: false,
  zipSingleFileOutput: false,
  units: 'millimeter',
  partIds: task.onshapePartId,
  ...(task.onshapeConfig ? { configuration: task.onshapeConfig } : {}),
});

async function exportStepDxf(userId, task) {
  const response = await apiDownloadFetch(
    userId,
    `/documents/d/${task.onshapeDid}/${task.onshapeWvm}/${task.onshapeWvmId}/e/${task.onshapeEid}/export`,
    {
      method: 'POST',
      label: 'Onshape STEP 匯出',
      body: stepExportPayload(task),
    },
  );
  const stepBuffer = Buffer.from(await response.arrayBuffer());
  assertValidStep(stepBuffer);
  try {
    return await stepToDxf(stepBuffer);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('[step to dxf] conversion failed', error);
    throw new ApiError(422, 'STEP 轉換 DXF 失敗，請確認零件具有可加工的平面', 'STEP_DXF_CONVERSION_FAILED');
  }
}

export function assertValidDxf(buf) {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    throw new ApiError(502, 'Onshape 回傳了 ZIP 而不是單一 DXF，請稍後重試', 'ONSHAPE_DXF_ZIP');
  }
  const prefix = buf.subarray(0, Math.min(buf.length, 2048)).toString('latin1');
  const isBinaryDxf = prefix.startsWith('AutoCAD Binary DXF');
  const isAsciiDxf = /(?:^|\r?\n)\s*SECTION\s*(?:\r?\n|$)/i.test(prefix);
  if (!isBinaryDxf && !isAsciiDxf) {
    throw new ApiError(502, 'Onshape 回傳的內容不是有效 DXF', 'ONSHAPE_DXF_INVALID');
  }
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

// 外部文件零件（多為 COTS）的版本參照，供算縮圖用（本文件零件則走 assembly 工作區）
const sourceVersionId = (source) =>
  sourceValue(source, ['versionId', 'documentVersionId', 'sourceVersionId']);

const sourceMicroversionId = (source) =>
  sourceValue(source, ['documentMicroversionId', 'microversionId', 'documentMicroversion', 'sourceMicroversionId']);

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
    sourceVersionId: sourceVersionId(src) ?? null,
    sourceMicroversionId: sourceMicroversionId(src) ?? null,
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
    { label: 'Onshape BOM 讀取' },
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

// 取得 workspace 目前的 microversion，用來把版本凍結成固定快照（下載不再漂移）
async function fetchCurrentMicroversion(userId, { did, wvm, wvmId }) {
  const data = await apiFetch(
    userId,
    `/documents/d/${did}/${wvm}/${wvmId}/currentmicroversion`,
    { label: 'Onshape 版本讀取' },
  );
  return data?.microversion ?? null;
}

// 把工作區參照（wvm='w'）凍結成 microversion 參照（wvm='m'）。非工作區或取不到時回原參照。
async function freezeRefToMicroversion(userId, ref) {
  if (ref.wvm !== 'w') return { wvm: ref.wvm, wvmId: ref.wvmId };
  try {
    const microversion = await fetchCurrentMicroversion(userId, ref);
    if (microversion) return { wvm: 'm', wvmId: microversion };
  } catch {
    // Onshape 未連結或讀取失敗：保留工作區參照（仍可下載，只是會跟著設計變動）
  }
  return { wvm: ref.wvm, wvmId: ref.wvmId };
}

async function makeImportPreview(userId, url) {
  const ref = parseOnshapeUrl(url);
  if (!ref) throw ApiError.badRequest('不是有效的 Onshape 文件連結', 'NOT_ONSHAPE_URL');
  if (!ref.eid) {
    throw ApiError.badRequest('Onshape 匯入需要包含 element id 的 Assembly 連結', 'ONSHAPE_ELEMENT_REQUIRED');
  }

  const [doc, rows] = await Promise.all([
    apiFetch(userId, `/documents/${ref.did}`, { label: 'Onshape 文件讀取' }),
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
  authUrl(userId, returnTo) {
    assertEnabled();
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env.ONSHAPE_CLIENT_ID,
      redirect_uri: env.onshapeRedirectUri,
      scope: 'OAuth2Read',
      state: signState(userId, returnTo),
    });
    return `${env.ONSHAPE_OAUTH_BASE}/oauth/authorize?${q}`;
  },

  // OAuth callback：驗 state → 換 token → 存（加密）
  async handleCallback({ code, state }) {
    assertEnabled();
    if (!code) throw ApiError.badRequest('缺少授權碼');
    const { userId, returnTo } = verifyState(state);
    const tok = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.onshapeRedirectUri,
    });
    await saveTokens(userId, tok);
    return { userId, returnTo };
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
    const doc = await apiFetch(userId, `/documents/${ref.did}`, { label: 'Onshape 文件讀取' });
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
    const parts = await apiFetch(userId, `/parts/d/${did}/${wvm}/${wvmId}/e/${eid}`, {
      label: 'Onshape 零件讀取',
    });
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

  async importBom(userId, { url, systemId, robotId, subsystemId, manufacturingMethodId, materialId, postProcessId, items, selection }, actor) {
    // 逐件指派僅 admin（與接單制一致）；先於任何外部呼叫檢查
    const wantsAssign = (items ?? []).some((it) => it.assigneeId != null);
    if (wantsAssign && actor?.role !== 'admin') {
      throw ApiError.forbidden('僅管理員可於匯入時指派零件');
    }
    const preview = await makeImportPreview(userId, url);
    let robotScope = {};
    let resolvedSystemId = systemId;
    if (subsystemId != null) {
      const subsystem = await prisma.robotSubsystem.findUnique({
        where: { id: subsystemId },
        select: { id: true, robotId: true, systemId: true, isActive: true },
      });
      if (!subsystem || !subsystem.isActive) throw ApiError.badRequest('子系統不存在或已停用');
      if (!subsystem.systemId) throw ApiError.badRequest('子系統尚未綁定系統');
      if (robotId != null && subsystem.robotId !== robotId) {
        throw ApiError.badRequest('子系統不屬於指定機器人');
      }
      robotScope = { robotId: subsystem.robotId, subsystemId: subsystem.id };
      resolvedSystemId = subsystem.systemId;
    } else if (robotId != null) {
      const robot = await prisma.robot.findUnique({
        where: { id: robotId },
        select: { id: true, isActive: true },
      });
      if (!robot || !robot.isActive) throw ApiError.badRequest('機器人不存在或已停用');
      robotScope = { robotId: robot.id };
    }
    const system = resolvedSystemId
      ? await prisma.system.findUnique({ where: { id: resolvedSystemId } })
      : null;
    if (!system) throw ApiError.badRequest('系統不存在');

    // 逐件覆寫表（key = rowKey）；全域欄位作為未指定時的預設值
    const overrides = new Map((items ?? []).map((it) => [it.rowKey, it]));
    const allRows = [...preview.made, ...preview.cots, ...preview.unknown];

    // 單獨匯入：只處理勾選的 rowKey，其餘零件完全不碰（不新增、不更新、不寫 COTS/跳過）
    const selective = Array.isArray(selection);
    const selectedKeys = selective ? new Set(selection) : null;

    // 先決定每列最終分類與設定並驗證
    const madePlan = [];
    const cotsPlan = [];
    const skippedPlan = []; // 明確跳過的零件也落地保存，供之後檢視
    const missingMethod = [];
    for (const row of allRows) {
      if (selective && !selectedKeys.has(row.rowKey)) continue; // 未勾選 → 略過
      const ov = overrides.get(row.rowKey);
      if (ov?.classification === 'skip') {
        if (!selective) skippedPlan.push(row); // 單獨匯入不落地跳過紀錄
        continue;
      }
      // 單獨匯入預設當作加工件（清單顯示的即是可加工零件）
      const cls = ov?.classification ?? (selective ? 'made' : row.classification);
      if (cls === 'unknown') continue; // 未分類且未指定 → 不處理（需人工判斷）
      if (cls === 'cots') {
        if (!selective) cotsPlan.push(row);
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
        itemAssigneeId: ov?.assigneeId ?? null,
        itemUrgent: ov?.isUrgent === true,
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
      prisma.manufacturingMethod.findMany({ where: { id: { in: methodIds } }, select: { id: true, basePoints: true } }),
      postIds.length ? prisma.postProcess.findMany({ where: { id: { in: postIds } }, select: { id: true } }) : [],
      matIds.length ? prisma.material.findMany({ where: { id: { in: matIds } }, select: { id: true } }) : [],
    ]);
    const has = (rows, id) => rows.some((r) => r.id === id);
    for (const id of methodIds) if (!has(methodRows, id)) throw ApiError.badRequest('加工方式不存在');
    const basePointsOf = (id) => methodRows.find((m) => m.id === id)?.basePoints ?? 5;
    for (const id of postIds) if (!has(postRows, id)) throw ApiError.badRequest('後處理方式不存在');
    for (const id of matIds) if (!has(matRows, id)) throw ApiError.badRequest('材料不存在');

    // 逐件指派對象需為啟用中的 member
    const assigneeIds = [...new Set(madePlan.map((p) => p.itemAssigneeId).filter((v) => v != null))];
    if (assigneeIds.length) {
      const users = await prisma.user.findMany({
        where: { id: { in: assigneeIds }, isActive: true, role: { name: 'member' } },
        select: { id: true },
      });
      for (const id of assigneeIds) {
        if (!users.some((u) => u.id === id)) throw ApiError.badRequest('指派的隊員不存在或已停用');
      }
    }

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

    // 版本快照：匯入當下把工作區參照凍結成 microversion，讓每一版下載到的加工檔固定不變。
    // drawingUrl 仍保留原工作區連結，供之後 Create Revision 取得最新設計。
    const frozen = await freezeRefToMicroversion(userId, preview.ref);

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.onshapeImportBatch.create({
        data: {
          userId,
          sourceUrl: url,
          documentName: preview.documentName ?? null,
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
        const rewardPoints = (basePointsOf(plan.methodId) + (plan.itemPostProcessId ? 2 : 0)) * quantity;
        const identity = {
          onshapeDid: preview.ref.did,
          onshapeEid: item.sourceElementId ?? preview.ref.eid,
          onshapePartId: item.sourcePartId,
          onshapeConfig: item.sourceConfig,
        };
        const existing = await tx.task.findFirst({ where: identity });
        const taskData = {
          manufacturingMethodId: plan.methodId,
          systemId: resolvedSystemId,
          ...robotScope,
          materialId: resolvedMaterialId,
          postProcessId: plan.itemPostProcessId ?? null,
          quantity,
          rewardPoints,
          drawingUrl: url,
          onshapeDid: preview.ref.did,
          onshapeWvm: frozen.wvm,
          onshapeWvmId: frozen.wvmId,
          onshapeEid: identity.onshapeEid,
          onshapePartId: identity.onshapePartId,
          onshapeConfig: identity.onshapeConfig,
          onshapeRevision: revision,
          onshapeThumbnailUrl: thumbnailUrl,
          onshapeImageMeta: imageMeta,
          importBatchId: batch.id,
          // 逐件指派（僅 admin 會帶到這裡；null = 進任務池）
          assigneeId: plan.itemAssigneeId ?? null,
          // 匯入時標記急件
          ...(plan.itemUrgent
            ? { isUrgent: true, urgentById: userId, urgentAt: new Date(), urgentReason: '匯入時標記' }
            : {}),
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
              robotId: taskData.robotId,
              subsystemId: taskData.subsystemId,
              // 既有任務僅在有明確指派時更新（避免把已接單的清掉）
              ...(plan.itemAssigneeId != null ? { assigneeId: plan.itemAssigneeId } : {}),
              // 匯入標急件：只在既有任務尚未開始加工時套用
              ...(plan.itemUrgent && ['pending', 'accepted'].includes(existing.status)
                ? { isUrgent: true, urgentById: userId, urgentAt: new Date(), urgentReason: '匯入時標記' }
                : {}),
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

      // COTS 與跳過的零件都保存（kind 區分），供之後在網站檢視
      const toItemRow = (item, kind) => ({
        batchId: batch.id,
        systemId: resolvedSystemId,
        ...robotScope,
        kind,
        name: item.name,
        partNumber: item.partNumber,
        quantity: Math.max(0, Number(item.quantity) || 0),
        material: item.material,
        sourceDocumentId: item.sourceDocumentId,
        sourceElementId: item.sourceElementId,
        thumbnailUrl,
        raw: item,
      });
      const itemRows = [
        ...cotsPlan.map((i) => toItemRow(i, 'cots')),
        ...skippedPlan.map((i) => toItemRow(i, 'skipped')),
      ];
      if (itemRows.length) {
        await tx.cotsItem.createMany({ data: itemRows });
      }

      return { batch, created, updated };
    });

    return {
      batchId: result.batch.id,
      created: result.created.length,
      updated: result.updated.length,
      cotsCount: cotsPlan.length,
      skippedCount: skippedPlan.length,
      imageCount: preview.summary.imageCount,
      imageFailedCount: preview.summary.imageFailedCount,
      tasks: [...result.created, ...result.updated],
      cots: cotsPlan,
      documentName: preview.documentName,
    };
  },

  // COTS / 跳過零件清單（登入即可查）
  // COTS / skipped imported rows. These are scoped to systems/subsystems so they
  // can be used as a real collection checklist instead of a throwaway import log.
  // 此組合（assembly）的加工進度：統計所有從這個 document+element 匯入的任務
  async assemblyProgress({ did, eid }) {
    const where = { importBatch: { documentId: did, elementId: eid } };
    const [grouped, tasks] = await Promise.all([
      prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.task.findMany({
        where,
        orderBy: [{ isUrgent: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          partNumber: true,
          note: true,
          status: true,
          isUrgent: true,
          quantity: true,
          assignee: { select: { username: true } },
        },
      }),
    ]);
    const b = { pending: 0, active: 0, done: 0 };
    for (const g of grouped) {
      if (g.status === 'pending') b.pending += g._count._all;
      else if (g.status === 'completed') b.done += g._count._all;
      else if (['accepted', 'processing', 'pending_review', 'post_processing'].includes(g.status))
        b.active += g._count._all;
    }
    const total = b.pending + b.active + b.done;
    return {
      progress: { ...b, total, percent: total ? Math.round((b.done / total) * 100) : 0 },
      tasks,
    };
  },

  async listImportItems({ kind, systemId, robotId, subsystemId, collected, page, limit }) {
    const where = {
      ...(kind && kind !== 'all' ? { kind } : {}),
      ...(systemId ? { systemId } : {}),
      ...(robotId ? { robotId } : {}),
      ...(subsystemId ? { subsystemId } : {}),
      ...(collected === 'open' ? { isCollected: false } : {}),
      ...(collected === 'done' ? { isCollected: true } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.cotsItem.findMany({
        where,
        include: {
          batch: { select: { documentName: true, sourceUrl: true, createdAt: true } },
          system: { select: { id: true, code: true, name: true } },
          robot: { select: { id: true, code: true, name: true } },
          subsystem: { select: { id: true, robotId: true, code: true, name: true } },
        },
        orderBy: [{ isCollected: 'asc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.cotsItem.count({ where }),
    ]);
    return { items, page, limit, total };
  },

  async updateImportItem(id, data) {
    const item = await prisma.cotsItem.findUnique({ where: { id } });
    if (!item) throw ApiError.notFound('找不到此 COTS 零件');

    const nextCollectedQuantity =
      data.collectedQuantity != null
        ? data.collectedQuantity
        : data.isCollected === true
          ? item.quantity
          : item.collectedQuantity;
    const boundedCollectedQuantity = Math.min(Math.max(0, nextCollectedQuantity), Math.max(0, item.quantity));
    const nextIsCollected =
      data.isCollected != null
        ? data.isCollected
        : item.quantity > 0 && boundedCollectedQuantity >= item.quantity;

    return prisma.cotsItem.update({
      where: { id },
      data: {
        collectedQuantity: nextIsCollected ? Math.max(item.quantity, boundedCollectedQuantity) : boundedCollectedQuantity,
        isCollected: nextIsCollected,
        collectedAt: nextIsCollected ? item.collectedAt ?? new Date() : null,
        ...(Object.prototype.hasOwnProperty.call(data, 'note') ? { note: data.note ?? null } : {}),
      },
      include: {
        batch: { select: { documentName: true, sourceUrl: true, createdAt: true } },
        system: { select: { id: true, code: true, name: true } },
        robot: { select: { id: true, code: true, name: true } },
        subsystem: { select: { id: true, robotId: true, code: true, name: true } },
      },
    });
  },

  // 縮圖代理：Onshape 縮圖端點需帶授權，前端 <img> 無法直接取
  async downloadTaskFile(userId, taskId, actor) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        manufacturingMethod: { select: { code: true } },
        material: { select: { code: true } },
      },
    });
    if (!task) throw ApiError.notFound('找不到任務');
    assertDownloadPermission(task, actor);

    const spec = downloadSpecForTask(task);
    if (!spec) {
      throw ApiError.badRequest('此加工方式或材料目前沒有可下載的加工檔案', 'TASK_DOWNLOAD_UNAVAILABLE');
    }
    if (!task.onshapeDid || !task.onshapeWvm || !task.onshapeWvmId || !task.onshapeEid || !task.onshapePartId) {
      throw ApiError.badRequest('此任務沒有可下載的 Onshape 單一零件資料', 'TASK_DOWNLOAD_NO_SOURCE');
    }

    let response;
    let buf;
    let contentType;
    if (spec.format === 'stl') {
      const query = new URLSearchParams({ mode: 'binary', grouping: 'true', scale: '1', units: 'millimeter' });
      if (task.onshapeConfig) query.set('configuration', task.onshapeConfig);
      response = await apiDownloadFetch(
        userId,
        `/parts/d/${task.onshapeDid}/${task.onshapeWvm}/${task.onshapeWvmId}/e/${task.onshapeEid}/partid/${encodeURIComponent(task.onshapePartId)}/stl?${query}`,
        { label: 'Onshape STL 下載' },
      );
      buf = Buffer.from(await response.arrayBuffer());
      contentType = response.headers.get('content-type') ?? spec.contentType;
    } else {
      buf = await exportStepDxf(userId, task);
      contentType = spec.contentType;
    }

    if (spec.format === 'dxf') assertValidDxf(buf);

    return {
      buf,
      contentType,
      filename: downloadFilename(task, spec.format),
    };
  },

  // 取得目前 workspace 的 microversion（給版本管理凍結快照用）。best-effort。
  async freezeMicroversion(userId, ref) {
    return fetchCurrentMicroversion(userId, ref);
  },

  async thumbnail(userId, { did, wvm, wvmId, eid }) {
    const res = await apiFetch(
      userId,
      `/thumbnails/d/${did}/${wvm}/${wvmId}/e/${eid}/s/300x170`,
      { raw: true, label: 'Onshape 縮圖讀取' },
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
      { label: 'Onshape 零件縮圖讀取' },
    );
    const b64 = Array.isArray(data.images) ? data.images[0] : null;
    if (!b64) throw ApiError.notFound('無法產生零件縮圖');
    return { buf: Buffer.from(b64, 'base64'), contentType: 'image/png' };
  },
};
