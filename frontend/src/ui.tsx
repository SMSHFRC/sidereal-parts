import type { ReactNode } from 'react';
import { STATUS_LABEL, type TaskStatus } from './api';

export function Spinner({ label = '載入中…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-600" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto my-8 max-w-md rounded-xl border border-red-200 bg-red-50 p-4 text-center">
      <p className="text-sm text-red-700">發生錯誤：{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 min-h-11 rounded-lg bg-red-600 px-5 text-sm font-medium text-white active:bg-red-700"
        >
          重試
        </button>
      )}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-slate-400">{text}</p>;
}

const STATUS_STYLE: Record<TaskStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-sky-100 text-sky-800',
  processing: 'bg-indigo-100 text-indigo-800',
  post_processing: 'bg-purple-100 text-purple-800',
  completed: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-200 text-slate-600',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children ?? '—'}</dd>
    </div>
  );
}
