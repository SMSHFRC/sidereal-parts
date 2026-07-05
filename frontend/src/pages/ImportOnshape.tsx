import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  FALLBACK_MATERIAL_OPTIONS,
  FALLBACK_METHOD_OPTIONS,
  FALLBACK_POST_PROCESS_OPTIONS,
  FALLBACK_SYSTEM_OPTIONS,
  fetchOnshapeThumbnail,
  metaApi,
  onshapeApi,
  toSelectOptions,
  type OnshapeImportPreview,
  type OnshapeImportResult,
} from '../api';
import { ErrorBox, Spinner } from '../ui';

const inputCls =
  'mt-1 w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900';

type SelectOption = { id: number; label: string };

function BomList({ title, items }: { title: string; items: OnshapeImportPreview['made'] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-slate-900">
        {title} <span className="text-slate-500">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">沒有項目</p>
      ) : (
        <div className="mt-2 max-h-72 divide-y divide-slate-100 overflow-auto">
          {items.map((item, idx) => (
            <div key={`${item.sourcePartId ?? item.partNumber ?? idx}`} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{item.name ?? '未命名零件'}</p>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  x{item.quantity || 0}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {item.partNumber ?? '無料號'} · {item.material ?? '無材料'}
              </p>
              {item.cotsReason && (
                <p className="mt-0.5 text-xs text-amber-700">分流原因：{item.cotsReason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ImportOnshape() {
  const [systems, setSystems] = useState<SelectOption[]>(FALLBACK_SYSTEM_OPTIONS);
  const [methods, setMethods] = useState<SelectOption[]>(FALLBACK_METHOD_OPTIONS);
  const [materials, setMaterials] = useState<SelectOption[]>(FALLBACK_MATERIAL_OPTIONS);
  const [postProcesses, setPostProcesses] = useState<SelectOption[]>(FALLBACK_POST_PROCESS_OPTIONS);
  const [url, setUrl] = useState('');
  const [systemId, setSystemId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [postProcessId, setPostProcessId] = useState('');
  const [preview, setPreview] = useState<OnshapeImportPreview | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [result, setResult] = useState<OnshapeImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState('');

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
    if (!systemId || !methodId) {
      setError('請先選擇系統與加工方式');
      return;
    }
    if (!window.confirm(`確定匯入 ${preview.summary.madeCount} 筆自製件成任務？`)) return;
    setError('');
    setBusy('import');
    try {
      setResult(
        await onshapeApi.importBom({
          url: url.trim(),
          systemId: Number(systemId),
          manufacturingMethodId: Number(methodId),
          ...(materialId ? { materialId: Number(materialId) } : {}),
          ...(postProcessId ? { postProcessId: Number(postProcessId) } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '匯入失敗');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/" className="text-sm text-slate-500 active:text-slate-900">
        ← 返回看板
      </Link>
      <h1 className="mt-2 text-lg font-bold text-slate-900">Onshape BOM 匯入</h1>

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
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="block text-sm font-medium text-slate-700">
            系統 *
            <select value={systemId} onChange={(e) => setSystemId(e.target.value)} className={inputCls}>
              <option value="">請選擇</option>
              {systems.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            加工方式 *
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={inputCls}>
              <option value="">請選擇</option>
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
            後處理
            <select value={postProcessId} onChange={(e) => setPostProcessId(e.target.value)} className={inputCls}>
              <option value="">無</option>
              {postProcesses.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={busy !== null}
          className="mt-4 min-h-11 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white active:bg-slate-700 disabled:opacity-50"
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
                  自製件 {preview.summary.madeCount} · COTS {preview.summary.cotsCount} · 總列數 {preview.summary.total}
                </p>
              </div>
              <button
                onClick={importBom}
                disabled={busy !== null || preview.summary.madeCount === 0}
                className="md:ml-auto min-h-11 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
              >
                {busy === 'import' ? '匯入中…' : '匯入成任務'}
              </button>
            </div>
          </section>

          {result && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <h2 className="text-sm font-semibold text-emerald-900">匯入完成</h2>
              <p className="mt-1 text-sm text-emerald-800">
                新增 {result.created}，更新 {result.updated}，COTS {result.cotsCount}
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

          <div className="grid gap-4 md:grid-cols-2">
            <BomList title="自製件，將建立任務" items={preview.made} />
            <BomList title="COTS / 採購件，僅記錄" items={preview.cots} />
          </div>
        </div>
      )}
    </div>
  );
}
