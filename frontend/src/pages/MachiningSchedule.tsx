import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  getTaskDownloadFilename,
  getTaskDownloadSpec,
  metaApi,
  taskApi,
  type MethodOption,
  type Task,
  type TaskStatus,
} from '../api';
import { ErrorBox, Spinner, StatusBadge } from '../ui';

type FilterKey = 'all' | 'pending' | 'active' | 'review';

const OPEN_MACHINING_STATUSES = new Set<TaskStatus>([
  'pending',
  'accepted',
  'processing',
  'pending_review',
]);

const FILTERS: Array<{ key: FilterKey; label: string; match: (task: Task) => boolean }> = [
  { key: 'all', label: '全部待加工', match: () => true },
  { key: 'pending', label: '待接單', match: (task) => task.status === 'pending' },
  {
    key: 'active',
    label: '加工中',
    match: (task) => ['accepted', 'processing'].includes(task.status),
  },
  { key: 'review', label: '待驗收', match: (task) => task.status === 'pending_review' },
];

const taskPriority = (task: Task) => {
  if (task.status === 'processing' && task.reviewRejected) return 0;
  if (task.status === 'processing') return 1;
  if (task.status === 'accepted') return 2;
  if (task.status === 'pending') return 3;
  if (task.status === 'pending_review') return 4;
  return 5;
};

const sourceName = (task: Task) =>
  task.note?.split('\n').find((line) => line.startsWith('Onshape: '))?.slice('Onshape: '.length).trim() ||
  task.partNumber;

async function loadAllTasks() {
  const items: Task[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await taskApi.list(`page=${page}&includeSubsystemCompleted=true`);
    items.push(...result.items);
    total = result.total;
    page += 1;
  } while (items.length < total);
  return items;
}

function QueueItem({
  task,
  busy,
  onClaim,
  onDownload,
}: {
  task: Task;
  busy: boolean;
  onClaim: (task: Task) => void;
  onDownload: (task: Task) => void;
}) {
  const canClaim = task.status === 'pending' && !task.assignee;
  const downloadSpec = getTaskDownloadSpec(task);
  const scope = [task.robot?.name, task.subsystem?.name].filter(Boolean).join(' / ');

  return (
    <article className="border-t border-slate-200 bg-white px-3 py-3 first:border-t-0 sm:px-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.7fr)_minmax(8rem,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/tasks/${task.id}`}
              className="truncate font-semibold text-slate-950 underline-offset-4 hover:underline"
            >
              {sourceName(task)}
            </Link>
            <StatusBadge status={task.status} reviewRejected={task.reviewRejected} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="font-mono">{task.partNumber}</span>
            <span className="font-medium text-slate-700">×{task.quantity}</span>
            {scope && <span>{scope}</span>}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:block sm:space-y-1">
          <div className="min-w-0">
            <dt className="inline text-slate-400">材料 </dt>
            <dd className="inline text-slate-700">{task.material?.name ?? '未指定'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="inline text-slate-400">加工者 </dt>
            <dd className="inline text-slate-700">{task.assignee?.username ?? '未接單'}</dd>
          </div>
        </dl>

        <div className="flex gap-2 sm:justify-end">
          {downloadSpec && (
            <button
              type="button"
              onClick={() => onDownload(task)}
              disabled={busy}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 active:bg-slate-100 disabled:opacity-50"
            >
              {busy ? '下載中' : `下載 ${downloadSpec.label}`}
            </button>
          )}
          {canClaim ? (
            <button
              type="button"
              onClick={() => onClaim(task)}
              disabled={busy}
              className="min-h-10 flex-1 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50 sm:flex-none"
            >
              {busy ? '處理中' : '接單'}
            </button>
          ) : (
            <Link
              to={`/tasks/${task.id}`}
              className="flex min-h-10 flex-1 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white active:bg-slate-700 sm:flex-none"
            >
              查看
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export default function MachiningSchedule() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [methods, setMethods] = useState<MethodOption[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    setTasks(null);
    Promise.all([loadAllTasks(), metaApi.options()])
      .then(([loadedTasks, options]) => {
        setTasks(loadedTasks);
        setMethods(options.methods);
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : '載入排單失敗'));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      loadAllTasks().then(setTasks).catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const openTasks = useMemo(
    () => (tasks ?? []).filter((task) => OPEN_MACHINING_STATUSES.has(task.status)),
    [tasks],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((item) => [item.key, openTasks.filter(item.match).length]),
      ) as Record<FilterKey, number>,
    [openTasks],
  );
  const machineUsage = useMemo(
    () =>
      methods.map((method) => {
        const machineTasks = openTasks.filter((task) => task.manufacturingMethod.code === method.code);
        const processing = machineTasks.filter((task) => task.status === 'processing');
        const queued = machineTasks.filter((task) => ['pending', 'accepted'].includes(task.status));
        return { method, processing, queued };
      }),
    [methods, openTasks],
  );
  const groups = useMemo(() => {
    const activeFilter = FILTERS.find((item) => item.key === filter) ?? FILTERS[0];
    const map = new Map<string, { code: string; name: string; tasks: Task[] }>();
    openTasks
      .filter(activeFilter.match)
      .filter((task) => !selectedMachine || task.manufacturingMethod.code === selectedMachine)
      .forEach((task) => {
      const key = task.manufacturingMethod.code;
      const group = map.get(key) ?? {
        code: key,
        name: task.manufacturingMethod.name,
        tasks: [],
      };
      group.tasks.push(task);
      map.set(key, group);
    });
    return [...map.values()]
      .map((group) => ({
        ...group,
        tasks: group.tasks.sort(
          (a, b) =>
            taskPriority(a) - taskPriority(b) ||
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }, [filter, openTasks, selectedMachine]);

  const claim = async (task: Task) => {
    if (!window.confirm(`確定接下 ${sourceName(task)}？`)) return;
    setBusyId(task.id);
    setNotice('');
    try {
      const updated = await taskApi.claim(task.id);
      setTasks((current) => current?.map((item) => (item.id === task.id ? updated : item)) ?? current);
      setNotice(`${sourceName(task)} 已接單`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '接單失敗');
    } finally {
      setBusyId(null);
    }
  };

  const download = async (task: Task) => {
    const spec = getTaskDownloadSpec(task);
    if (!spec) return;
    setBusyId(task.id);
    setNotice('');
    try {
      const file = await taskApi.downloadFile(task.id, getTaskDownloadFilename(task, spec));
      const href = URL.createObjectURL(file.blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '檔案下載失敗');
    } finally {
      setBusyId(null);
    }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!tasks) return <Spinner label="載入加工排單中…" />;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-950">加工排單</h1>
          <p className="mt-1 text-sm text-slate-500">依機器查看所有尚未完成加工的零件</p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-slate-700">共 {openTasks.length} 件任務</span>
      </div>

      <section className="mb-5" aria-labelledby="machine-usage-heading">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="machine-usage-heading" className="text-sm font-bold text-slate-800">機器使用情形</h2>
          <span className="text-xs text-slate-400">每 30 秒更新</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {machineUsage.map(({ method, processing, queued }) => {
            const busy = processing.length > 0;
            const selected = selectedMachine === method.code;
            return (
              <button
                key={method.code}
                type="button"
                onClick={() => setSelectedMachine(selected ? null : method.code)}
                className={`min-w-0 rounded-lg border p-3 text-left ${
                  selected
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : busy
                      ? 'border-emerald-300 bg-emerald-50 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold">{method.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      selected
                        ? 'bg-white/15 text-white'
                        : busy
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {busy ? '加工中' : '閒置'}
                  </span>
                </div>
                {busy ? (
                  <div className={`mt-2 text-xs ${selected ? 'text-slate-200' : 'text-slate-600'}`}>
                    <p className="truncate font-semibold">{sourceName(processing[0])}</p>
                    <p className="mt-0.5 truncate">
                      {processing[0].assignee?.username ?? '未指派'}
                      {processing.length > 1 ? `，另有 ${processing.length - 1} 件加工中` : ''}
                    </p>
                  </div>
                ) : (
                  <p className={`mt-2 text-xs ${selected ? 'text-slate-300' : 'text-slate-400'}`}>目前沒有加工中的零件</p>
                )}
                <p className={`mt-2 text-xs font-medium ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                  後方排隊 {queued.length} 件
                </p>
              </button>
            );
          })}
        </div>
        {selectedMachine && (
          <button
            type="button"
            onClick={() => setSelectedMachine(null)}
            className="mt-2 min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600"
          >
            顯示全部機器
          </button>
        )}
      </section>

      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-semibold ${
              filter === item.key
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 bg-white text-slate-600'
            }`}
          >
            {item.label} <span className="tabular-nums">({counts[item.key]})</span>
          </button>
        ))}
      </div>

      {notice && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      {groups.length === 0 ? (
        <div className="border-y border-slate-200 py-16 text-center text-sm text-slate-400">目前沒有待加工零件</div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.code} aria-labelledby={`machine-${group.code}`}>
              <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
                <div className="min-w-0">
                  <h2 id={`machine-${group.code}`} className="truncate text-base font-bold text-slate-950">
                    {group.name}
                  </h2>
                  <p className="font-mono text-xs text-slate-400">{group.code}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-700">
                  {group.tasks.length} 件
                </span>
              </div>
              <div className="overflow-hidden border-x border-b border-slate-200">
                {group.tasks.map((task) => (
                  <QueueItem
                    key={task.id}
                    task={task}
                    busy={busyId === task.id}
                    onClaim={claim}
                    onDownload={download}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
