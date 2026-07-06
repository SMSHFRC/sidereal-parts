import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, robotApi, type Robot } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Spinner } from '../ui';

const inputCls =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900';

export default function Robots() {
  const { user } = useAuth();
  const [robots, setRobots] = useState<Robot[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', note: '' });
  const [subForms, setSubForms] = useState<Record<string, { name: string }>>({});

  const load = useCallback(() => {
    setError('');
    setRobots(null);
    robotApi
      .list()
      .then(setRobots)
      .catch((e) => setError(e instanceof ApiError ? e.message : '讀取機器人失敗'));
  }, []);

  useEffect(load, [load]);

  const createRobot = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await robotApi.create({
        name: form.name.trim(),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
      setForm({ name: '', note: '' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '建立機器人失敗');
    } finally {
      setBusy(false);
    }
  };

  const createSubsystem = async (robotId: string) => {
    const sub = subForms[robotId];
    if (!sub?.name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await robotApi.createSubsystem(robotId, { name: sub.name.trim() });
      setSubForms((prev) => ({ ...prev, [robotId]: { name: '' } }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '建立子系統失敗');
    } finally {
      setBusy(false);
    }
  };

  if (error && !robots) return <ErrorBox message={error} onRetry={load} />;
  if (!robots) return <Spinner label="讀取機器人中..." />;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">機器人</h1>
      </div>

      {user?.role === 'admin' && (
        <form
          onSubmit={createRobot}
          className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[1.5fr_2fr_auto]"
        >
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="名稱"
            className={inputCls}
          />
          <input
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            placeholder="備註"
            className={inputCls}
          />
          <button
            disabled={busy}
            className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            新增
          </button>
        </form>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex flex-col gap-3">
        {robots.length === 0 ? (
          <Empty text="尚未建立機器人" />
        ) : (
          robots.map((robot) => (
            <section key={robot.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    {robot.name}
                  </h2>
                  {robot.note && <p className="mt-1 text-sm text-slate-500">{robot.note}</p>}
                </div>
                <span className="text-xs text-slate-500">{robot.subsystems.length} 個子系統</span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {robot.subsystems.map((sub) => (
                  <Link
                    key={sub.id}
                    to={`/subsystems/${sub.id}`}
                    className="rounded-lg border border-slate-200 px-3 py-2 active:bg-slate-50"
                  >
                    <p className="font-medium text-slate-900">
                      {sub.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{sub._count?.tasks ?? 0} 個任務</p>
                  </Link>
                ))}
              </div>

              {user?.role === 'admin' && (
                <div className="mt-3 grid gap-2 sm:grid-cols-[1.5fr_auto]">
                  <input
                    value={subForms[robot.id]?.name ?? ''}
                    onChange={(e) =>
                      setSubForms((p) => ({
                        ...p,
                        [robot.id]: { name: e.target.value },
                      }))
                    }
                    placeholder="子系統名稱"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => createSubsystem(robot.id)}
                    className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  >
                    新增子系統
                  </button>
                </div>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
