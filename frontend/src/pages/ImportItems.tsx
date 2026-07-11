import { useCallback, useEffect, useState } from 'react';
import { ApiError, fmtTime, onshapeApi, type ImportItemRow } from '../api';
import { Empty, ErrorBox, Spinner } from '../ui';

type Kind = 'cots' | 'skipped';

const TABS: { key: Kind; label: string; hint: string }[] = [
  { key: 'cots', label: 'COTS / 採購件', hint: '匯入時判定或手動標記為採購的零件' },
  { key: 'skipped', label: '跳過', hint: '匯入時手動選擇跳過、不建任務的零件' },
];

export default function ImportItems() {
  const [kind, setKind] = useState<Kind>('cots');
  const [rows, setRows] = useState<ImportItemRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    setRows(null);
    onshapeApi
      .importItems(kind)
      .then((p) => {
        setRows(p.items);
        setTotal(p.total);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '讀取失敗'));
  }, [kind]);

  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-bold text-slate-900">COTS / 跳過零件</h1>
      <p className="mt-1 text-sm text-slate-500">
        BOM 匯入時未建立任務的零件都記錄在這裡，方便對照採購與遺漏。
      </p>

      <div className="mt-3 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setKind(t.key)}
            className={`min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold ${
              kind === t.key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 active:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!rows && !error ? (
        <Spinner label="讀取中…" />
      ) : rows && rows.length === 0 ? (
        <Empty text={`目前沒有${kind === 'cots' ? ' COTS ' : '跳過的'}零件`} />
      ) : (
        rows && (
          <div className="mt-3">
            <p className="text-xs text-slate-400">共 {total} 筆（顯示最新 {rows.length} 筆）</p>
            <div className="mt-2 flex flex-col gap-2">
              {rows.map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-slate-900">
                      {r.name ?? '未命名零件'}
                    </p>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      x{r.quantity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.partNumber ?? '無料號'} · {r.material ?? '無材料'}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                    {r.batch?.documentName && (
                      <span>
                        來源：
                        {r.batch.sourceUrl ? (
                          <a
                            href={r.batch.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-700"
                          >
                            {r.batch.documentName}
                          </a>
                        ) : (
                          r.batch.documentName
                        )}
                      </span>
                    )}
                    <span>{fmtTime(r.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
