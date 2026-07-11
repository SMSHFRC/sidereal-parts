import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { taskApi, type Task } from '../api';

const LIMIT_MS = 30 * 60 * 1000;

const sourceName = (task: Task) =>
  task.note?.split('\n').find((line) => line.startsWith('Onshape: '))?.slice('Onshape: '.length).trim() ||
  task.partNumber;

export function machiningMinutes(task: Task, now = Date.now()) {
  if (!task.processingStartedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(task.processingStartedAt).getTime()) / 60_000));
}

async function loadProcessingTasks() {
  const items: Task[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await taskApi.list(`status=processing&page=${page}&includeSubsystemCompleted=true`);
    items.push(...result.items);
    total = result.total;
    page += 1;
  } while (items.length < total);
  return items;
}

export default function ProcessingTimeAlert() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(() => {
    loadProcessingTasks().then(setTasks).catch(() => {});
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const overdue = useMemo(
    () =>
      tasks
        .filter((task) => {
          if (!task.processingStartedAt) return false;
          return now - new Date(task.processingStartedAt).getTime() > LIMIT_MS;
        })
        .sort((a, b) => machiningMinutes(b, now) - machiningMinutes(a, now)),
    [now, tasks],
  );

  if (overdue.length === 0) return null;
  const shown = overdue.slice(0, 3);

  return (
    <section className="mb-4 border border-red-300 bg-red-50 px-3 py-3 text-red-900" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">!</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold">加工超過 30 分鐘</h2>
            <Link to="/schedule" className="text-xs font-semibold underline underline-offset-2">查看排單</Link>
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {shown.map((task) => (
              <li key={task.id} className="flex min-w-0 flex-wrap gap-x-2">
                <Link to={`/tasks/${task.id}`} className="max-w-full truncate font-semibold underline-offset-2 hover:underline">
                  {sourceName(task)}
                </Link>
                <span>{task.assignee?.username ?? '未指派'}</span>
                <span className="font-semibold tabular-nums">{machiningMinutes(task, now)} 分鐘</span>
              </li>
            ))}
          </ul>
          {overdue.length > shown.length && (
            <p className="mt-1 text-xs font-medium">另有 {overdue.length - shown.length} 件逾時</p>
          )}
        </div>
      </div>
    </section>
  );
}
