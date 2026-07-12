import { useEffect, useState } from 'react';
import {
  fetchOnshapePartThumbnail,
  fetchOnshapeThumbnail,
  onshapeApi,
  type Task,
  type TaskDownloadSpec,
} from '../api';

export function OnshapeConnectButton() {
  const [state, setState] = useState<'hidden' | 'connected' | 'disconnected'>('hidden');
  const [flash, setFlash] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = q.get('onshape');
    if (r) {
      setFlash(r === 'connected' ? 'Onshape 已連結' : 'Onshape 連結失敗，請再試一次');
      q.delete('onshape');
      const rest = q.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
      window.setTimeout(() => setFlash(''), 4000);
    }
    onshapeApi
      .status()
      .then((s) => setState(!s.enabled ? 'hidden' : s.connected ? 'connected' : 'disconnected'))
      .catch(() => setState('hidden'));
  }, []);

  const connect = async () => {
    const { url } = await onshapeApi.authUrl();
    window.location.href = url;
  };

  const disconnect = async () => {
    if (!window.confirm('要解除 Onshape 連結嗎？之後可再重新連結。')) return;
    await onshapeApi.disconnect();
    setState('disconnected');
  };

  return (
    <>
      {flash && (
        <div className="fixed inset-x-4 top-4 z-30 rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-medium text-white shadow-lg">
          {flash}
        </div>
      )}
      {state === 'disconnected' && (
        <button
          onClick={connect}
          className="min-h-9 rounded-lg border border-emerald-600 px-3 text-xs font-semibold text-emerald-700 active:bg-emerald-50"
        >
          Onshape
        </button>
      )}
      {state === 'connected' && (
        <button
          onClick={disconnect}
          title="解除 Onshape 連結"
          className="min-h-9 rounded-lg bg-emerald-100 px-3 text-xs font-semibold text-emerald-800 active:bg-emerald-200"
        >
          已連結
        </button>
      )}
    </>
  );
}

export function OnshapeCard({
  task,
  download,
  downloading = false,
  onDownload,
}: {
  task: Task;
  download?: TaskDownloadSpec | null;
  downloading?: boolean;
  onDownload?: () => void;
}) {
  const { onshapeDid, onshapeWvm, onshapeWvmId, onshapeEid } = task;
  const [thumb, setThumb] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'not_connected' | 'error'>('loading');

  const onshapePartId = task.onshapePartId;
  useEffect(() => {
    if (!onshapeDid || !onshapeWvm || !onshapeWvmId || !onshapeEid) return;
    let url: string | null = null;
    let alive = true;
    // 匯入的零件有 partId → 顯示該零件的圖；否則顯示 element（整組）縮圖
    (async () => {
      if (onshapePartId) {
        const p = await fetchOnshapePartThumbnail({
          did: onshapeDid,
          wvm: onshapeWvm,
          wvmId: onshapeWvmId,
          eid: onshapeEid,
          partId: onshapePartId,
        });
        if (p) return { url: p, notConnected: false };
      }
      const e = await fetchOnshapeThumbnail({ did: onshapeDid, wvm: onshapeWvm, wvmId: onshapeWvmId, eid: onshapeEid });
      return { url: e, notConnected: e === null };
    })()
      .then(({ url: u, notConnected }) => {
        if (!alive) return;
        if (notConnected) setState('not_connected');
        else if (u) {
          url = u;
          setThumb(u);
          setState('ok');
        } else setState('error');
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [onshapeDid, onshapeWvm, onshapeWvmId, onshapeEid, onshapePartId]);

  if (!onshapeDid || !onshapeEid) return null;
  const connect = async () => {
    const { url } = await onshapeApi.authUrl();
    window.location.href = url;
  };
  const openOnshapeUrl = task.onshapePartStudioUrl ?? task.drawingUrl;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-600">Onshape 零件</span>
        <div className="flex items-center gap-3">
          {download && onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              className="min-h-8 rounded-md bg-slate-900 px-2.5 text-xs font-semibold text-white active:bg-slate-700 disabled:opacity-50"
            >
              {downloading ? '準備檔案中...' : `下載 ${download.label}`}
            </button>
          )}
          {openOnshapeUrl && (
            <a
              href={openOnshapeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-emerald-700 active:text-emerald-900"
            >
              {task.onshapePartStudioUrl ? '開啟 Part Studio' : '開啟 Onshape'}
            </a>
          )}
        </div>
      </div>

      {state === 'loading' && (
        <div className="flex h-40 items-center justify-center bg-white">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        </div>
      )}
      {state === 'ok' && thumb && (
        <img src={thumb} alt="零件縮圖" className="mx-auto h-40 w-auto bg-white object-contain" />
      )}
      {state === 'not_connected' && (
        <div className="flex flex-col items-center gap-2 bg-white py-6">
          <p className="text-xs text-slate-500">連結 Onshape 後可顯示零件縮圖。</p>
          <button
            onClick={connect}
            className="min-h-9 rounded-lg border border-emerald-600 px-3 text-xs font-medium text-emerald-700 active:bg-emerald-50"
          >
            連結 Onshape
          </button>
        </div>
      )}
      {state === 'error' && (
        <p className="bg-white py-6 text-center text-xs text-slate-400">縮圖暫時無法載入。</p>
      )}
    </div>
  );
}
