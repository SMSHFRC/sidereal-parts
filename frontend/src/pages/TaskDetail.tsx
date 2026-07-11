import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError,
  allowedActions,
  canClaimPostProcess,
  fmtTime,
  getTaskDownloadSpec,
  taskApi,
  transitionLabel,
  type Task,
  type TaskStatus,
} from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, Spinner, StatusBadge } from '../ui';
import { OnshapeCard } from '../components/Onshape';

const BTN_STYLE: Partial<Record<TaskStatus, string>> = {
  accepted: 'bg-sky-600 active:bg-sky-700',
  processing: 'bg-indigo-600 active:bg-indigo-700',
  post_processing: 'bg-purple-600 active:bg-purple-700',
  pending_review: 'bg-orange-500 active:bg-orange-600',
  completed: 'bg-emerald-600 active:bg-emerald-700',
  rejected: 'bg-rose-600 active:bg-rose-700',
  cancelled: 'bg-slate-500 active:bg-slate-600',
};

// 退回重做（pending_review -> processing）用警示色，與「開始加工」區隔
const btnStyleFor = (task: Task, to: TaskStatus) =>
  task.status === 'pending_review' && to === 'processing'
    ? 'bg-rose-600 active:bg-rose-700'
    : BTN_STYLE[to];

function confirmFor(task: Task, to: TaskStatus, isOpenPool: boolean): string {
  if (to === 'pending_review') return '送交管理員驗收？驗收通過後才算完成並發放積分。';
  if (task.status === 'pending_review') {
    if (to === 'completed') return '驗收通過並標記完成？將發放加工積分。';
    if (to === 'post_processing') return '驗收通過並交付後處理？將發放加工積分。';
    if (to === 'processing') return '退回給加工者重做？（不發積分）';
  }
  if (isOpenPool && to === 'accepted') return '確定接下這個任務？';
  const base: Partial<Record<TaskStatus, string>> = {
    processing: '確定開始加工？',
    post_processing: '確定加工完成並交付後處理？交棒後將發放加工積分。',
    completed: '確定標記為完成？完成後將發放積分且無法復原。',
    rejected: '確定放棄這個任務並釋放回任務池？',
    cancelled: '確定取消這個任務？取消後無法復原。',
  };
  return base[to] ?? '確定執行？';
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, refreshMe } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<TaskStatus | null>(null);
  const [actionError, setActionError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setError('');
    setTask(null);
    taskApi
      .get(id)
      .then(setTask)
      .catch((e) => setError(e instanceof ApiError ? e.message : '載入失敗'));
  }, [id]);

  useEffect(load, [load]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!task || !user) return <Spinner label="載入任務中…" />;

  const actions = allowedActions(task, user);
  const isOpenPool = task.status === 'pending' && !task.assignee;
  const showClaimPost = canClaimPostProcess(task, user);
  const downloadSpec =
    user.role === 'admin' || user.id === task.assigneeId ? getTaskDownloadSpec(task) : null;

  const doAction = async (status: TaskStatus) => {
    if (!window.confirm(confirmFor(task, status, isOpenPool))) return;
    setActionError('');
    setBusy(status);
    try {
      const updated =
        isOpenPool && status === 'accepted'
          ? await taskApi.claim(task.id)
          : await taskApi.updateStatus(task.id, status);
      setTask(updated);
      // 完成或交棒後處理都會發積分 → 更新頂欄
      if (status === 'completed' || status === 'post_processing') refreshMe().catch(() => {});
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '操作失敗');
      load(); // 狀態可能已被他人變更，重新載入
    } finally {
      setBusy(null);
    }
  };

  const doClaimPost = async () => {
    if (!window.confirm('確定接下後處理工作？完成後將獲得後處理積分。')) return;
    setActionError('');
    setBusy('post_processing');
    try {
      setTask(await taskApi.claimPostProcess(task.id));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '操作失敗');
      load();
    } finally {
      setBusy(null);
    }
  };

  const doDownload = async () => {
    setActionError('');
    setDownloading(true);
    try {
      const file = await taskApi.downloadFile(task.id);
      const href = URL.createObjectURL(file.blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '檔案下載失敗');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Link to="/" className="text-sm text-slate-500 active:text-slate-900">
        ← 返回看板
      </Link>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-mono text-lg font-bold text-slate-900">{task.partNumber}</h1>
          <StatusBadge status={task.status} reviewRejected={task.reviewRejected} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="所屬系統">{task.system.name}</Field>
          <Field label="加工方式">{task.manufacturingMethod.name}</Field>
          <Field label="需求數量">×{task.quantity}</Field>
          <Field label="積分">{task.rewardPoints} 分</Field>
          <Field label="材料">{task.material?.name ?? '—'}</Field>
          <Field label="後處理">{task.postProcess?.name ?? '—'}</Field>
          <Field label="尺寸">{task.dimensions ?? '—'}</Field>
          <Field label="指派者">{task.creator.username}</Field>
          <Field label="加工者">{task.assignee?.username ?? '未指派'}</Field>
          {task.postProcess && (
            <Field label="後處理者">{task.postProcessor?.username ?? '未指派'}</Field>
          )}
          <Field label="建立時間">{fmtTime(task.createdAt)}</Field>
        </dl>

        {task.note && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">說明</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{task.note}</p>
          </div>
        )}

        <OnshapeCard task={task} download={downloadSpec} downloading={downloading} onDownload={doDownload} />

        {task.drawingUrl && !task.onshapeDid && (
          <a
            href={task.drawingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex min-h-11 items-center justify-center rounded-xl border border-slate-300 text-sm font-medium text-slate-700 active:bg-slate-100"
          >
            開啟繪圖連結 ↗
          </a>
        )}
      </div>

      {actionError && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>
      )}

      {(actions.length > 0 || showClaimPost) && (
        <div className="mt-4 flex flex-col gap-2">
          {showClaimPost && (
            <button
              onClick={doClaimPost}
              disabled={busy !== null}
              className="min-h-12 rounded-xl bg-purple-600 text-base font-semibold text-white active:bg-purple-700 disabled:opacity-50"
            >
              {busy === 'post_processing' ? '處理中…' : '接下後處理'}
            </button>
          )}
          {actions.map((s) => (
            <button
              key={s}
              onClick={() => doAction(s)}
              disabled={busy !== null}
              className={`min-h-12 rounded-xl text-base font-semibold text-white disabled:opacity-50 ${btnStyleFor(task, s)}`}
            >
              {busy === s ? '處理中…' : transitionLabel(task.status, s)}
            </button>
          ))}
        </div>
      )}

      {/* 提示：需驗收方式 / 待驗收中 */}
      {task.status === 'processing' && task.manufacturingMethod.requiresReview && (
        <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">
          此加工方式（{task.manufacturingMethod.name}）需管理員驗收：加工完成後請按「送審驗收」。
        </p>
      )}
      {task.status === 'pending_review' && user.role !== 'admin' && (
        <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">
          已送審，等待管理員驗收。
        </p>
      )}
    </div>
  );
}
