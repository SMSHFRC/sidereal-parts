// M3 P2：Onshape 前端元件
// - OnshapeConnectButton：header 的連結/已連結狀態鈕（含 ?onshape=connected 回跳提示）
// - OnshapeCard：任務詳情頁的零件縮圖 + 文件預覽卡
import { useEffect, useState } from 'react';
import { fetchOnshapeThumbnail, onshapeApi, type Task } from '../api';

// ---------- header 連結按鈕 ----------
export function OnshapeConnectButton() {
  const [state, setState] = useState<'hidden' | 'connected' | 'disconnected'>('hidden');
  const [flash, setFlash] = useState('');

  useEffect(() => {
    // OAuth 回跳提示（?onshape=connected / error）
    const q = new URLSearchParams(window.location.search);
    const r = q.get('onshape');
    if (r) {
      setFlash(r === 'connected' ? 'Onshape 連結成功！' : 'Onshape 連結失敗，請再試一次');
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
    window.location.href = url; // 即產即用，state 不會過期
  };

  const disconnect = async () => {
    if (!window.confirm('解除 Onshape 連結？之後將無法載入縮圖與零件資料。')) return;
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
          className="min-h-9 rounded-lg border border-emerald-600 px-2.5 text-xs font-medium text-emerald-700 active:bg-emerald-50"
        >
          連結 Onshape
        </button>
      )}
      {state === 'connected' && (
        <button
          onClick={disconnect}
          title="已連結 Onshape（點擊解除）"
          className="min-h-9 rounded-lg bg-emerald-100 px-2.5 text-xs font-medium text-emerald-800 active:bg-emerald-200"
        >
          Onshape ✓
        </button>
      )}
    </>
  );
}

// ---------- 任務詳情：縮圖 + 預覽卡 ----------
export function OnshapeCard({ task }: { task: Task }) {
  const { onshapeDid, onshapeWvm, onshapeWvmId, onshapeEid } = task;
  const [thumb, setThumb] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'not_connected' | 'error'>('loading');

  useEffect(() => {
    if (!onshapeDid || !onshapeWvm || !onshapeWvmId || !onshapeEid) return;
    let url: string | null = null;
    let alive = true;
    fetchOnshapeThumbnail({ did: onshapeDid, wvm: onshapeWvm, wvmId: onshapeWvmId, eid: onshapeEid })
      .then((u) => {
        if (!alive) return;
        if (u === null) setState('not_connected');
        else {
          url = u;
          setThumb(u);
          setState('ok');
        }
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [onshapeDid, onshapeWvm, onshapeWvmId, onshapeEid]);

  if (!onshapeDid || !onshapeEid) return null; // 非 Onshape 任務不顯示

  const connect = async () => {
    const { url } = await onshapeApi.authUrl();
    window.location.href = url;
  };

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-600">Onshape 零件</span>
        {task.drawingUrl && (
          <a
            href={task.drawingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-emerald-700 active:text-emerald-900"
          >
            在 Onshape 開啟 ↗
          </a>
        )}
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
          <p className="text-xs text-slate-500">連結 Onshape 帳號後可顯示零件縮圖</p>
          <button
            onClick={connect}
            className="min-h-9 rounded-lg border border-emerald-600 px-3 text-xs font-medium text-emerald-700 active:bg-emerald-50"
          >
            連結 Onshape
          </button>
        </div>
      )}
      {state === 'error' && (
        <p className="bg-white py-6 text-center text-xs text-slate-400">
          縮圖暫時無法載入（可能無此文件權限）
        </p>
      )}
    </div>
  );
}
