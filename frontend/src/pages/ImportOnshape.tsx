import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  FALLBACK_MATERIAL_OPTIONS,
  FALLBACK_METHOD_OPTIONS,
  FALLBACK_POST_PROCESS_OPTIONS,
  FALLBACK_SYSTEM_OPTIONS,
  fetchOnshapePartThumbnail,
  fetchOnshapeThumbnail,
  metaApi,
  onshapeApi,
  robotApi,
  toSelectOptions,
  type OnshapeBomItem,
  type OnshapeImportItem,
  type OnshapeImportPreview,
  type OnshapeRef,
  type OnshapeImportResult,
  type RobotSubsystem,
} from '../api';
import { ErrorBox, Spinner } from '../ui';

// 逐件縮圖：捲到才載入（避免一次對 Onshape 發數十個算圖請求）
function PartThumb({ row, osRef }: { row: OnshapeBomItem; osRef: OnshapeRef }) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'wait' | 'loading' | 'ok' | 'none'>('wait');
  const boxRef = useRef<HTMLDivElement>(null);
  // 僅同文件、且有 element + partId 的零件可算圖
  const canLoad =
    Boolean(row.sourcePartId && row.sourceElementId) &&
    (!row.sourceDocumentId || row.sourceDocumentId === osRef.did);

  useEffect(() => {
    if (!canLoad || !boxRef.current) {
      setState('none');
      return;
    }
    let objectUrl: string | null = null;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || done) return;
        done = true;
        io.disconnect();
        setState('loading');
        fetchOnshapePartThumbnail({
          did: osRef.did,
          wvm: osRef.wvm,
          wvmId: osRef.wvmId,
          eid: row.sourceElementId!,
          partId: row.sourcePartId!,
        })
          .then((u) => {
            if (u) {
              objectUrl = u;
              setSrc(u);
              setState('ok');
            } else setState('none');
          })
          .catch(() => setState('none'));
      },
      { rootMargin: '300px' },
    );
    io.observe(boxRef.current);
    return () => {
      io.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [canLoad, osRef, row]);

  return (
    <div
      ref={boxRef}
      className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50"
    >
      {state === 'ok' && src ? (
        <img src={src} alt="" className="h-full w-full object-contain" />
      ) : state === 'loading' ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
      ) : (
        <span className="text-[9px] text-slate-300">無圖</span>
      )}
    </div>
  );
}

const inputCls =
  'mt-1 w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900';
const cellCls =
  'w-full min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900';

type SelectOption = { id: number; label: string };
type Cls = 'made' | 'cots' | 'skip';
type Edit = { classification: Cls; methodId: string; materialId: string; postProcessId: string; quantity: string };

export default function ImportOnshape() {
  const [searchParams] = useSearchParams();
  const robotId = searchParams.get('robotId') ?? '';
  const subsystemId = searchParams.get('subsystemId') ?? '';
  const [systems, setSystems] = useState<SelectOption[]>(FALLBACK_SYSTEM_OPTIONS);
  const [methods, setMethods] = useState<SelectOption[]>(FALLBACK_METHOD_OPTIONS);
  const [materials, setMaterials] = useState<SelectOption[]>(FALLBACK_MATERIAL_OPTIONS);
  const [postProcesses, setPostProcesses] = useState<SelectOption[]>(FALLBACK_POST_PROCESS_OPTIONS);
  const [url, setUrl] = useState('');
  const [systemId, setSystemId] = useState('');
  const [methodId, setMethodId] = useState(''); // 全域「預設加工方式」
  const [materialId, setMaterialId] = useState('');
  const [postProcessId, setPostProcessId] = useState('');
  const [preview, setPreview] = useState<OnshapeImportPreview | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [thumb, setThumb] = useState<string | null>(null);
  const [result, setResult] = useState<OnshapeImportResult | null>(null);
  const [subsystem, setSubsystem] = useState<RobotSubsystem | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState('');
  const importingToSubsystem = Boolean(subsystemId);

  useEffect(() => {
    metaApi
      .options()
      .then((options) => {
        setSystems(toSelectOptions(options.systems));
        setMethods(toSelectOptions(options.methods));
        setMaterials(toSelectOptions(options.materials));
        setPostProcesses(toSelectOptions(options.postProcesses));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!subsystemId) return;
    robotApi
      .getSubsystem(subsystemId)
      .then((sub) => {
        setSubsystem(sub);
        if (sub.system?.id) setSystemId(String(sub.system.id));
      })
      .catch(() => setSubsystem(null));
  }, [subsystemId]);

  // 所有 BOM 列（合併三類，逐件可編輯）
  const allRows: OnshapeBomItem[] = useMemo(
    () => (preview ? [...preview.made, ...preview.cots, ...preview.unknown] : []),
    [preview],
  );

  // 預覽載入後初始化每列編輯狀態
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
      };
    }
    setEdits(init);
  }, [preview, allRows]);

  useEffect(() => {
    if (!preview?.ref.eid) return;
    let objectUrl: string | null = null;
    fetchOnshapeThumbnail({
      did: preview.ref.did,
      wvm: preview.ref.wvm,
      wvmId: preview.ref.wvmId,
      eid: preview.ref.eid,
    })
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
  }, [preview]);

  const setEdit = (rowKey: string, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [rowKey]: { ...prev[rowKey], ...patch } }));

  const liveMade = allRows.filter((r) => edits[r.rowKey]?.classification === 'made');
  const liveCots = allRows.filter((r) => edits[r.rowKey]?.classification === 'cots');
  const liveSkip = allRows.filter((r) => edits[r.rowKey]?.classification === 'skip');

  const previewBom = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setPreview(null);
    setThumb(null);
    setBusy('preview');
    try {
      setPreview(await onshapeApi.importPreview(url.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'BOM 預覽失敗');
    } finally {
      setBusy(null);
    }
  };

  const importBom = async () => {
    if (!preview) return;
    if (!importingToSubsystem && !systemId) {
      setError('請選擇系統');
      return;
    }
    if (liveMade.length === 0) {
      setError('沒有自製件可匯入');
      return;
    }
    // 每個自製件都要有加工方式（逐件或全域預設）
    const noMethod = liveMade.filter((r) => !(edits[r.rowKey].methodId || methodId));
    if (noMethod.length > 0) {
      setError(`有 ${noMethod.length} 個自製件未選加工方式（設全域預設，或逐件選擇）`);
      return;
    }
    if (!window.confirm(`確定匯入 ${liveMade.length} 筆自製件成任務？COTS ${liveCots.length} 筆僅記錄。`)) return;

    const items: OnshapeImportItem[] = allRows.map((row) => {
      const e = edits[row.rowKey];
      if (e.classification !== 'made') return { rowKey: row.rowKey, classification: e.classification };
      return {
        rowKey: row.rowKey,
        classification: 'made',
        manufacturingMethodId: Number(e.methodId || methodId),
        materialId: e.materialId ? Number(e.materialId) : null, // null = 依 BOM 材料自動對應
        postProcessId: e.postProcessId ? Number(e.postProcessId) : null,
        quantity: Number(e.quantity) || 1,
      };
    });

    setError('');
    setBusy('import');
    try {
      setResult(
        await onshapeApi.importBom({
          url: url.trim(),
          ...(systemId ? { systemId: Number(systemId) } : {}),
          ...(robotId ? { robotId } : {}),
          ...(subsystemId ? { subsystemId } : {}),
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

  const clsBtn = (active: boolean, color: string) =>
    `min-h-8 flex-1 rounded-md px-2 text-xs font-semibold ${
      active ? color : 'bg-slate-100 text-slate-500'
    }`;

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/" className="text-sm text-slate-500 active:text-slate-900">
        ← 返回看板
      </Link>
      <h1 className="mt-2 text-lg font-bold text-slate-900">Onshape BOM 匯入</h1>
      {subsystem && (
        <p className="mt-1 text-sm text-slate-500">
          匯入到 {subsystem.robot?.name} / {subsystem.name}
        </p>
      )}

      <form onSubmit={previewBom} className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">
          Assembly URL
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://cad.onshape.com/documents/.../w/.../e/..."
            className={inputCls}
          />
        </label>
        <div className={`mt-3 grid gap-3 ${importingToSubsystem ? 'md:grid-cols-3' : 'md:grid-cols-4'}`}>
          {!importingToSubsystem && (
            <label className="block text-sm font-medium text-slate-700">
              系統 *
              <select value={systemId} onChange={(e) => setSystemId(e.target.value)} className={inputCls}>
                <option value="">請選擇</option>
                {systems.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium text-slate-700">
            預設加工方式
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={inputCls}>
              <option value="">逐件選</option>
              {methods.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            預設材料
            <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={inputCls}>
              <option value="">由 BOM 判斷</option>
              {materials.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            預設後處理
            <select value={postProcessId} onChange={(e) => setPostProcessId(e.target.value)} className={inputCls}>
              <option value="">無</option>
              {postProcesses.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          預設值會套用到未逐件指定的項目；預覽後可逐件覆寫分類、加工方式、材料、後處理、數量。
        </p>
        <button
          type="submit"
          disabled={busy !== null}
          className="mt-3 min-h-11 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white active:bg-slate-700 disabled:opacity-50"
        >
          {busy === 'preview' ? '讀取 BOM 中…' : '預覽 BOM'}
        </button>
      </form>

      {error && <ErrorBox message={error} />}
      {busy === 'import' && <Spinner label="正在建立任務…" />}

      {preview && (
        <div className="mt-4 space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              {thumb && <img src={thumb} alt="Onshape thumbnail" className="h-28 w-48 rounded-lg border object-contain" />}
              <div>
                <h2 className="font-semibold text-slate-900">{preview.documentName}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  自製 {liveMade.length} · COTS {liveCots.length} · 略過 {liveSkip.length} · 總列 {allRows.length}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">可逐件調整下方分類與設定後再匯入</p>
              </div>
              <button
                onClick={importBom}
                disabled={busy !== null || liveMade.length === 0}
                className="md:ml-auto min-h-11 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
              >
                {busy === 'import' ? '匯入中…' : `匯入 ${liveMade.length} 筆自製件`}
              </button>
            </div>
          </section>

          {result && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <h2 className="text-sm font-semibold text-emerald-900">匯入完成</h2>
              <p className="mt-1 text-sm text-emerald-800">
                新增 {result.created}，更新 {result.updated}，COTS {result.cotsCount}
                {result.skippedCount ? `，跳過 ${result.skippedCount}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {result.tasks.map((task) => (
                  <Link
                    key={task.id}
                    to={`/tasks/${task.id}`}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 shadow-sm"
                  >
                    {task.partNumber}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 逐件編輯清單 */}
          <section className="space-y-2">
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
                <div
                  key={row.rowKey}
                  className={`rounded-lg border border-slate-200 border-l-4 ${border} bg-white p-3`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 gap-2">
                      <PartThumb row={row} osRef={preview.ref} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{row.name ?? '未命名零件'}</p>
                        <p className="text-xs text-slate-500">
                          {row.partNumber ?? '無料號'} · BOM 材料：{row.material ?? '無'}
                          {row.classificationReason ? ` · 判定：${row.classificationReason}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex w-40 shrink-0 gap-1">
                      <button onClick={() => setEdit(row.rowKey, { classification: 'made' })} className={clsBtn(e.classification === 'made', 'bg-slate-900 text-white')}>自製</button>
                      <button onClick={() => setEdit(row.rowKey, { classification: 'cots' })} className={clsBtn(e.classification === 'cots', 'bg-amber-500 text-white')}>COTS</button>
                      <button onClick={() => setEdit(row.rowKey, { classification: 'skip' })} className={clsBtn(e.classification === 'skip', 'bg-slate-400 text-white')}>略過</button>
                    </div>
                  </div>

                  {isMade && (
                    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                      <label className="text-[11px] text-slate-500">
                        加工方式
                        <select value={e.methodId} onChange={(ev) => setEdit(row.rowKey, { methodId: ev.target.value })} className={cellCls}>
                          <option value="">{methodId ? '（用預設）' : '選擇'}</option>
                          {methods.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        材料
                        <select value={e.materialId} onChange={(ev) => setEdit(row.rowKey, { materialId: ev.target.value })} className={cellCls}>
                          <option value="">依 BOM</option>
                          {materials.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        後處理
                        <select value={e.postProcessId} onChange={(ev) => setEdit(row.rowKey, { postProcessId: ev.target.value })} className={cellCls}>
                          <option value="">無</option>
                          {postProcesses.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        數量
                        <input
                          type="number"
                          min={1}
                          value={e.quantity}
                          onChange={(ev) => setEdit(row.rowKey, { quantity: ev.target.value })}
                          className={cellCls}
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
