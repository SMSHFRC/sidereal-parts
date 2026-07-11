import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, fmtTime, onshapeApi, type ImportItemRow } from '../api';
import { Empty, ErrorBox, Spinner } from '../ui';

type Kind = 'cots' | 'skipped' | 'all';
type Collected = 'all' | 'open' | 'done';

const kindTabs: { key: Kind; label: string }[] = [
  { key: 'cots', label: 'COTS' },
  { key: 'skipped', label: '跳過' },
  { key: 'all', label: '全部' },
];

const collectedTabs: { key: Collected; label: string }[] = [
  { key: 'open', label: '未拿齊' },
  { key: 'done', label: '已拿齊' },
  { key: 'all', label: '全部狀態' },
];

function tabCls(active: boolean) {
  return `min-h-10 rounded-lg border px-3 text-sm font-semibold ${
    active
      ? 'border-slate-900 bg-slate-900 text-white'
      : 'border-slate-200 bg-white text-slate-600 active:bg-slate-50'
  }`;
}

export default function ImportItems() {
  const [searchParams] = useSearchParams();
  const subsystemId = searchParams.get('subsystemId') ?? undefined;
  const robotId = searchParams.get('robotId') ?? undefined;
  const systemId = searchParams.get('systemId') ? Number(searchParams.get('systemId')) : undefined;
  const [kind, setKind] = useState<Kind>('cots');
  const [collected, setCollected] = useState<Collected>('open');
  const [rows, setRows] = useState<ImportItemRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    setRows(null);
    onshapeApi
      .importItems({ kind, collected, systemId, robotId, subsystemId })
      .then((p) => {
        setRows(p.items);
        setTotal(p.total);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '讀取 COTS 清單失敗'));
  }, [collected, kind, robotId, subsystemId, systemId]);

  useEffect(load, [load]);

  const summary = useMemo(() => {
    const list = rows ?? [];
    const needed = list.reduce((sum, r) => sum + Math.max(0, r.quantity), 0);
    const collectedQty = list.reduce((sum, r) => sum + Math.max(0, r.collectedQuantity), 0);
    return { needed, collectedQty, open: list.filter((r) => !r.isCollected).length };
  }, [rows]);

  const updateItem = async (
    row: ImportItemRow,
    input: { collectedQuantity?: number; isCollected?: boolean; note?: string | null },
  ) => {
    setBusyId(row.id);
    setError('');
    try {
      const updated = await onshapeApi.updateImportItem(row.id, input);
      setRows((prev) => prev?.map((r) => (r.id === row.id ? updated : r)) ?? prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '更新 COTS 清單失敗');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">COTS 收集清單</h1>
          <p className="mt-1 text-sm text-slate-500">
            匯入時標成 COTS 或跳過的零件會保存在所屬系統/子系統中，用來確認材料與採購件有沒有拿齊。
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700"
        >
          重新整理
        </button>
      </div>

      <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">目前顯示</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{total}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">未拿齊項目</p>
          <p className="mt-1 text-xl font-bold text-amber-700">{summary.open}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">數量進度</p>
          <p className="mt-1 text-xl font-bold text-emerald-700">
            {summary.collectedQty} / {summary.needed}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {kindTabs.map((tab) => (
          <button key={tab.key} type="button" onClick={() => setKind(tab.key)} className={tabCls(kind === tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {collectedTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setCollected(tab.key)}
            className={tabCls(collected === tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}
      {!rows && !error ? (
        <Spinner label="讀取 COTS 清單中..." />
      ) : rows && rows.length === 0 ? (
        <Empty text="目前沒有符合條件的 COTS 零件" />
      ) : (
        rows && (
          <div className="mt-3 flex flex-col gap-2">
            {rows.map((row) => {
              const scope = row.subsystem?.name ?? row.system?.name ?? row.robot?.name ?? '未指定系統';
              return (
                <div
                  key={row.id}
                  className={`rounded-xl border bg-white p-3 shadow-sm ${
                    row.isCollected ? 'border-emerald-200' : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
                          {row.name ?? '未命名零件'}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            row.kind === 'cots'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {row.kind === 'cots' ? 'COTS' : '跳過'}
                        </span>
                        {row.isCollected && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                            已拿齊
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.partNumber ?? '無型號'} · {row.material ?? '無材料'} · {scope}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {row.batch?.documentName ?? 'Onshape BOM'} · {fmtTime(row.createdAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={row.quantity}
                        value={row.collectedQuantity}
                        disabled={busyId === row.id}
                        onChange={(e) =>
                          updateItem(row, { collectedQuantity: Number(e.target.value) || 0 })
                        }
                        className="h-10 w-20 rounded-lg border border-slate-300 px-2 text-center text-sm"
                      />
                      <span className="text-sm text-slate-500">/ {row.quantity}</span>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => updateItem(row, { isCollected: !row.isCollected })}
                        className={`min-h-10 rounded-lg px-3 text-sm font-semibold text-white disabled:opacity-50 ${
                          row.isCollected ? 'bg-slate-500' : 'bg-emerald-600'
                        }`}
                      >
                        {row.isCollected ? '取消' : '拿齊'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
