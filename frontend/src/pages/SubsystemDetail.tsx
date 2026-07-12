import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, robotApi, type RobotSubsystem, type Task } from '../api';
import { Empty, ErrorBox, Spinner, StatusBadge, UrgentBadge } from '../ui';
import { ProgressBar } from './Robots';

const GROUPS = [
  { key: 'pending', title: '待接單', match: (t: Task) => t.status === 'pending' },
  { key: 'active', title: '進行中', match: (t: Task) => ['accepted', 'processing', 'pending_review', 'post_processing'].includes(t.status) },
  { key: 'done', title: '已完成', match: (t: Task) => t.status === 'completed' },
] as const;

function priority(task: Task) {
  if (task.status === 'pending_review') return 0;
  if (task.status === 'processing' && task.reviewRejected) return 1;
  if (task.status === 'processing') return 2;
  if (task.status === 'post_processing') return 3;
  return 4;
}

export default function SubsystemDetail() {
  const { id } = useParams<{ id: string }>();
  const [subsystem, setSubsystem] = useState<RobotSubsystem | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    setError('');
    setSubsystem(null);
    setTasks(null);
    Promise.all([robotApi.getSubsystem(id), robotApi.subsystemTasks(id)])
      .then(([sub, page]) => {
        setSubsystem(sub);
        setTasks(page.items);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '讀取子系統失敗'));
  }, [id]);

  useEffect(load, [load]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!subsystem || !tasks) return <Spinner label="讀取子系統中..." />;

  const sorted = tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => Number(b.task.isUrgent) - Number(a.task.isUrgent) || priority(a.task) - priority(b.task) || a.index - b.index)
    .map(({ task }) => task);
  const grouped = GROUPS.map((group) => ({ ...group, items: sorted.filter(group.match) }));

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/robots" className="text-sm text-slate-500 active:text-slate-900">
        返回機器人
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{subsystem.robot?.name}</p>
          <h1 className="text-xl font-bold text-slate-900">{subsystem.name}</h1>
          {subsystem.note && <p className="mt-1 text-sm text-slate-500">{subsystem.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/import-items?robotId=${subsystem.robotId}&subsystemId=${subsystem.id}`}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          >
            COTS 資料夾
          </Link>
          <Link
            to={`/import?robotId=${subsystem.robotId}&subsystemId=${subsystem.id}`}
            className="min-h-11 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
          >
            匯入 BOM
          </Link>
        </div>
      </div>

      {/* 完成度 */}
      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <ProgressBar p={subsystem.progress} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {grouped.map((group) => (
          <section key={group.key}>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">
              {group.title} ({group.items.length})
            </h2>
            <div className="flex flex-col gap-2">
              {group.items.length === 0 ? (
                <Empty text="沒有任務" />
              ) : (
                group.items.map((task) => (
                  <Link
                    key={task.id}
                    to={`/tasks/${task.id}`}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm active:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">{task.partNumber}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {task.isUrgent && <UrgentBadge />}
                        <StatusBadge status={task.status} reviewRejected={task.reviewRejected} />
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>x{task.quantity}</span>
                      <span>{task.manufacturingMethod.name}</span>
                      <span>{task.assignee?.username ?? '未指派'}</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
