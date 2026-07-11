// API 層：型別依實際後端回應（2026-07-04 對本機後端實測 JSON）產生。
// 注意：所有 BigInt 欄位（id、totalPoints、partNumberSeq）序列化為「字串」。

export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? 'https://sidereal-parts-api.onrender.com/api/v1';

export const HEALTH_URL = API_BASE.replace(/\/api\/v1\/?$/, '') + '/health';

// ---------- 型別 ----------
export type Role = 'admin' | 'member';

export type TaskStatus =
  | 'pending'
  | 'accepted'
  | 'processing'
  | 'post_processing'
  | 'pending_review'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface Ref {
  code: string;
  name: string;
}
export interface MethodRef extends Ref {
  basePoints?: number;
  requiresReview?: boolean;
}
export interface UserRef {
  id: string;
  username: string;
}

export interface LeaderboardUser extends UserRef {
  rank: number;
  totalPoints: string;
}

export interface OptionRef extends Ref {
  id: number;
}
export interface MethodOption extends OptionRef {
  basePoints?: number;
  requiresReview?: boolean;
}
export interface MasterDataItem extends OptionRef {
  isActive: boolean;
}
export type MasterDataType = 'methods' | 'materials' | 'postProcesses';

export interface MetaOptions {
  systems: OptionRef[];
  methods: MethodOption[];
  materials: OptionRef[];
  postProcesses: OptionRef[];
}

export interface Task {
  id: string;
  partNumber: string;
  partNumberPrefix: string;
  partNumberSeq: string;
  manufacturingMethodId: number;
  systemId: number;
  robotId: string | null;
  subsystemId: string | null;
  materialId: number | null;
  postProcessId: number | null;
  creatorId: string;
  assigneeId: string | null;
  postProcessorId: string | null;
  quantity: number;
  rewardPoints: number;
  machiningExtensionMinutes: number;
  drawingUrl: string | null;
  dimensions: string | null;
  note: string | null;
  status: TaskStatus;
  reviewRejected?: boolean;
  processingStartedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  system: Ref;
  robot: RobotRef | null;
  subsystem: SubsystemRef | null;
  manufacturingMethod: MethodRef;
  material: Ref | null;
  postProcess: Ref | null;
  creator: UserRef;
  assignee: UserRef | null;
  postProcessor: UserRef | null;
  // M3：Onshape 參照（drawingUrl 為 Onshape 連結時後端自動解析）
  onshapeDid: string | null;
  onshapeWvm: string | null;
  onshapeWvmId: string | null;
  onshapeEid: string | null;
  onshapePartId: string | null;
  onshapeConfig: string | null;
  onshapeRevision: string | null;
  onshapeThumbnailUrl: string | null;
  onshapeImageMeta: unknown | null;
  importBatchId: string | null;
}

export interface TaskDownloadSpec {
  format: 'stl' | 'dxf';
  label: string;
}

export function getTaskDownloadSpec(task: Task): TaskDownloadSpec | null {
  if (!task.onshapePartId) return null;
  const methodCode = task.manufacturingMethod.code;
  const materialCode = task.material?.code ?? '';
  if (methodCode === '3DP') return { format: 'stl', label: 'STL' };
  if (methodCode === 'LASER') return { format: 'dxf', label: 'DXF' };
  if (methodCode === 'CNC' && (materialCode.startsWith('PC_') || materialCode.includes('PLATE'))) {
    return { format: 'dxf', label: 'DXF' };
  }
  return null;
}

export function getTaskDownloadFilename(task: Task, spec: TaskDownloadSpec): string {
  const sourceLine = task.note?.split('\n').find((line) => line.startsWith('Onshape: '));
  const originalName = sourceLine?.slice('Onshape: '.length).trim() || task.partNumber;
  const base = originalName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(new RegExp(`\\.${spec.format}$`, 'i'), '')
    .trim();
  return `${base || task.partNumber}.${spec.format}`;
}

export interface RobotRef {
  id: string;
  code: string;
  name: string;
}

export interface SubsystemRef {
  id: string;
  robotId: string;
  code: string;
  name: string;
}

// 任務進度統計（後端 attachProgress 附上）
export interface TaskProgress {
  pending: number;
  active: number;
  done: number;
  total: number;
  percent: number;
  machining?: {
    pending: number;
    active: number;
    done: number;
    total: number;
    percent: number;
  };
  parts?: {
    needed: number;
    collected: number;
    open: number;
    total: number;
    percent: number;
  };
}
export interface Robot extends RobotRef {
  note: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  subsystems: RobotSubsystem[];
  _count?: { tasks: number };
  progress?: TaskProgress;
}

export interface RobotSubsystem extends SubsystemRef {
  note: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  robot?: RobotRef;
  system?: { id: number; code: string; name: string } | null;
  _count?: { tasks: number };
  progress?: TaskProgress;
}

// ---------- M3: Onshape ----------
export interface OnshapeStatus {
  enabled: boolean;
  connected: boolean;
  connectedAt: string | null;
}

export interface OnshapeRef {
  did: string;
  wvm: string;
  wvmId: string;
  eid: string | null;
}

export interface OnshapeResolved {
  ref: OnshapeRef;
  documentName: string;
  ownerName: string | null;
  thumbnailPath: string | null;
}

export interface OnshapePart {
  partId: string;
  name: string;
  material: string | null;
}

export interface OnshapeBomItem {
  rowKey: string;
  name: string | null;
  quantity: number;
  material: string | null;
  partNumber: string | null;
  sourceDocumentId: string | null;
  sourceElementId: string | null;
  sourcePartId: string | null;
  sourceConfig: string | null;
  classification: 'made' | 'cots' | 'unknown';
  classificationReason: string | null;
  cotsReason: string | null;
}

// 匯入時逐件覆寫（前端在預覽後編輯）
export interface OnshapeImportItem {
  rowKey: string;
  classification?: 'made' | 'cots' | 'skip';
  manufacturingMethodId?: number | null;
  materialId?: number | null;
  postProcessId?: number | null;
  quantity?: number;
  assigneeId?: string | null; // 逐件指派（僅 admin）
}

// 此組合（assembly）加工進度
export interface AssemblyProgress {
  progress: TaskProgress;
  tasks: Array<{
    id: string;
    partNumber: string;
    note: string | null;
    status: TaskStatus;
    quantity: number;
    assignee: { username: string } | null;
  }>;
}

export interface OnshapeImportPreview {
  ref: OnshapeRef;
  documentName: string;
  ownerName: string | null;
  thumbnailPath: string | null;
  made: OnshapeBomItem[];
  cots: OnshapeBomItem[];
  unknown: OnshapeBomItem[];
  summary: {
    total: number;
    madeCount: number;
    cotsCount: number;
    unknownCount: number;
    imageCount: number;
    imageFailedCount: number;
  };
}

export interface OnshapeImportResult {
  batchId: string;
  created: number;
  updated: number;
  cotsCount: number;
  skippedCount?: number;
  imageCount: number;
  imageFailedCount: number;
  documentName: string;
  tasks: Array<{ id: string; partNumber: string; status: TaskStatus }>;
  cots: OnshapeBomItem[];
}

// COTS / 跳過零件（匯入時落地保存的非自製列）
export interface ImportItemRow {
  id: string;
  kind: 'cots' | 'skipped';
  name: string | null;
  partNumber: string | null;
  quantity: number;
  collectedQuantity: number;
  isCollected: boolean;
  collectedAt: string | null;
  material: string | null;
  note: string | null;
  system: OptionRef | null;
  robot: RobotRef | null;
  subsystem: SubsystemRef | null;
  createdAt: string;
  batch?: { documentName: string | null; sourceUrl: string; createdAt: string };
}

export interface Me {
  id: string;
  username: string;
  role: Role;
  totalPoints: string; // BigInt -> string
  createdAt: string;
}

export interface AuthPayload {
  user: { id: string; username: string; role: Role };
  accessToken: string;
  refreshToken: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface CreateTaskInput {
  systemId: number;
  robotId?: string;
  subsystemId?: string;
  manufacturingMethodId: number;
  quantity: number;
  materialId?: number;
  postProcessId?: number;
  assigneeId?: string; // BigInt id 以字串傳遞
  postProcessorId?: string;
  drawingUrl?: string;
  dimensions?: string;
  note?: string;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Array<{ field: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------- token 儲存 ----------
const ACCESS_KEY = 'pt.access';
const REFRESH_KEY = 'pt.refresh';

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

// 401 且 refresh 失敗時通知 AuthProvider 登出
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

// ---------- fetch 包裝 ----------
async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const access = tokens.access;
  if (access && !headers.Authorization) headers.Authorization = `Bearer ${access}`;
  return fetch(API_BASE + path, { ...init, headers });
}

// refresh 單一航班：多個請求同時 401 只打一次 /auth/refresh
let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const rt = tokens.refresh;
      if (!rt) return false;
      try {
        const res = await fetch(API_BASE + '/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) return false;
        const data = json.data as AuthPayload;
        tokens.set(data.accessToken, data.refreshToken); // 輪替：兩把都換新
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await raw(path, init);
  } catch {
    throw new ApiError(0, 'NETWORK', '無法連線到伺服器');
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await tryRefresh()) return api<T>(path, init, false);
    tokens.clear();
    onUnauthorized();
    throw new ApiError(401, 'UNAUTHORIZED', '登入已過期，請重新登入');
  }

  let json: {
    success: boolean;
    data?: T;
    error?: { code: string; message: string; details?: Array<{ field: string; message: string }> };
  };
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', `伺服器回應異常（${res.status}）`);
  }
  if (!res.ok || !json.success) {
    const e = json.error ?? { code: 'UNKNOWN', message: '未知錯誤' };
    const detailText = e.details?.length
      ? `：${e.details.map((d) => `${d.field || '欄位'} ${d.message}`).join('；')}`
      : '';
    throw new ApiError(res.status, e.code, `${e.message}${detailText}`, e.details);
  }
  return json.data as T;
}

async function downloadFile(
  path: string,
  fallbackFilename: string,
  retry = true,
): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await raw(path);
  } catch {
    throw new ApiError(0, 'NETWORK', '無法連線到伺服器');
  }

  if (res.status === 401 && retry && (await tryRefresh())) return downloadFile(path, fallbackFilename, false);
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const error = payload?.error;
    throw new ApiError(res.status, error?.code ?? 'DOWNLOAD_FAILED', error?.message ?? '檔案下載失敗');
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const encodedFilename = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const filename = encodedFilename
    ? decodeURIComponent(encodedFilename)
    : /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackFilename;
  return { blob: await res.blob(), filename };
}

// ---------- API modules ----------
export const authApi = {
  login: (username: string, password: string) =>
    api<AuthPayload>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => api<Me>('/auth/me'),
  logout: () => {
    const rt = tokens.refresh;
    tokens.clear();
    if (rt)
      api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) }).catch(
        () => {},
      );
  },
};

export const usersApi = {
  members: () => api<UserRef[]>('/users/members'),
  processors: () => api<UserRef[]>('/users/processors'),
  leaderboard: () => api<LeaderboardUser[]>('/users/leaderboard'),
};

export const taskApi = {
  list: (query = '') => api<Paged<Task>>(`/tasks?limit=100${query ? `&${query}` : ''}`),
  get: (id: string) => api<Task>(`/tasks/${id}`),
  create: (input: CreateTaskInput) =>
    api<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
  // Backward compatible with the currently deployed backend, which accepts
  // unassigned pending tasks through the status endpoint but may not have
  // POST /tasks/:id/claim deployed yet.
  claim: (id: string) =>
    api<Task>(`/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) }),
  updateStatus: (id: string, status: TaskStatus) =>
    api<Task>(`/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  extendMachiningTime: (id: string) =>
    api<Task>(`/tasks/${id}/extend-time`, { method: 'POST' }),
  claimPostProcess: (id: string) =>
    api<Task>(`/tasks/${id}/claim-post-process`, { method: 'POST' }),
  downloadFile: (id: string, fallbackFilename: string) =>
    downloadFile(`/tasks/${id}/download`, fallbackFilename),
};

export const robotApi = {
  list: () => api<Robot[]>('/robots'),
  get: (id: string) => api<Robot>(`/robots/${id}`),
  create: (input: { code?: string; name: string; note?: string }) =>
    api<Robot>('/robots', { method: 'POST', body: JSON.stringify(input) }),
  createSubsystem: (robotId: string, input: { code?: string; name: string; note?: string }) =>
    api<RobotSubsystem>(`/robots/${robotId}/subsystems`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getSubsystem: (id: string) => api<RobotSubsystem>(`/robots/subsystems/${id}`),
  subsystemTasks: (id: string) => api<Paged<Task>>(`/robots/subsystems/${id}/tasks?limit=100`),
};

export const metaApi = {
  options: () => api<MetaOptions>('/meta/options'),
  listMaster: (type: MasterDataType) => api<MasterDataItem[]>(`/meta/admin/${type}`),
  createMaster: (type: MasterDataType, input: { code: string; name: string; isActive?: boolean }) =>
    api<MasterDataItem>(`/meta/admin/${type}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateMaster: (
    type: MasterDataType,
    id: number,
    input: { code?: string; name?: string; isActive?: boolean },
  ) =>
    api<MasterDataItem>(`/meta/admin/${type}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};

export const onshapeApi = {
  status: () => api<OnshapeStatus>('/onshape/status'),
  authUrl: (returnTo?: string) =>
    api<{ url: string }>(`/onshape/auth-url${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`),
  disconnect: () => api<{ disconnected: boolean }>('/onshape/connection', { method: 'DELETE' }),
  resolve: (url: string) =>
    api<OnshapeResolved>('/onshape/resolve', { method: 'POST', body: JSON.stringify({ url }) }),
  parts: (r: { did: string; wvm: string; wvmId: string; eid: string }) =>
    api<OnshapePart[]>(`/onshape/parts?did=${r.did}&wvm=${r.wvm}&wvmId=${r.wvmId}&eid=${r.eid}`),
  importPreview: (url: string) =>
    api<OnshapeImportPreview>('/onshape/import/preview', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  importBom: (input: {
    url: string;
    systemId?: number;
    robotId?: string;
    subsystemId?: string;
    manufacturingMethodId?: number; // 全域預設（逐件未指定時採用）
    materialId?: number;
    postProcessId?: number;
    items?: OnshapeImportItem[]; // 逐件覆寫
  }) =>
    api<OnshapeImportResult>('/onshape/import', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  assemblyProgress: (r: { did: string; wvm: string; wvmId: string; eid: string }) =>
    api<AssemblyProgress>(
      `/onshape/assembly-progress?did=${r.did}&wvm=${r.wvm}&wvmId=${r.wvmId}&eid=${r.eid}`,
    ),
  importItems: (
    options: {
      kind?: 'cots' | 'skipped' | 'all';
      collected?: 'all' | 'open' | 'done';
      systemId?: number;
      robotId?: string;
      subsystemId?: string;
      page?: number;
    } = {},
  ) => {
    const q = new URLSearchParams({
      kind: options.kind ?? 'all',
      collected: options.collected ?? 'all',
      page: String(options.page ?? 1),
      limit: '100',
    });
    if (options.systemId) q.set('systemId', String(options.systemId));
    if (options.robotId) q.set('robotId', options.robotId);
    if (options.subsystemId) q.set('subsystemId', options.subsystemId);
    return api<Paged<ImportItemRow>>(`/onshape/import-items?${q}`);
  },
  updateImportItem: (
    id: string,
    input: { collectedQuantity?: number; isCollected?: boolean; note?: string | null },
  ) =>
    api<ImportItemRow>(`/onshape/import-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};

/** 縮圖需帶 JWT，<img src> 無法帶 header → fetch blob 轉 object URL。
 *  回傳 null 表示未連結 Onshape（428）；其他錯誤丟 ApiError。 */
export async function fetchOnshapeThumbnail(r: {
  did: string;
  wvm: string;
  wvmId: string;
  eid: string;
}): Promise<string | null> {
  const path = `/onshape/thumbnail?did=${r.did}&wvm=${r.wvm}&wvmId=${r.wvmId}&eid=${r.eid}`;
  const res = await fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${tokens.access}` },
  });
  if (res.status === 428) return null; // 尚未連結 Onshape
  if (!res.ok) throw new ApiError(res.status, 'THUMBNAIL_ERROR', '縮圖載入失敗');
  return URL.createObjectURL(await res.blob());
}

/** 單一零件縮圖（Part Studio shaded view）。個別失敗回 null，不擋清單。 */
export async function fetchOnshapePartThumbnail(r: {
  did: string;
  wvm: string;
  wvmId: string;
  eid: string;
  partId: string;
}): Promise<string | null> {
  const path = `/onshape/part-thumbnail?did=${r.did}&wvm=${r.wvm}&wvmId=${r.wvmId}&eid=${r.eid}&partId=${encodeURIComponent(r.partId)}`;
  const res = await fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${tokens.access}` },
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

// ---------- 狀態機（與 backend/src/constants/taskStatus.js 對齊） ----------
// 有後處理：processing -> post_processing(交棒，加工分入帳) -> completed(後處理者，後處理分入帳)
// 無後處理：processing -> completed(加工者，全額入帳)
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['accepted', 'cancelled'],
  accepted: ['processing', 'rejected', 'cancelled'],
  processing: ['pending_review', 'post_processing', 'completed', 'rejected', 'cancelled'],
  pending_review: ['completed', 'post_processing', 'processing', 'cancelled'],
  post_processing: ['completed', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
};

/** 依目前使用者與任務狀態，回傳可執行的合法目標狀態（非法的直接不顯示）
 *  接單制：pending 未指派 = 任務池，member 按「接單」即認領並接受
 *  驗收制：需驗收的加工方式（requiresReview），加工中只能「送審」，
 *          待驗收(pending_review)後由管理員核准/退回。 */
export function allowedActions(task: Task, me: Me): TaskStatus[] {
  const hasPost = task.postProcessId != null;
  const requiresReview = Boolean(task.manufacturingMethod.requiresReview);
  const isOpenPool = task.status === 'pending' && !task.assignee;
  const fromReview = task.status === 'pending_review';
  const isAdmin = me.role === 'admin';
  const isAssignee = task.assignee?.id === me.id;
  const isCreator = task.creator.id === me.id;
  const isPostProcessor = task.postProcessor?.id === me.id;

  // 結構性可行的轉換（與後端狀態機一致）
  const nexts = TRANSITIONS[task.status].filter((s) => {
    if (task.status === 'processing' && requiresReview && (s === 'completed' || s === 'post_processing'))
      return false;
    if (s === 'pending_review') return requiresReview;
    if (s === 'post_processing') return hasPost;
    if (s === 'completed' && task.status === 'processing') return !hasPost;
    if (s === 'completed' && fromReview) return !hasPost; // 有後處理則驗收後走 post_processing
    if (isOpenPool && s === 'rejected') return false;
    return true;
  });

  // 逐動作對應角色（管理員只做「驗收決定」與「取消」）
  return nexts.filter((s) => {
    switch (s) {
      case 'accepted':
        return isOpenPool && me.role === 'member'; // 接單
      case 'rejected':
        return isAssignee; // 放棄回池
      case 'pending_review':
        return isAssignee; // 送審
      case 'processing':
        return fromReview ? isAdmin : isAssignee; // 退回重做(admin) / 開始加工(assignee)
      case 'post_processing':
        return fromReview ? isAdmin : isAssignee;
      case 'completed':
        if (task.status === 'post_processing') return isPostProcessor;
        if (fromReview) return isAdmin; // 驗收通過
        return isAssignee; // 免驗收直接完成
      case 'cancelled':
        return isCreator || isAdmin;
      default:
        return false;
    }
  });
}

/** 依來源/目標狀態產生按鈕文字（同一目標在不同來源語意不同） */
export function transitionLabel(from: TaskStatus, to: TaskStatus): string {
  if (to === 'pending_review') return '送審驗收';
  if (from === 'pending_review') {
    if (to === 'completed') return '驗收通過，完成';
    if (to === 'post_processing') return '驗收通過，進入後處理';
    if (to === 'processing') return '退件重做';
  }
  if (to === 'accepted' && from === 'pending') return '接單';
  return ACTION_LABEL[to];
}

export function canClaimPostProcess(task: Task, me: Me): boolean {
  return task.status === 'post_processing' && !task.postProcessor && me.role === 'member';
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待接受',
  accepted: '已接單',
  processing: '加工中',
  post_processing: '後處理中',
  pending_review: '待驗收',
  completed: '已完成',
  rejected: '已退回',
  cancelled: '已取消',
};

export const ACTION_LABEL: Record<TaskStatus, string> = {
  pending: '退回待接',
  accepted: '接單',
  rejected: '放棄任務',
  processing: '開始加工',
  post_processing: '加工完成，交棒後處理',
  pending_review: '送審驗收',
  completed: '完成',
  cancelled: '取消任務',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: '管理員',
  member: '隊員',
};

export const FALLBACK_SYSTEM_OPTIONS = [
  { id: 1, label: 'ARM - 機械手臂' },
  { id: 2, label: 'CHS - 底盤系統' },
  { id: 3, label: 'PWR - 電控系統' },
];
export const FALLBACK_METHOD_OPTIONS = [
  { id: 1, label: 'CNC - CNC Router' },
  { id: 2, label: 'LATHE - 車床' },
  { id: 3, label: '3DP - 3D 列印' },
  { id: 4, label: 'MANUAL_MILL - 手動銑床' },
  { id: 5, label: 'LASER - 雷切機' },
  { id: 6, label: 'CUTOFF - 切斷機' },
];
export const FALLBACK_MATERIAL_OPTIONS = [
  { id: 3, label: 'PLA' },
  { id: 4, label: 'ABS' },
  { id: 5, label: 'PACF - PA-CF' },
  { id: 6, label: 'MDF_3MM - 密集板 3mm' },
  { id: 7, label: 'MDF_6MM - 密集板 6mm' },
  { id: 8, label: 'SRPP_6MM - SRPP 6mm' },
  { id: 9, label: 'PC_3MM - PC 3mm' },
  { id: 10, label: 'PC_6MM - PC 6mm' },
  { id: 11, label: 'AL6061_PLATE_3MM - 6061 鋁板 3mm' },
  { id: 12, label: 'AL6061_PLATE_5MM - 6061 鋁板 5mm' },
  { id: 13, label: 'HEX_SHAFT_0_5IN - 六角軸 1/2in' },
  { id: 14, label: 'ROUND_SHAFT_10MM - 圓軸 10mm' },
  { id: 15, label: 'ROUND_SHAFT_15MM - 圓軸 15mm' },
];
export const FALLBACK_POST_PROCESS_OPTIONS = [
  { id: 4, label: 'TAP - 攻牙' },
  { id: 5, label: 'CHAMFER - 倒角' },
];

export function toSelectOptions(items: OptionRef[]) {
  return items.map((o) => ({ id: o.id, label: `${o.code} - ${o.name}` }));
}
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
