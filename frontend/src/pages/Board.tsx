import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, taskApi, type Task } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../ui';

type ColKey = 'todo' | 'doing' | 'done';
type ViewKey = 'pool' | 'assigned' | 'created' | 'all';

const COLS: { key: ColKey; title: string; match: (t: Task) => boolean }[] = [
  { key: 'todo', title: '待接受', match: (t) => t.status === 'pending' },
  {
    key: 'doing',
    title: '進行中',
    match: (t) => ['accepted', 'processing', 'post_processing'].includes(t.status),
  },
  {
    key: 'done',
    title: '已完成 / 結案',
    match: (t) => ['completed', 'rejected', 'cancelled'].includes(t.status),
  },
];

const VIEWS: { key: ViewKey; label: string; match: (t: Task, me: string) => boolean }[] = [
  { key: 'pool', label: '任務池', match: (t) => t.status === 'pending' && !t.assignee },
  { key: 'assigned', label: '我接的', match: (t, me) => t.assignee?.id === me || t.postProcessor?.id === me },
  { key: 'created', label: '我建的', match: (t, me) => t.creator.id === me },
  { key: 'all', label: '全部', match: () => true },
];

function Card({
  t,
  onClaim,
  claiming,
}: {
  t: Task;
  onClaim: (task: Task) => void;
  claiming: boolean;
}) {
  const canClaim = t.status === 'pending' && !t.assignee;
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <Link to={`/tasks/${t.id}`} className="block active:bg-slate-50">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-bold text-slate-900">{t.partNumber}</span>
          <StatusBadge status={t.status} />
        </div>
        {t.note && <p className="mt-1 truncate text-sm text-slate-600">{t.note}</p>}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
          <span>×{t.quantity}</span>
          <span>{t.manufacturingMethod.name}</span>
          {canClaim ? (
            <span className="font-medium text-emerald-600">任務池</span>
          ) : t.status === 'post_processing' && !t.postProcessor ? (
            <span className="font-medium text-purple-600">待接後處理</span>
          ) : (
            <span>{t.assignee ? `加工者：${t.assignee.username}` : '未指派'}</span>
          )}
        </div>
      </Link>
      {canClaim && (
        <button
          onClick={() => onClaim(t)}
          disabled={claiming}
          className="mt-3 min-h-11 w-full rounded-lg bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
        >
          {claiming ? '接單中…' : '接單'}
        </button>
      )}
    </article>
  );
}

function ViewTabs({
  active,
  onChange,
  counts,
}: {
  active: ViewKey;
  onChange: (key: ViewKey) => void;
  counts: Record<ViewKey, number>;
}) {
  return (
    <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium sm:min-h-11 sm:shrink sm:px-2 ${
            active === v.key
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-600'
          }`}
        >
          {v.label}
          <span className="ml-1 tabular-nums">({counts[v.key]})</span>
        </button>
      ))}
    </div>
  );
}

function ClaimNotice({ message, kind }: { message: string; kind: 'error' | 'ok' }) {
  return (
    <p
      className={`mb-3 rounded-lg px-3 py-2 text-sm ${
        kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
      }`}
    >
      {message}
    </p>
  );
}

function useVisibleTasks(tasks: Task[], me: string, activeView: ViewKey) {
  const counts = Object.fromEntries(
    VIEWS.map((v) => [v.key, tasks.filter((t) => v.match(t, me)).length]),
  ) as Record<ViewKey, number>;
  const view = VIEWS.find((v) => v.key === activeView) ?? VIEWS[0];
  return { counts, visible: tasks.filter((t) => view.match(t, me)) };
}

export default function Board() {
  const { user, refreshMe } = useAuth();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<ColKey>('todo');
  const [activeView, setActiveView] = useState<ViewKey>('pool');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<{ message: string; kind: 'error' | 'ok' } | null>(
    null,
  );

  const load = useCallback(() => {
    setError('');
    setTasks(null);
    taskApi
      .list()
      .then((p) => setTasks(p.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : '載入失敗'));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!tasks || !user) return <Spinner label="載入任務中…" />;

  const { counts, visible } = useVisibleTasks(tasks, user.id, activeView);
  const grouped = COLS.map((c) => ({ ...c, items: visible.filter(c.match) }));

  const claim = async (task: Task) => {
    setClaimNotice(null);
    setClaimingId(task.id);
    try {
      const updated = await taskApi.claim(task.id);
      setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? updated : t)) : prev));
      setClaimNotice({ kind: 'ok', message: `${task.partNumber} 已接單` });
      refreshMe().catch(() => {});
    } catch (e) {
      setClaimNotice({
        kind: 'error',
        message: e instanceof ApiError ? e.message : '接單失敗，請再試一次',
      });
      load();
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div>
      <ViewTabs active={activeView} onChange={setActiveView} counts={counts} />
      {claimNotice && <ClaimNotice {...claimNotice} />}

      {/* 手機：狀態切換 chips */}
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 md:hidden">
        {grouped.map((c) => (
          <button
            key={c.key}
            onClick={() => setActive(c.key)}
            className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium ${
              active === c.key
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 bg-white text-slate-600'
            }`}
          >
            {c.title}（{c.items.length}）
          </button>
        ))}
      </div>

      <div className="md:grid md:grid-cols-3 md:gap-4">
        {grouped.map((c) => (
          <section key={c.key} className={active === c.key ? '' : 'hidden md:block'}>
            <h2 className="mb-2 hidden text-sm font-semibold text-slate-700 md:block">
              {c.title}（{c.items.length}）
            </h2>
            <div className="flex flex-col gap-2">
              {c.items.length === 0 ? (
                <Empty text="沒有任務" />
              ) : (
                c.items.map((t) => (
                  <Card key={t.id} t={t} onClaim={claim} claiming={claimingId === t.id} />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
