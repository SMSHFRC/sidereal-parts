import { useCallback, useEffect, useState } from 'react';
import { ApiError, usersApi, type LeaderboardUser } from '../api';
import { Empty, ErrorBox, Spinner } from '../ui';

const REFRESH_MS = 5 * 60 * 1000;

export default function Leaderboard() {
  const [items, setItems] = useState<LeaderboardUser[] | null>(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setItems(null);
    setRefreshing(true);
    setError('');
    try {
      setItems(await usersApi.leaderboard());
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '讀取排行榜失敗');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(() => load(true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (error && !items) return <ErrorBox message={error} onRetry={() => load()} />;
  if (!items) return <Spinner label="讀取排行榜中..." />;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">加工者積分排行榜</h1>
          <p className="mt-1 text-xs text-slate-500">
            每 5 分鐘自動刷新
            {updatedAt ? ` · 最後更新 ${updatedAt.toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          {refreshing ? '更新中...' : '刷新'}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <Empty text="尚無加工者" />
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((user) => (
              <div key={user.id} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 px-4 py-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                    user.rank === 1
                      ? 'bg-amber-100 text-amber-800'
                      : user.rank === 2
                        ? 'bg-slate-200 text-slate-700'
                        : user.rank === 3
                          ? 'bg-orange-100 text-orange-800'
                          : 'bg-slate-50 text-slate-500'
                  }`}
                >
                  {user.rank}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{user.username}</p>
                </div>
                <p className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">
                  {user.totalPoints} 分
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
