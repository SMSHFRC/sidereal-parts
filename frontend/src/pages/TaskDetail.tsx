import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError,
  allowedActions,
  canClaimPostProcess,
  fmtTime,
  getTaskDownloadFilename,
  getTaskDownloadSpec,
  metaApi,
  STATUS_LABEL,
  taskApi,
  toSelectOptions,
  transitionLabel,
  type MetaOptions,
  type PrintMergeCandidate,
  type Task,
  type TaskStatus,
} from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, Spinner, StatusBadge, UrgentBadge } from '../ui';
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
  const [batchBusy, setBatchBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [mergePrint, setMergePrint] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState<PrintMergeCandidate[]>([]);
  const [selectedMergeIds, setSelectedMergeIds] = useState<string[]>([]);
  const [urgentReason, setUrgentReason] = useState('');
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [revisions, setRevisions] = useState<Task[]>([]);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [options, setOptions] = useState<MetaOptions | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editForm, setEditForm] = useState({
    methodId: '',
    materialId: '',
    postProcessId: '',
    quantity: '1',
    dimensions: '',
    note: '',
  });

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

  useEffect(() => {
    setMergePrint(false);
    setMergeCandidates([]);
    setSelectedMergeIds([]);
  }, [task?.id]);

  useEffect(() => {
    setUrgentReason(task?.urgentReason ?? '');
  }, [task?.id, task?.urgentReason]);

  useEffect(() => {
    if (!task?.id) return;
    taskApi
      .revisions(task.id)
      .then(setRevisions)
      .catch(() => setRevisions([]));
  }, [task?.id]);

  useEffect(() => {
    metaApi.options().then(setOptions).catch(() => {});
  }, []);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!task || !user) return <Spinner label="載入任務中…" />;

  const actions = allowedActions(task, user);
  const is3dPrint = task.manufacturingMethod.code === '3DP';
  const canPreparePrintBatch =
    is3dPrint &&
    ['pending', 'accepted'].includes(task.status) &&
    (!task.assignee || task.assignee.id === user.id) &&
    user.role === 'member';
  const visibleActions =
    is3dPrint && task.status === 'accepted'
      ? actions.filter((status) => status !== 'processing')
      : actions;
  const isOpenPool = task.status === 'pending' && !task.assignee;
  const showClaimPost = canClaimPostProcess(task, user);
  const downloadSpec = getTaskDownloadSpec(task);
  const canManagePriority = user.role === 'admin' || task.creator.id === user.id;
  const priorityEditable = task.status === 'pending' || task.status === 'accepted';
  // 編輯工單（改加工方式/材料/後處理/數量）：建立者或管理員，結案前皆可
  const canEditTask =
    (user.role === 'admin' || task.creator.id === user.id) &&
    !['completed', 'cancelled', 'rejected'].includes(task.status);
  const methodOptions = options ? toSelectOptions(options.methods) : [];
  const materialOptions = options ? toSelectOptions(options.materials) : [];
  const postProcessOptions = options ? toSelectOptions(options.postProcesses) : [];

  const togglePriority = async () => {
    const nextUrgent = !task.isUrgent;
    if (!nextUrgent && !window.confirm('確定取消這筆任務的急件標記？')) return;
    setActionError('');
    setPriorityBusy(true);
    try {
      const updated = await taskApi.updatePriority(
        task.id,
        nextUrgent,
        nextUrgent ? urgentReason.trim() || null : undefined,
      );
      setTask(updated);
      setUrgentReason(updated.urgentReason ?? '');
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '急件狀態更新失敗');
    } finally {
      setPriorityBusy(false);
    }
  };

  const doCreateRevision = async () => {
    if (
      !window.confirm(
        `建立此零件的新版本（Rev.${task.revision + 1}）？\n\n系統會以目前 Onshape 最新設計建立一個新的加工版本，並封存目前版本（Rev.${task.revision}）。舊版本會完整保留。`,
      )
    )
      return;
    setActionError('');
    setRevisionBusy(true);
    try {
      const created = await taskApi.createRevision(task.id);
      setTask(created);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '建立新版本失敗');
    } finally {
      setRevisionBusy(false);
    }
  };

  const openEdit = () => {
    setActionError('');
    setEditForm({
      methodId: String(task.manufacturingMethodId),
      materialId: task.materialId ? String(task.materialId) : '',
      postProcessId: task.postProcessId ? String(task.postProcessId) : '',
      quantity: String(task.quantity),
      dimensions: task.dimensions ?? '',
      note: task.note ?? '',
    });
    setEditing(true);
  };

  const submitEdit = async () => {
    setActionError('');
    setEditBusy(true);
    try {
      const updated = await taskApi.update(task.id, {
        manufacturingMethodId: Number(editForm.methodId),
        materialId: editForm.materialId ? Number(editForm.materialId) : null,
        postProcessId: editForm.postProcessId ? Number(editForm.postProcessId) : null,
        quantity: Number(editForm.quantity) || 1,
        dimensions: editForm.dimensions.trim() || null,
        note: editForm.note.trim() || null,
      });
      setTask(updated);
      setEditing(false);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '編輯工單失敗');
    } finally {
      setEditBusy(false);
    }
  };

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
      const fallbackFilename = downloadSpec
        ? getTaskDownloadFilename(task, downloadSpec)
        : `${task.partNumber}.stl`;
      const file = await taskApi.downloadFile(task.id, fallbackFilename);
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

  const toggleMergePrint = async (checked: boolean) => {
    setMergePrint(checked);
    setSelectedMergeIds([]);
    if (!checked || mergeCandidates.length > 0) return;
    setBatchBusy(true);
    setActionError('');
    try {
      setMergeCandidates(await taskApi.printMergeCandidates(task.id));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '載入可合併任務失敗');
      setMergePrint(false);
    } finally {
      setBatchBusy(false);
    }
  };

  const toggleSelectedMerge = (candidateId: string) => {
    setSelectedMergeIds((current) =>
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId],
    );
  };

  const startPrintBatch = async () => {
    const selected = mergeCandidates.filter((candidate) => selectedMergeIds.includes(candidate.id));
    const transfers = selected.filter((candidate) => candidate.transferRequired);
    if (transfers.length > 0) {
      const lines = transfers
        .map((candidate) => `${candidate.note?.split('\n').find((line) => line.startsWith('Onshape: '))?.slice('Onshape: '.length).trim() || candidate.partNumber} 目前由 ${candidate.assignee?.username ?? '其他人'} 負責`)
        .join('\n');
      if (
        !window.confirm(
          `${lines}\n\n將這些任務加入本次列印後，任務將轉移給你。是否繼續？`,
        )
      ) {
        return;
      }
    } else if (!window.confirm(mergePrint ? '確定開始這批 3D 列印？' : '確定開始 3D 列印？')) {
      return;
    }

    setBatchBusy(true);
    setActionError('');
    try {
      const batch = await taskApi.startPrintBatch(task.id, {
        taskIds: mergePrint ? selectedMergeIds : [],
        confirmTransfer: transfers.length > 0,
      });
      const updated = batch.items.find((item) => item.task.id === task.id)?.task;
      if (updated) setTask(updated);
      setMergePrint(false);
      setMergeCandidates([]);
      setSelectedMergeIds([]);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '開始列印批次失敗');
      load();
    } finally {
      setBatchBusy(false);
    }
  };

  const completePrintBatch = async () => {
    const batchId = task.activePrintBatch?.id;
    if (!batchId) return;
    if (!window.confirm('確定將此列印批次內的任務一起更新為列印完成？')) return;
    setBatchBusy(true);
    setActionError('');
    try {
      const batch = await taskApi.completePrintBatch(batchId);
      const updated = batch.items.find((item) => item.task.id === task.id)?.task;
      if (updated) setTask(updated);
      refreshMe().catch(() => {});
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '完成列印批次失敗');
      load();
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Link to="/" className="text-sm text-slate-500 active:text-slate-900">
        ← 返回看板
      </Link>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="font-mono text-lg font-bold text-slate-900">{task.partNumber}</h1>
            <span
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold ${
                task.revisionStatus === 'archived'
                  ? 'bg-slate-200 text-slate-500'
                  : 'bg-slate-900 text-white'
              }`}
              title={task.revisionStatus === 'archived' ? '舊版本' : '目前版本'}
            >
              Rev.{task.revision}
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-1">
            {task.isUrgent && <UrgentBadge />}
            <StatusBadge status={task.status} reviewRejected={task.reviewRejected} />
          </span>
        </div>

        {task.revisionStatus === 'archived' && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            這是舊版本（Rev.{task.revision}），已封存保留。目前版本為此零件的最新 Revision。
          </p>
        )}

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

        {canEditTask && !editing && (
          <button
            type="button"
            onClick={openEdit}
            className="mt-3 min-h-9 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 active:bg-slate-100"
          >
            編輯工單（加工方式／材料／後處理／數量）
          </button>
        )}

        {canEditTask && editing && (
          <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-800">編輯工單</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="col-span-2 block text-xs font-medium text-slate-600">
                加工方式
                <select
                  value={editForm.methodId}
                  onChange={(e) => setEditForm((p) => ({ ...p, methodId: e.target.value }))}
                  className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900"
                >
                  {methodOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                材料
                <select
                  value={editForm.materialId}
                  onChange={(e) => setEditForm((p) => ({ ...p, materialId: e.target.value }))}
                  className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900"
                >
                  <option value="">（不指定）</option>
                  {materialOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                後處理
                <select
                  value={editForm.postProcessId}
                  onChange={(e) => setEditForm((p) => ({ ...p, postProcessId: e.target.value }))}
                  className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900"
                >
                  <option value="">無</option>
                  {postProcessOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                數量
                <input
                  type="number"
                  min={1}
                  value={editForm.quantity}
                  onChange={(e) => setEditForm((p) => ({ ...p, quantity: e.target.value }))}
                  className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                尺寸
                <input
                  value={editForm.dimensions}
                  onChange={(e) => setEditForm((p) => ({ ...p, dimensions: e.target.value }))}
                  className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-900"
                />
              </label>
              <label className="col-span-2 block text-xs font-medium text-slate-600">
                說明
                <textarea
                  value={editForm.note}
                  onChange={(e) => setEditForm((p) => ({ ...p, note: e.target.value }))}
                  rows={2}
                  maxLength={2000}
                  className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-900"
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">改加工方式會重算積分；已開始加工的工單請留意設備占用。</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={submitEdit}
                disabled={editBusy || !editForm.methodId}
                className="min-h-10 flex-1 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white active:bg-slate-700 disabled:opacity-50"
              >
                {editBusy ? '儲存中…' : '儲存'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={editBusy}
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600 disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        <div className={`mt-4 rounded-lg border p-3 ${task.isUrgent ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${task.isUrgent ? 'text-red-800' : 'text-slate-800'}`}>
                {task.isUrgent ? '此任務已標記為急件' : '急件優先'}
              </p>
              {task.isUrgent && (
                <p className="mt-1 text-xs text-red-700">
                  {task.urgentReason || '未填寫急件原因'}
                  {task.urgentBy && ` · ${task.urgentBy.username}`}
                  {task.urgentAt && ` · ${fmtTime(task.urgentAt)}`}
                </p>
              )}
            </div>
            {task.isUrgent && <UrgentBadge />}
          </div>

          {canManagePriority && priorityEditable && !task.isUrgent && (
            <label className="mt-3 block text-xs font-medium text-slate-600">
              急件原因（選填）
              <textarea
                value={urgentReason}
                onChange={(event) => setUrgentReason(event.target.value)}
                maxLength={500}
                rows={2}
                className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-500"
                placeholder="例如：比賽前需完成、阻擋組裝進度"
              />
            </label>
          )}

          {canManagePriority && priorityEditable && (
            <button
              type="button"
              onClick={togglePriority}
              disabled={priorityBusy}
              className={`mt-3 min-h-10 w-full rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${
                task.isUrgent
                  ? 'border border-red-300 bg-white text-red-700 active:bg-red-100'
                  : 'bg-red-600 text-white active:bg-red-700'
              }`}
            >
              {priorityBusy ? '更新中…' : task.isUrgent ? '取消急件' : '標記為急件'}
            </button>
          )}

          {canManagePriority && !priorityEditable && (
            <p className="mt-3 text-xs text-slate-400">任務已開始加工，急件標記已鎖定，無法變更。</p>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">版本管理（Revision）</p>
            <span className="text-xs text-slate-500">目前 Rev.{revisions.find((r) => r.revisionStatus === 'current')?.revision ?? task.revision}</span>
          </div>

          {revisions.length > 0 && (
            <ul className="mt-2 space-y-1">
              {revisions.map((rev) => {
                const isCurrentRow = rev.revisionStatus === 'current';
                const isThis = rev.id === task.id;
                return (
                  <li key={rev.id}>
                    <Link
                      to={`/tasks/${rev.id}`}
                      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                        isThis ? 'bg-white ring-1 ring-slate-300' : 'active:bg-white'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-slate-800">Rev.{rev.revision}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            isCurrentRow ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {isCurrentRow ? 'Current' : 'Archived'}
                        </span>
                      </span>
                      <span className="text-xs text-slate-500">
                        {STATUS_LABEL[rev.status]} · {fmtTime(rev.createdAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {canManagePriority && task.revisionStatus === 'current' && (
            <button
              type="button"
              onClick={doCreateRevision}
              disabled={revisionBusy}
              className="mt-3 min-h-10 w-full rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white active:bg-slate-700 disabled:opacity-50"
            >
              {revisionBusy ? '建立中…' : `建立新版本（Rev.${task.revision + 1}）`}
            </button>
          )}
          {canManagePriority && task.revisionStatus === 'current' && (
            <p className="mt-2 text-xs text-slate-400">
              以目前 Onshape 最新設計建立新的加工版本，Part Number 不變，舊版本會封存保留。
            </p>
          )}
        </div>

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

      {canPreparePrintBatch && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-sky-950">
            <input
              type="checkbox"
              checked={mergePrint}
              onChange={(e) => toggleMergePrint(e.target.checked)}
              className="h-4 w-4"
            />
            與其他零件一起列印
          </label>
          {mergePrint && (
            <div className="mt-3 space-y-2">
              {batchBusy && mergeCandidates.length === 0 ? (
                <p className="text-xs text-sky-700">載入可合併任務中...</p>
              ) : mergeCandidates.length === 0 ? (
                <p className="text-xs text-sky-700">目前沒有可合併的 3D 列印任務</p>
              ) : (
                mergeCandidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex items-start gap-2 rounded-lg border border-sky-100 bg-white px-2 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMergeIds.includes(candidate.id)}
                      onChange={() => toggleSelectedMerge(candidate.id)}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-900">
                        {candidate.note?.split('\n').find((line) => line.startsWith('Onshape: '))?.slice('Onshape: '.length).trim() || candidate.partNumber}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {candidate.material?.name ?? '未指定材料'} · {candidate.assignee?.username ?? '未接單'}
                        {candidate.transferRequired ? ' · 需要轉移確認' : ''}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          )}
          <button
            type="button"
            onClick={startPrintBatch}
            disabled={batchBusy}
            className="mt-3 min-h-11 w-full rounded-xl bg-sky-700 text-sm font-semibold text-white active:bg-sky-800 disabled:opacity-50"
          >
            {batchBusy ? '處理中...' : mergePrint ? '開始列印批次' : '開始 3D 列印'}
          </button>
        </div>
      )}

      {task.activePrintBatch && task.status === 'processing' && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <p className="font-semibold">列印批次 #{task.activePrintBatch.id}</p>
          <p className="mt-1 text-xs text-sky-700">此任務已與同批零件一起列印中。</p>
          {(task.activePrintBatch.ownerId === user.id || user.role === 'admin') && (
            <button
              type="button"
              onClick={completePrintBatch}
              disabled={batchBusy}
              className="mt-3 min-h-10 w-full rounded-lg bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
            >
              {batchBusy ? '處理中...' : '完成整個列印批次'}
            </button>
          )}
        </div>
      )}

      {(visibleActions.length > 0 || showClaimPost) && (
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
          {visibleActions.map((s) => (
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
