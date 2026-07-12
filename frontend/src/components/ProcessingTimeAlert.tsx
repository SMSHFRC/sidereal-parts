import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { taskApi, type Task } from '../api';

const sourceName = (task: Task) =>
  task.note?.split('\n').find((line) => line.startsWith('Onshape: '))?.slice('Onshape: '.length).trim() ||
  task.partNumber;

export function machiningMinutes(task: Task, now = Date.now()) {
  if (!task.processingStartedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(task.processingStartedAt).getTime()) / 60_000));
}

function currentStatusMinutes(task: Task, now = Date.now()) {
  const startedAt = task.processingStartedAt ?? task.currentStatusChangedAt ?? task.updatedAt;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
}

export default function ProcessingTimeAlert() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const refresh = useCallback(() => {
    taskApi.statusReminders().then(setTasks).catch(() => {});
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const shown = useMemo(
    () => [...tasks].sort((a, b) => currentStatusMinutes(b, now) - currentStatusMinutes(a, now)).slice(0, 3),
    [now, tasks],
  );

  const respond = async (task: Task, response: 'still_processing' | 'problem') => {
    setBusyId(task.id);
    setActionError('');
    try {
      await taskApi.respondStatusReminder(task.id, response);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setNow(Date.now());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '提醒回覆失敗');
    } finally {
      setBusyId(null);
    }
  };

  if (shown.length === 0) return null;

  return (
    <section className="mb-4 border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-white">!</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold">請確認你的加工任務狀態</h2>
            <Link to="/schedule" className="text-xs font-semibold underline underline-offset-2">查看排單</Link>
          </div>
          <ul className="mt-2 space-y-2 text-xs">
            {shown.map((task) => (
              <li key={task.id} className="rounded-lg border border-amber-200 bg-white/70 px-2 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Link to={`/tasks/${task.id}`} className="max-w-full truncate font-semibold underline-offset-2 hover:underline">
                    {sourceName(task)}
                  </Link>
                  <span>{task.manufacturingMethod.name}</span>
                  <span className="font-semibold tabular-nums">{currentStatusMinutes(task, now)} 分鐘未更新</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => respond(task, 'still_processing')}
                    disabled={busyId === task.id}
                    className="min-h-8 rounded-lg bg-amber-600 px-2.5 text-xs font-semibold text-white active:bg-amber-700 disabled:opacity-50"
                  >
                    仍在加工
                  </button>
                  <Link
                    to={`/tasks/${task.id}`}
                    className="flex min-h-8 items-center rounded-lg border border-amber-300 bg-white px-2.5 text-xs font-semibold text-amber-800 active:bg-amber-100"
                  >
                    已完成，前往更新
                  </Link>
                  <button
                    type="button"
                    onClick={() => respond(task, 'problem')}
                    disabled={busyId === task.id}
                    className="min-h-8 rounded-lg border border-amber-300 bg-white px-2.5 text-xs font-semibold text-amber-800 active:bg-amber-100 disabled:opacity-50"
                  >
                    目前遇到問題
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {tasks.length > shown.length && (
            <p className="mt-1 text-xs font-medium">另有 {tasks.length - shown.length} 個任務需要確認</p>
          )}
          {actionError && <p className="mt-2 text-xs font-semibold">{actionError}</p>}
        </div>
      </div>
    </section>
  );
}
