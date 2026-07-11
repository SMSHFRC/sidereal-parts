// Onshape 內嵌面板（M4）：繪圖者在 Onshape 右側直接匯入 BOM。
// 流程：選機器人子系統（必須先在網站建立）→ 預覽 → 逐件調整
// （加工/COTS/跳過、每件獨立的加工方式與材料）→ 匯入。
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  FALLBACK_MATERIAL_OPTIONS,
  FALLBACK_METHOD_OPTIONS,
  FALLBACK_POST_PROCESS_OPTIONS,
  fetchOnshapeThumbnail,
  metaApi,
  onshapeApi,
  robotApi,
  toSelectOptions,
  type OnshapeBomItem,
  type OnshapeImportItem,
  type OnshapeImportPreview,
  type OnshapeImportResult,
  type Robot,
} from '../api';

const inputCls =
  'mt-1 w-full min-h-10 rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-900';
const cellCls =
  'w-full min-h-9 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-slate-900';

type SelectOption = { id: number; label: string };
type Cls = 'made' | 'cots' | 'skip';
type Edit = { classification: Cls; methodId: string; materialId: string; quantity: string };

function readPanelRef() {
  const q = new URLSearchParams(window.location.search);
  const did = q.get('did') ?? q.get('documentId');
  const eid = q.get('eid') ?? q.get('elementId');
  const wvm =
    q.get('wvm') ??
    (q.get('workspaceId') ? 'w' : q.get('versionId') ? 'v' : q.get('microversionId') ? 'm' : null);
  const wvmId =
    q.get('wvmId') ??
    q.get('wvmid') ??
    q.get('workspaceId') ??
    q.get('versionId') ??
    q.get('microversionId');
  if (!did || !wvm || !wvmId || !eid) return null;
  return { did, wvm, wvmId, eid };
}

function makeOnshapeUrl(ref: NonNullable<ReturnType<typeof readPanelRef>>) {
  return `https://cad.onshape.com/documents/${ref.did}/${ref.wvm}/${ref.wvmId}/e/${ref.eid}`;
}

export default function OnshapePanel() {
  const ref = useMemo(readPanelRef, []);
  const url = ref ? makeOnshapeUrl(ref) : '';
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
        quantity: String(row.quantity || 1),
      };
    }
    setEdits(init);
  }, [preview, allRows]);

  const setEdit = (rowKey: string, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], ...patch } }));

  const liveMade = allRows.filter((r) => edits[r.rowKey]?.classification === 'made');
  const liveCots = allRows.filter((r) => edits[r.rowKey]?.classification === 'cots');
  const liveSkip = allRows.filter((r) => edits[r.rowKey]?.classification === 'skip');

  const subsystemOptions = (robots ?? []).flatMap((robot) =>
    robot.subsystems.map((sub) => ({ id: sub.id, label: `${robot.name} / ${sub.name}` })),
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
    if (liveMade.length === 0) {
      setError('沒有要加工的零件');
      return;
    }
    const noMethod = liveMade.filter((r) => !(edits[r.rowKey].methodId || methodId));
    if (noMethod.length > 0) {
      setError(`有 ${noMethod.length} 個加工件未選加工方式（設預設或逐件選）`);
      return;
    }
    setError('');
    setBusy('import');
    try {
      const items: OnshapeImportItem[] = allRows.map((row) => {
        const e = edits[row.rowKey];
        if (e.classification !== 'made')
          return { rowKey: row.rowKey, classification: e.classification === 'skip' ? 'skip' : 'cots' };
        return {
          rowKey: row.rowKey,
          classification: 'made',
          manufacturingMethodId: Number(e.methodId || methodId),
          materialId: e.materialId ? Number(e.materialId) : materialId ? Number(materialId) : null,
          postProcessId: postProcessId ? Number(postProcessId) : null,
          quantity: Number(e.quantity) || 1,
        };
      });
      setResult(
        await onshapeApi.importBom({
          url,
          subsystemId,
          ...(methodId ? { manufacturingMethodId: Number(methodId) } : {}),
          items,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '匯入失敗');
    } finally {
      setBusy(null);
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
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          缺少 Onshape 文件參數
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

      {/* 必須先建立機器人子系統 */}
      {noSubsystems ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          尚未建立機器人子系統。請先到網站的「機器人」頁建立機器人與子系統，再回來匯入。
        </div>
      ) : (
        <div className="mt-3 space-y-2">
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
            後處理（套用到全部加工件）
            <select value={postProcessId} onChange={(e) => setPostProcessId(e.target.value)} className={inputCls}>
              <option value="">無</option>
              {postProcesses.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          <p>{error}</p>
          <button type="button" onClick={reconnectOnshape} className="shrink-0 font-semibold underline">
            重新連結
          </button>
        </div>
      )}

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
          {busy === 'import' ? '匯入中…' : `匯入 ${liveMade.length} 件`}
        </button>
      </div>

      {preview && (
        <section className="mt-3 space-y-2">
          <p className="text-[11px] text-slate-500">
            加工 {liveMade.length} · COTS {liveCots.length} · 跳過 {liveSkip.length} · 總列 {allRows.length}
            ——逐件可切換分類與加工方式/材料
          </p>

          {allRows.map((row) => {
            const e = edits[row.rowKey];
            if (!e) return null;
            const isMade = e.classification === 'made';
            const border =
              e.classification === 'made'
                ? 'border-l-slate-900'
                : e.classification === 'cots'
                  ? 'border-l-amber-500'
                  : 'border-l-slate-300';
            return (
              <div key={row.rowKey} className={`rounded-lg border border-slate-200 border-l-4 ${border} bg-white p-2`}>
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-900">{row.name ?? '未命名'}</p>
                    <p className="text-[10px] text-slate-500">
                      x{row.quantity || 0} · {row.material ?? '無材料'}
                    </p>
                  </div>
                  <div className="flex w-32 shrink-0 gap-1">
                    <button onClick={() => setEdit(row.rowKey, { classification: 'made' })} className={clsBtn(isMade, 'bg-slate-900 text-white')}>加工</button>
                    <button onClick={() => setEdit(row.rowKey, { classification: 'cots' })} className={clsBtn(e.classification === 'cots', 'bg-amber-500 text-white')}>COTS</button>
                    <button onClick={() => setEdit(row.rowKey, { classification: 'skip' })} className={clsBtn(e.classification === 'skip', 'bg-slate-400 text-white')}>跳過</button>
                  </div>
                </div>

                {isMade && (
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
              </div>
            );
          })}
        </section>
      )}

      {result && (
        <section className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-900">匯入完成</p>
          <p className="mt-1 text-xs text-emerald-800">
            新增 {result.created}，更新 {result.updated}，COTS {result.cotsCount}
            {result.skippedCount ? `，跳過 ${result.skippedCount}` : ''}
          </p>
        </section>
      )}
    </main>
  );
}
