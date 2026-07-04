import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  FALLBACK_MATERIAL_OPTIONS,
  FALLBACK_METHOD_OPTIONS,
  FALLBACK_POST_PROCESS_OPTIONS,
  FALLBACK_SYSTEM_OPTIONS,
  metaApi,
  taskApi,
  toSelectOptions,
  usersApi,
  type UserRef,
} from '../api';
import { useAuth } from '../auth';

const inputCls =
  'mt-1 w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900';

type SelectOption = { id: number; label: string };

export default function NewTask() {
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin'; // 接單制：僅 admin 可預先指派
  const [systems, setSystems] = useState<SelectOption[]>(FALLBACK_SYSTEM_OPTIONS);
  const [methods, setMethods] = useState<SelectOption[]>(FALLBACK_METHOD_OPTIONS);
  const [materials, setMaterials] = useState<SelectOption[]>(FALLBACK_MATERIAL_OPTIONS);
  const [postProcesses, setPostProcesses] = useState<SelectOption[]>(FALLBACK_POST_PROCESS_OPTIONS);
  const [systemId, setSystemId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [materialId, setMaterialId] = useState('');
  const [postProcessId, setPostProcessId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [postProcessorId, setPostProcessorId] = useState('');
  const [members, setMembers] = useState<UserRef[]>([]);
  const [drawingUrl, setDrawingUrl] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null); // partNumber

  // 加工者清單（僅 admin 指派用；失敗不擋表單）
  useEffect(() => {
    if (isAdmin) usersApi.members().then(setMembers).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    metaApi
      .options()
      .then((options) => {
        setSystems(toSelectOptions(options.systems));
        setMethods(toSelectOptions(options.methods));
        setMaterials(toSelectOptions(options.materials));
        setPostProcesses(toSelectOptions(options.postProcesses));
      })
      .catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const task = await taskApi.create({
        systemId: Number(systemId),
        manufacturingMethodId: Number(methodId),
        quantity: Number(quantity),
        ...(materialId ? { materialId: Number(materialId) } : {}),
        ...(postProcessId ? { postProcessId: Number(postProcessId) } : {}),
        ...(isAdmin && assigneeId ? { assigneeId } : {}),
        ...(isAdmin && postProcessId && postProcessorId ? { postProcessorId } : {}),
        ...(drawingUrl.trim() ? { drawingUrl: drawingUrl.trim() } : {}),
        ...(dimensions.trim() ? { dimensions: dimensions.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setCreated(task.partNumber);
      window.setTimeout(() => nav(`/tasks/${task.id}`), 1600);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '建立失敗，請稍後再試');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Link to="/" className="text-sm text-slate-500 active:text-slate-900">
        ← 返回看板
      </Link>
      <h1 className="mt-2 text-lg font-bold text-slate-900">新增任務</h1>

      {/* 成功 toast */}
      {created && (
        <div className="fixed inset-x-4 top-4 z-20 rounded-xl bg-emerald-600 px-4 py-3 text-center shadow-lg">
          <p className="text-sm font-semibold text-white">
            建立成功！零件編號 <span className="font-mono">{created}</span>
          </p>
        </div>
      )}

      <form onSubmit={submit} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">
          所屬系統 *
          <select value={systemId} onChange={(e) => setSystemId(e.target.value)} required className={inputCls}>
            <option value="">請選擇</option>
            {systems.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          加工方式 *
          <select value={methodId} onChange={(e) => setMethodId(e.target.value)} required className={inputCls}>
            <option value="">請選擇</option>
            {methods.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          需求數量 *
          <input
            type="number"
            min={1}
            max={1000000}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            className={inputCls}
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          材料
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={inputCls}>
            <option value="">（不指定）</option>
            {materials.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          後處理
          <select value={postProcessId} onChange={(e) => setPostProcessId(e.target.value)} className={inputCls}>
            <option value="">（不需要）</option>
            {postProcesses.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>

        {isAdmin ? (
          <>
            <label className="mt-3 block text-sm font-medium text-slate-700">
              指派加工者（管理員限定）
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
                <option value="">（不指定，開放接單）</option>
                {members.map((p) => (
                  <option key={p.id} value={p.id}>{p.username}</option>
                ))}
              </select>
            </label>

            {postProcessId && (
              <label className="mt-3 block text-sm font-medium text-slate-700">
                指派後處理者（管理員限定）
                <select
                  value={postProcessorId}
                  onChange={(e) => setPostProcessorId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">（不指定，交棒後開放接）</option>
                  {members.map((p) => (
                    <option key={p.id} value={p.id}>{p.username}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            任務建立後進入任務池，由隊員自行接單
            {postProcessId ? '；加工完成交棒後，後處理同樣開放認領（積分拆帳：加工 5/件、後處理 2/件）' : ''}。
          </p>
        )}

        <label className="mt-3 block text-sm font-medium text-slate-700">
          繪圖連結
          <input
            type="url"
            placeholder="https://…"
            value={drawingUrl}
            onChange={(e) => setDrawingUrl(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          零件尺寸
          <input
            placeholder="例：100x50x10 mm"
            value={dimensions}
            onChange={(e) => setDimensions(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          說明 / 備註
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${inputCls} min-h-20 py-2`}
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full min-h-12 rounded-xl bg-slate-900 text-base font-semibold text-white active:bg-slate-700 disabled:opacity-50"
        >
          {busy ? '建立中…' : '建立任務'}
        </button>
      </form>
    </div>
  );
}
