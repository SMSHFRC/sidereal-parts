// Onshape 內嵌面板（M4）：繪圖者在 Onshape 右側直接匯入 BOM。
// 流程：選機器人子系統（必須先在網站建立）→ 預覽 → 逐件調整
// （加工/COTS/跳過、每件獨立的加工方式與材料）→ 匯入。
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ApiError,
  FALLBACK_MATERIAL_OPTIONS,
  FALLBACK_METHOD_OPTIONS,
  FALLBACK_POST_PROCESS_OPTIONS,
  STATUS_LABEL,
  fetchOnshapeThumbnail,
  fetchOnshapePartThumbnail,
  metaApi,
  onshapeApi,
  robotApi,
  taskApi,
  toSelectOptions,
  usersApi,
  type AssemblyProgress,
  type OnshapeBomItem,
  type OnshapeImportItem,
  type OnshapeImportPreview,
  type OnshapeImportResult,
  type Robot,
  type UserRef,
} from '../api';
import { useAuth } from '../auth';

const inputCls =
  'mt-1 w-full min-h-10 rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-900';
const cellCls =
  'w-full min-h-9 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-slate-900';

type SelectOption = { id: number; label: string };
type Cls = 'made' | 'cots' | 'skip';
type Edit = {
  classification: Cls;
  methodId: string;
  materialId: string;
  postProcessId: string; // 逐件後處理（空 = 用全域預設）
  quantity: string;
  assigneeId: string; // 逐件指派（僅 admin 顯示）
  isUrgent: boolean; // 逐件急件
};
type View = 'import' | 'progress' | 'add';

type PanelRef = {
  did: string;
  wvm: 'w' | 'v' | 'm';
  wvmId: string;
  eid: string;
};

const ONSHAPE_ID_RE = /^[0-9a-f]{24}$/i;
const PANEL_ACTION_URL =
  'https://sidereal-parts.pages.dev/onshape-panel?did={$documentId}&wvm={$workspaceOrVersion}&wvmid={$workspaceOrVersionId}&eid={$elementId}';

function readPanelRef(): PanelRef | null {
  const q = new URLSearchParams(window.location.search);
  const did = (q.get('did') ?? q.get('documentId'))?.trim() ?? '';
  const eid = (q.get('eid') ?? q.get('elementId'))?.trim() ?? '';
  const rawWvm =
    q.get('wvm') ??
    q.get('workspaceOrVersion') ??
    (q.get('workspaceId') ? 'w' : q.get('versionId') ? 'v' : q.get('microversionId') ? 'm' : null);
  const rawWvmId =
    q.get('wvmId') ??
    q.get('wvmid') ??
    q.get('workspaceOrVersionId') ??
    q.get('workspaceId') ??
    q.get('versionId') ??
    q.get('microversionId');
  const normalizedWvm = rawWvm?.trim().toLowerCase();
  const wvm = normalizedWvm === 'w' || normalizedWvm === 'v' || normalizedWvm === 'm' ? normalizedWvm : null;
  const wvmId = rawWvmId?.trim() ?? '';
  if (!ONSHAPE_ID_RE.test(did) || !wvm || !ONSHAPE_ID_RE.test(wvmId) || !ONSHAPE_ID_RE.test(eid)) {
    return null;
  }
  return { did, wvm, wvmId, eid };
}

function panelRefError() {
  const values = [...new URLSearchParams(window.location.search).values()];
  if (values.some((value) => value.includes('$') || value.includes('[') || value.includes('{'))) {
    return `Onshape Action URL 變數沒有正確展開，請改成：${PANEL_ACTION_URL}`;
  }
  return `缺少或無效的 Onshape 文件參數。Action URL 請設定為：${PANEL_ACTION_URL}`;
}

function makeOnshapeUrl(ref: PanelRef) {
  return `https://cad.onshape.com/documents/${ref.did}/${ref.wvm}/${ref.wvmId}/e/${ref.eid}`;
}

// 逐件縮圖：預設收合的「下拉」，展開才向 Onshape 算圖（避免一次發數十個算圖請求）
function RowThumb({
  row,
  osRef,
}: {
  row: OnshapeBomItem;
  osRef: PanelRef;
}) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'none'>('idle');

  // 算縮圖的參照：本文件零件走 assembly 工作區；外部文件（COTS）走其 version / microversion
  const sameDoc = !row.sourceDocumentId || row.sourceDocumentId === osRef.did;
  const thumbRef =
    row.sourcePartId && row.sourceElementId
      ? sameDoc
        ? { did: osRef.did, wvm: osRef.wvm, wvmId: osRef.wvmId, eid: row.sourceElementId, partId: row.sourcePartId }
        : row.sourceVersionId
          ? { did: row.sourceDocumentId!, wvm: 'v', wvmId: row.sourceVersionId, eid: row.sourceElementId, partId: row.sourcePartId }
          : row.sourceMicroversionId
            ? { did: row.sourceDocumentId!, wvm: 'm', wvmId: row.sourceMicroversionId, eid: row.sourceElementId, partId: row.sourcePartId }
            : null
      : null;

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  if (!thumbRef) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state === 'idle') {
      setState('loading');
      fetchOnshapePartThumbnail(thumbRef)
        .then((u) => {
          if (u) {
            setSrc(u);
            setState('ok');
          } else setState('none');
        })
        .catch(() => setState('none'));
    }
  };

  return (
    <div className="mt-1">
      <button type="button" onClick={toggle} className="text-[10px] font-medium text-slate-500 underline">
        {open ? '收合縮圖 ▴' : '看縮圖 ▾'}
      </button>
      {open && (
        <div className="mt-1 flex h-28 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          {state === 'ok' && src ? (
            <img src={src} alt={row.name ?? ''} className="h-full w-full object-contain" />
          ) : state === 'loading' ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
          ) : (
            <span className="text-[10px] text-slate-400">無法產生縮圖</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function OnshapePanel() {
  const ref = useMemo(readPanelRef, []);
  const url = ref ? makeOnshapeUrl(ref) : '';
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [view, setView] = useState<View>('import');
  const [members, setMembers] = useState<UserRef[]>([]);
  const [assemblyProg, setAssemblyProg] = useState<AssemblyProgress | null>(null);
  const [progBusy, setProgBusy] = useState(false);
  const [robots, setRobots] = useState<Robot[] | null>(null);
  const [methods, setMethods] = useState<SelectOption[]>(FALLBACK_METHOD_OPTIONS);
  const [materials, setMaterials] = useState<SelectOption[]>(FALLBACK_MATERIAL_OPTIONS);
  const [postProcesses, setPostProcesses] = useState<SelectOption[]>(FALLBACK_POST_PROCESS_OPTIONS);
  const [subsystemId, setSubsystemId] = useState('');
  const [methodId, setMethodId] = useState(''); // 全域預設加工方式
  const [materialId, setMaterialId] = useState(''); // 全域預設材料
  const [postProcessId, setPostProcessId] = useState('');
  const [preview, setPreview] = useState<OnshapeImportPreview | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [importMode, setImportMode] = useState<'all' | 'selective'>('all'); // 全部匯入 / 單獨匯入
  const [selected, setSelected] = useState<Record<string, boolean>>({}); // 單獨匯入勾選（rowKey→是否）
  const [result, setResult] = useState<OnshapeImportResult | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [error, setError] = useState('');

  // 主檔 + 機器人清單
  useEffect(() => {
    metaApi
      .options()
      .then((options) => {
        setMethods(toSelectOptions(options.methods));
        setMaterials(toSelectOptions(options.materials));
        setPostProcesses(toSelectOptions(options.postProcesses));
      })
      .catch(() => {});
    robotApi
      .list()
      .then(setRobots)
      .catch(() => setRobots([]));
  }, []);

  // admin：載入 member 清單供逐件指派
  useEffect(() => {
    if (isAdmin) usersApi.members().then(setMembers).catch(() => {});
  }, [isAdmin]);

  // 此組合加工進度
  const loadProgress = async () => {
    if (!ref) return;
    setProgBusy(true);
    try {
      setAssemblyProg(await onshapeApi.assemblyProgress(ref));
    } catch {
      setAssemblyProg(null);
    } finally {
      setProgBusy(false);
    }
  };
  useEffect(() => {
    if (view === 'progress' && !assemblyProg) loadProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (!ref) return;
    let objectUrl: string | null = null;
    fetchOnshapeThumbnail(ref)
      .then((u) => {
        if (u) {
          objectUrl = u;
          setThumb(u);
        }
      })
      .catch(() => setThumb(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ref]);

  const allRows: OnshapeBomItem[] = useMemo(
    () => (preview ? [...preview.made, ...preview.cots, ...preview.unknown] : []),
    [preview],
  );

  // 預覽載入後初始化逐件編輯狀態
  useEffect(() => {
    if (!preview) return;
    const init: Record<string, Edit> = {};
    for (const row of allRows) {
      init[row.rowKey] = {
        classification: row.classification === 'unknown' ? 'made' : row.classification,
        methodId: '',
        materialId: '',
        postProcessId: '',
        quantity: String(row.quantity || 1),
        assigneeId: '',
        isUrgent: false,
      };
    }
    setEdits(init);
    setSelected({}); // 預覽重新載入時清空單獨匯入的勾選
  }, [preview, allRows]);

  const setEdit = (rowKey: string, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], ...patch } }));

  const liveMade = allRows.filter((r) => edits[r.rowKey]?.classification === 'made');
  const liveCots = allRows.filter((r) => edits[r.rowKey]?.classification === 'cots');
  const liveSkip = allRows.filter((r) => edits[r.rowKey]?.classification === 'skip');

  // 單獨匯入時，實際要同步的零件 = 勾選的加工件；全部匯入時 = 所有加工件
  const selectiveMode = importMode === 'selective';
  const importTargets = selectiveMode ? liveMade.filter((r) => selected[r.rowKey]) : liveMade;
  const toggleSelected = (rowKey: string) =>
    setSelected((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
  const setAllSelected = (value: boolean) =>
    setSelected(value ? Object.fromEntries(liveMade.map((r) => [r.rowKey, true])) : {});

  const subsystemOptions = (robots ?? []).flatMap((robot) =>
    robot.subsystems.map((sub) => ({
      id: sub.id,
      label: `${robot.name} / ${sub.name}`,
      systemId: sub.system?.id,
    })),
  );
  const noSubsystems = robots !== null && subsystemOptions.length === 0;

  const previewBom = async () => {
    if (!ref) return;
    setError('');
    setResult(null);
    setBusy('preview');
    try {
      setPreview(await onshapeApi.importPreview(url));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'BOM 預覽失敗');
    } finally {
      setBusy(null);
    }
  };

  const importBom = async () => {
    if (!preview || !ref) return;
    if (!subsystemId) {
      setError('請先選擇機器人子系統');
      return;
    }
    if (importTargets.length === 0) {
      setError(selectiveMode ? '請至少勾選一個要同步的零件' : '沒有要加工的零件');
      return;
    }
    const noMethod = importTargets.filter((r) => !(edits[r.rowKey].methodId || methodId));
    if (noMethod.length > 0) {
      setError(`有 ${noMethod.length} 個加工件未選加工方式（設預設或逐件選）`);
      return;
    }
    setError('');
    setBusy('import');
    try {
      const madeItem = (row: OnshapeBomItem): OnshapeImportItem => {
        const e = edits[row.rowKey];
        return {
          rowKey: row.rowKey,
          classification: 'made',
          manufacturingMethodId: Number(e.methodId || methodId),
          materialId: e.materialId ? Number(e.materialId) : materialId ? Number(materialId) : null,
          postProcessId: e.postProcessId
            ? Number(e.postProcessId)
            : postProcessId
              ? Number(postProcessId)
              : null,
          quantity: Number(e.quantity) || 1,
          ...(isAdmin && e.assigneeId ? { assigneeId: e.assigneeId } : {}),
          ...(e.isUrgent ? { isUrgent: true } : {}),
        };
      };
      // 單獨匯入：只送勾選件 + selection，其餘零件後端完全不動。
      // 全部匯入：送全部列（含 COTS/跳過分類），維持既有同步行為。
      const items: OnshapeImportItem[] = selectiveMode
        ? importTargets.map(madeItem)
        : allRows.map((row) => {
            const e = edits[row.rowKey];
            if (e.classification !== 'made')
              return { rowKey: row.rowKey, classification: e.classification === 'skip' ? 'skip' : 'cots' };
            return madeItem(row);
          });
      setResult(
        await onshapeApi.importBom({
          url,
          subsystemId,
          ...(methodId ? { manufacturingMethodId: Number(methodId) } : {}),
          items,
          ...(selectiveMode ? { selection: importTargets.map((r) => r.rowKey) } : {}),
        }),
      );
      setAssemblyProg(null); // 匯入後進度快取失效，下次切到進度分頁重抓
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '匯入失敗');
    } finally {
      setBusy(null);
    }
  };

  // ---- 自行新增零件（必附 Google 雲端連結）----
  const [addForm, setAddForm] = useState({
    name: '',
    quantity: '1',
    methodId: '',
    materialId: '',
    postProcessId: '',
    driveUrl: '',
  });
  const [addBusy, setAddBusy] = useState(false);
  const [addDone, setAddDone] = useState<string | null>(null); // partNumber

  const submitAddPart = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setAddDone(null);
    const sub = subsystemOptions.find((o) => o.id === subsystemId);
    if (!subsystemId || !sub?.systemId) {
      setError('請先選擇機器人子系統');
      return;
    }
    if (!/^https:\/\/(drive|docs)\.google\.com\//i.test(addForm.driveUrl.trim())) {
      setError('請附上 Google 雲端連結（https://drive.google.com/… 或 docs.google.com/…）');
      return;
    }
    setAddBusy(true);
    try {
      const task = await taskApi.create({
        systemId: sub.systemId,
        subsystemId,
        manufacturingMethodId: Number(addForm.methodId),
        quantity: Number(addForm.quantity) || 1,
        ...(addForm.materialId ? { materialId: Number(addForm.materialId) } : {}),
        ...(addForm.postProcessId ? { postProcessId: Number(addForm.postProcessId) } : {}),
        drawingUrl: addForm.driveUrl.trim(),
        note: addForm.name.trim(),
      });
      setAddDone(task.partNumber);
      setAssemblyProg(null);
      setAddForm({ name: '', quantity: '1', methodId: '', materialId: '', postProcessId: '', driveUrl: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '新增零件失敗');
    } finally {
      setAddBusy(false);
    }
  };

  const reconnectOnshape = async () => {
    setError('');
    setConnectBusy(true);
    try {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const { url: authUrl } = await onshapeApi.authUrl(returnTo);
      const popup = window.open(authUrl, '_blank');
      if (!popup) window.location.assign(authUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '無法開啟 Onshape 授權頁面');
    } finally {
      setConnectBusy(false);
    }
  };

  const clsBtn = (active: boolean, color: string) =>
    `min-h-8 flex-1 rounded-md px-1 text-[11px] font-semibold ${active ? color : 'bg-slate-100 text-slate-500'}`;

  if (!ref) {
    return (
      <main className="min-h-dvh bg-slate-50 p-3">
        <div className="break-words rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {panelRefError()}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50 p-3 text-slate-900">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
        <img src="/logo.png" alt="FRC 9501" className="h-8 w-8 rounded-md" />
        <div>
          <h1 className="text-sm font-bold">sidereal-parts</h1>
          <p className="text-xs text-slate-500">Onshape 匯入</p>
        </div>
        </div>
        <button
          type="button"
          onClick={reconnectOnshape}
          disabled={connectBusy}
          className="min-h-9 shrink-0 rounded-md border border-emerald-600 px-2.5 text-xs font-semibold text-emerald-700 disabled:opacity-50"
        >
          {connectBusy ? '開啟中...' : '連結 Onshape'}
        </button>
      </header>

      {thumb && (
        <img
          src={thumb}
          alt="Onshape thumbnail"
          className="mt-3 h-28 w-full rounded-lg border border-slate-200 bg-white object-contain"
        />
      )}

      {/* 分頁：匯入 / 進度 / 新增零件 */}
      <div className="mt-3 flex gap-1.5">
        {(
          [
            { key: 'import', label: '匯入 BOM' },
            { key: 'progress', label: '加工進度' },
            { key: 'add', label: '新增零件' },
          ] as { key: View; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`min-h-9 flex-1 rounded-md text-xs font-semibold ${
              view === t.key ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== 加工進度：此組合匯入任務的狀態 ===== */}
      {view === 'progress' && (
        <section className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">此組合的加工進度</p>
            <button
              onClick={loadProgress}
              disabled={progBusy}
              className="min-h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-600 disabled:opacity-50"
            >
              {progBusy ? '更新中…' : '重新整理'}
            </button>
          </div>
          {progBusy && !assemblyProg ? (
            <p className="py-4 text-center text-xs text-slate-400">讀取中…</p>
          ) : !assemblyProg || assemblyProg.progress.total === 0 ? (
            <p className="rounded-md bg-slate-100 px-3 py-3 text-center text-xs text-slate-500">
              這個組合還沒有匯入過任務
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    待接 {assemblyProg.progress.pending} · 進行 {assemblyProg.progress.active} · 完成 {assemblyProg.progress.done}
                  </span>
                  <span className="text-base font-bold text-slate-900">{assemblyProg.progress.percent}%</span>
                </div>
                <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="bg-emerald-500"
                    style={{ width: `${(assemblyProg.progress.done / assemblyProg.progress.total) * 100}%` }}
                  />
                  <div
                    className="bg-indigo-400"
                    style={{ width: `${(assemblyProg.progress.active / assemblyProg.progress.total) * 100}%` }}
                  />
                </div>
              </div>
              <div className="max-h-72 space-y-1.5 overflow-auto">
                {[...assemblyProg.tasks]
                  .sort((a, b) => Number(b.isUrgent) - Number(a.isUrgent))
                  .map((t) => (
                  <div key={t.id} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold text-slate-900">{t.partNumber}</span>
                      <span className="flex items-center gap-1">
                        {t.isUrgent && (
                          <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            急件
                          </span>
                        )}
                        <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          t.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : t.status === 'pending'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-indigo-100 text-indigo-800'
                        }`}
                      >
                        {STATUS_LABEL[t.status]}
                        </span>
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">
                      {(t.note?.split('\n')[0] ?? '').replace(/^Onshape: /, '') || '—'} · x{t.quantity}
                      {t.assignee ? ` · ${t.assignee.username}` : ' · 未接單'}
                    </p>
                  </div>
                  ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ===== 新增零件（手動）：必附 Google 雲端連結 ===== */}
      {view === 'add' && (
        <form onSubmit={submitAddPart} className="mt-3 space-y-2">
          {noSubsystems ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              尚未建立機器人子系統，請先到網站的「機器人」頁建立。
            </div>
          ) : (
            <>
              <label className="block text-xs font-medium text-slate-700">
                機器人子系統 *
                <select value={subsystemId} onChange={(e) => setSubsystemId(e.target.value)} className={inputCls} required>
                  <option value="">選擇</option>
                  {subsystemOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                零件名稱 *
                <input
                  value={addForm.name}
                  onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                  required
                  placeholder="例：intake 側板 v2"
                  className={inputCls}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-slate-700">
                  加工方式 *
                  <select
                    value={addForm.methodId}
                    onChange={(e) => setAddForm((p) => ({ ...p, methodId: e.target.value }))}
                    className={inputCls}
                    required
                  >
                    <option value="">選擇</option>
                    {methods.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  數量 *
                  <input
                    type="number"
                    min={1}
                    value={addForm.quantity}
                    onChange={(e) => setAddForm((p) => ({ ...p, quantity: e.target.value }))}
                    className={inputCls}
                    required
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium text-slate-700">
                  材料
                  <select
                    value={addForm.materialId}
                    onChange={(e) => setAddForm((p) => ({ ...p, materialId: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">（不指定）</option>
                    {materials.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  後處理
                  <select
                    value={addForm.postProcessId}
                    onChange={(e) => setAddForm((p) => ({ ...p, postProcessId: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">無</option>
                    {postProcesses.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-medium text-slate-700">
                Google 雲端連結 *（圖檔/設計文件）
                <input
                  type="url"
                  value={addForm.driveUrl}
                  onChange={(e) => setAddForm((p) => ({ ...p, driveUrl: e.target.value }))}
                  required
                  placeholder="https://drive.google.com/…"
                  className={inputCls}
                />
              </label>
              <button
                type="submit"
                disabled={addBusy}
                className="min-h-10 w-full rounded-md bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
              >
                {addBusy ? '建立中…' : '建立任務'}
              </button>
              {addDone && (
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  已建立！零件編號 <span className="font-mono">{addDone}</span>（已進任務池）
                </p>
              )}
            </>
          )}
        </form>
      )}

      {/* ===== 匯入 BOM ===== */}
      {view === 'import' && noSubsystems ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          尚未建立機器人子系統。請先到網站的「機器人」頁建立機器人與子系統，再回來匯入。
        </div>
      ) : view === 'import' ? (
        <div className="mt-3 space-y-2">
          {/* 匯入模式：全部匯入 / 單獨匯入 */}
          <div className="flex gap-1.5">
            {(
              [
                { key: 'all', label: '全部匯入', hint: '同步整個 Assembly' },
                { key: 'selective', label: '單獨匯入', hint: '只勾選要更新的零件' },
              ] as { key: 'all' | 'selective'; label: string; hint: string }[]
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setImportMode(m.key)}
                className={`min-h-11 flex-1 rounded-md px-2 text-xs font-semibold ${
                  importMode === m.key
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-600'
                }`}
              >
                {m.label}
                <span className="mt-0.5 block text-[10px] font-normal opacity-70">{m.hint}</span>
              </button>
            ))}
          </div>
          {selectiveMode && (
            <p className="rounded-md bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-800">
              先「預覽」載入零件清單，勾選要更新／新增的零件後匯入。未勾選的零件完全不會被更動。
            </p>
          )}
          <label className="block text-xs font-medium text-slate-700">
            機器人子系統 *
            <select value={subsystemId} onChange={(e) => setSubsystemId(e.target.value)} className={inputCls}>
              <option value="">選擇</option>
              {subsystemOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-slate-700">
              預設加工方式
              <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={inputCls}>
                <option value="">逐件選</option>
                {methods.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">
              預設材料
              <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={inputCls}>
                <option value="">由 BOM</option>
                {materials.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-700">
            預設後處理（逐件可覆寫）
            <select value={postProcessId} onChange={(e) => setPostProcessId(e.target.value)} className={inputCls}>
              <option value="">無</option>
              {postProcesses.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {error && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          <p>{error}</p>
          <button type="button" onClick={reconnectOnshape} className="shrink-0 font-semibold underline">
            重新連結
          </button>
        </div>
      )}

      {view === 'import' && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={previewBom}
            disabled={busy !== null || noSubsystems}
            className="min-h-10 flex-1 rounded-md bg-slate-900 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === 'preview' ? '讀取中…' : '預覽'}
          </button>
          <button
            onClick={importBom}
            disabled={busy !== null || !preview || noSubsystems}
            className="min-h-10 flex-1 rounded-md bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === 'import' ? '匯入中…' : `匯入 ${importTargets.length} 件`}
          </button>
        </div>
      )}

      {view === 'import' && preview && (
        <section className="mt-3 space-y-2">
          {selectiveMode ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                已勾選 {importTargets.length} / {liveMade.length} 個加工件
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setAllSelected(true)}
                  className="min-h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-600"
                >
                  全選
                </button>
                <button
                  type="button"
                  onClick={() => setAllSelected(false)}
                  className="min-h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-600"
                >
                  全不選
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">
              加工 {liveMade.length} · COTS {liveCots.length} · 跳過 {liveSkip.length} · 總列 {allRows.length}
              ——逐件可切換分類與加工方式/材料/後處理
            </p>
          )}

          {(selectiveMode ? liveMade : allRows).map((row) => {
            const e = edits[row.rowKey];
            if (!e) return null;
            const isMade = e.classification === 'made';
            const isChecked = Boolean(selected[row.rowKey]);
            const showDetails = isMade && (!selectiveMode || isChecked);
            const border = selectiveMode
              ? isChecked
                ? 'border-l-slate-900'
                : 'border-l-slate-200'
              : e.classification === 'made'
                ? 'border-l-slate-900'
                : e.classification === 'cots'
                  ? 'border-l-amber-500'
                  : 'border-l-slate-300';
            return (
              <div key={row.rowKey} className={`rounded-lg border border-slate-200 border-l-4 ${border} bg-white p-2`}>
                <div className="flex items-start justify-between gap-1.5">
                  {selectiveMode ? (
                    <label className="flex min-w-0 flex-1 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelected(row.rowKey)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-slate-900">{row.name ?? '未命名'}</span>
                        <span className="block text-[10px] text-slate-500">x{row.quantity || 0} · {row.material ?? '無材料'}</span>
                      </span>
                    </label>
                  ) : (
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-900">{row.name ?? '未命名'}</p>
                      <p className="text-[10px] text-slate-500">
                        x{row.quantity || 0} · {row.material ?? '無材料'}
                      </p>
                    </div>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    {!selectiveMode && (
                      <div className="flex w-32 gap-1">
                        <button onClick={() => setEdit(row.rowKey, { classification: 'made' })} className={clsBtn(isMade, 'bg-slate-900 text-white')}>加工</button>
                        <button onClick={() => setEdit(row.rowKey, { classification: 'cots' })} className={clsBtn(e.classification === 'cots', 'bg-amber-500 text-white')}>COTS</button>
                        <button onClick={() => setEdit(row.rowKey, { classification: 'skip' })} className={clsBtn(e.classification === 'skip', 'bg-slate-400 text-white')}>跳過</button>
                      </div>
                    )}
                    {showDetails && (
                      <button
                        type="button"
                        onClick={() => setEdit(row.rowKey, { isUrgent: !e.isUrgent })}
                        title="標記急件"
                        className={`min-h-8 w-8 rounded-md text-[11px] font-bold ${
                          e.isUrgent ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        急
                      </button>
                    )}
                  </div>
                </div>

                <RowThumb row={row} osRef={ref} />

                {showDetails && (
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    <select
                      value={e.methodId}
                      onChange={(ev) => setEdit(row.rowKey, { methodId: ev.target.value })}
                      className={cellCls}
                      title="加工方式"
                    >
                      <option value="">{methodId ? '(預設)' : '方式*'}</option>
                      {methods.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                    <select
                      value={e.materialId}
                      onChange={(ev) => setEdit(row.rowKey, { materialId: ev.target.value })}
                      className={cellCls}
                      title="材料"
                    >
                      <option value="">{materialId ? '(預設)' : '依BOM'}</option>
                      {materials.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={e.quantity}
                      onChange={(ev) => setEdit(row.rowKey, { quantity: ev.target.value })}
                      className={cellCls}
                      title="數量"
                    />
                  </div>
                )}

                {showDetails && (
                  <select
                    value={e.postProcessId}
                    onChange={(ev) => setEdit(row.rowKey, { postProcessId: ev.target.value })}
                    className={`${cellCls} mt-1.5`}
                    title="後處理"
                  >
                    <option value="">{postProcessId ? '後處理：(預設)' : '後處理：無'}</option>
                    {postProcesses.map((o) => (
                      <option key={o.id} value={o.id}>後處理：{o.label}</option>
                    ))}
                  </select>
                )}

                {showDetails && isAdmin && (
                  <select
                    value={e.assigneeId}
                    onChange={(ev) => setEdit(row.rowKey, { assigneeId: ev.target.value })}
                    className={`${cellCls} mt-1.5`}
                    title="指派給（管理員限定）"
                  >
                    <option value="">不指派（進任務池）</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>指派：{m.username}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </section>
      )}

      {view === 'import' && result && (
        <section className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-900">匯入完成</p>
          <p className="mt-1 text-xs text-emerald-800">
            新增 {result.created}，更新 {result.updated}
            {result.revisioned ? `，開新版本 ${result.revisioned}` : ''}，COTS {result.cotsCount}
            {result.skippedCount ? `，跳過 ${result.skippedCount}` : ''}
          </p>
          {result.revisioned ? (
            <p className="mt-1 text-[11px] text-emerald-700">
              有 {result.revisioned} 個已加工/完成的零件已自動建立新版本（Rev+1），舊版封存保留。
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}
