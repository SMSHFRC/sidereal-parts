import { useEffect, useMemo, useState } from 'react';
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

const inputCls =
  'mt-1 w-full min-h-10 rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-900';

type SelectOption = { id: number; label: string };

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

function Summary({ preview }: { preview: OnshapeImportPreview }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <div className="rounded-md bg-slate-100 px-2 py-2 text-center">
        <p className="text-lg font-bold text-slate-900">{preview.summary.madeCount}</p>
        <p className="text-[11px] text-slate-500">自製</p>
      </div>
      <div className="rounded-md bg-slate-100 px-2 py-2 text-center">
        <p className="text-lg font-bold text-slate-900">{preview.summary.cotsCount}</p>
        <p className="text-[11px] text-slate-500">COTS</p>
      </div>
      <div className="rounded-md bg-amber-50 px-2 py-2 text-center">
        <p className="text-lg font-bold text-amber-800">{preview.summary.unknownCount ?? preview.unknown?.length ?? 0}</p>
        <p className="text-[11px] text-amber-700">Check</p>
      </div>
      <div className="rounded-md bg-slate-100 px-2 py-2 text-center">
        <p className="text-lg font-bold text-slate-900">{preview.summary.total}</p>
        <p className="text-[11px] text-slate-500">總列</p>
      </div>
    </div>
  );
}

export default function OnshapePanel() {
  const ref = useMemo(readPanelRef, []);
  const url = ref ? makeOnshapeUrl(ref) : '';
  const [systems, setSystems] = useState<SelectOption[]>(FALLBACK_SYSTEM_OPTIONS);
  const [methods, setMethods] = useState<SelectOption[]>(FALLBACK_METHOD_OPTIONS);
  const [materials, setMaterials] = useState<SelectOption[]>(FALLBACK_MATERIAL_OPTIONS);
  const [postProcesses, setPostProcesses] = useState<SelectOption[]>(FALLBACK_POST_PROCESS_OPTIONS);
  const [systemId, setSystemId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [postProcessId, setPostProcessId] = useState('');
  const [preview, setPreview] = useState<OnshapeImportPreview | null>(null);
  const [result, setResult] = useState<OnshapeImportResult | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
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
    if (!systemId || !methodId) {
      setError('請選擇系統與加工方式');
      return;
    }
    setError('');
    setBusy('import');
    try {
      setResult(
        await onshapeApi.importBom({
          url,
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
      <header className="flex items-center gap-2">
        <img src="/logo.png" alt="FRC 9501" className="h-8 w-8 rounded-md" />
        <div>
          <h1 className="text-sm font-bold">sidereal-parts</h1>
          <p className="text-xs text-slate-500">Onshape 匯入</p>
        </div>
      </header>

      {thumb && (
        <img
          src={thumb}
          alt="Onshape thumbnail"
          className="mt-3 h-28 w-full rounded-lg border border-slate-200 bg-white object-contain"
        />
      )}

      <div className="mt-3 space-y-2">
        <label className="block text-xs font-medium text-slate-700">
          系統
          <select value={systemId} onChange={(e) => setSystemId(e.target.value)} className={inputCls}>
            <option value="">選擇</option>
            {systems.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-700">
          加工方式
          <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={inputCls}>
            <option value="">選擇</option>
            {methods.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-slate-700">
            材料
            <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={inputCls}>
              <option value="">BOM</option>
              {materials.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-700">
            後處理
            <select value={postProcessId} onChange={(e) => setPostProcessId(e.target.value)} className={inputCls}>
              <option value="">無</option>
              {postProcesses.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={previewBom}
          disabled={busy !== null}
          className="min-h-10 flex-1 rounded-md bg-slate-900 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === 'preview' ? '讀取中…' : '預覽'}
        </button>
        <button
          onClick={importBom}
          disabled={busy !== null || !preview}
          className="min-h-10 flex-1 rounded-md bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === 'import' ? '匯入中…' : '匯入'}
        </button>
      </div>

      {preview && (
        <section className="mt-3 space-y-3">
          <Summary preview={preview} />
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              自製件
            </div>
            <div className="max-h-44 divide-y divide-slate-100 overflow-auto">
              {preview.made.slice(0, 20).map((item, idx) => (
                <div key={`${item.sourcePartId ?? idx}`} className="px-3 py-2">
                  <p className="truncate text-xs font-medium">{item.name ?? '未命名'}</p>
                  <p className="text-[11px] text-slate-500">x{item.quantity || 0} · {item.material ?? '無材料'}</p>
                </div>
              ))}
            </div>
          </div>
          {(preview.unknown?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50">
              <div className="border-b border-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">
                Needs review
              </div>
              <div className="max-h-36 divide-y divide-amber-100 overflow-auto">
                {preview.unknown.slice(0, 20).map((item, idx) => (
                  <div key={`${item.sourcePartId ?? item.partNumber ?? idx}`} className="px-3 py-2">
                    <p className="truncate text-xs font-medium text-amber-950">{item.name ?? 'Unnamed part'}</p>
                    <p className="text-[11px] text-amber-800">
                      {item.partNumber ?? 'No part number'} · {item.classificationReason ?? 'unknown'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-900">匯入完成</p>
          <p className="mt-1 text-xs text-emerald-800">
            新增 {result.created}，更新 {result.updated}，COTS {result.cotsCount}
          </p>
        </section>
      )}
    </main>
  );
}
