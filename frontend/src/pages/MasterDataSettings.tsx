import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ApiError,
  metaApi,
  type MasterDataItem,
  type MasterDataType,
} from '../api';
import { ErrorBox, Spinner } from '../ui';

const inputCls =
  'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900';

const tabs: Array<{ type: MasterDataType; label: string; hint: string }> = [
  { type: 'methods', label: '加工方式', hint: 'CNC Router、車床、雷切機、3D 列印' },
  { type: 'materials', label: '材料', hint: 'PLA、PA-CF、PC、6061 鋁板、軸材' },
  { type: 'postProcesses', label: '後處理', hint: '攻牙、倒角' },
];

function emptyDraft() {
  return { code: '', name: '', isActive: true };
}

function ItemEditor({
  item,
  draft,
  saving,
  onChange,
  onSave,
}: {
  item: MasterDataItem;
  draft: MasterDataItem;
  saving: boolean;
  onChange: (patch: Partial<MasterDataItem>) => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:grid md:grid-cols-[1fr_1.4fr_5rem_5rem] md:items-center md:gap-2 md:rounded-none md:border-0 md:border-b md:shadow-none">
      <label className="block">
        <span className="text-xs font-medium text-slate-500 md:hidden">Code</span>
        <input
          value={draft.code}
          onChange={(event) => onChange({ code: event.target.value.toUpperCase() })}
          className={`${inputCls} mt-1 font-mono md:mt-0 md:text-sm`}
        />
      </label>
      <label className="mt-3 block md:mt-0">
        <span className="text-xs font-medium text-slate-500 md:hidden">Name</span>
        <input
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          className={`${inputCls} mt-1 md:mt-0 md:text-sm`}
        />
      </label>
      <label className="mt-3 flex min-h-11 items-center justify-between rounded-lg bg-slate-50 px-3 text-sm text-slate-700 md:mt-0 md:justify-center md:bg-transparent md:px-0">
        <span className="md:hidden">啟用</span>
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(event) => onChange({ isActive: event.target.checked })}
          className="h-5 w-5"
        />
      </label>
      <button
        onClick={onSave}
        disabled={saving}
        className="mt-3 min-h-11 w-full rounded-lg bg-slate-900 text-sm font-semibold text-white disabled:opacity-50 md:mt-0"
      >
        {saving ? '儲存中' : '儲存'}
      </button>
      <input type="hidden" value={item.id} readOnly />
    </div>
  );
}

export default function MasterDataSettings() {
  const [type, setType] = useState<MasterDataType>('methods');
  const [items, setItems] = useState<MasterDataItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, MasterDataItem>>({});
  const [newItem, setNewItem] = useState(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<number | 'new' | null>(null);
  const [error, setError] = useState('');
  const activeTab = useMemo(() => tabs.find((tab) => tab.type === type)!, [type]);

  const load = async (nextType = type) => {
    setBusy(true);
    setError('');
    try {
      const data = await metaApi.listMaster(nextType);
      setItems(data);
      setDrafts(Object.fromEntries(data.map((item) => [item.id, item])));
      setNewItem(emptyDraft());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '主檔讀取失敗');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load(type);
  }, [type]);

  const updateDraft = (id: number, patch: Partial<MasterDataItem>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const save = async (id: number) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setError('');
    try {
      const saved = await metaApi.updateMaster(type, id, {
        code: draft.code,
        name: draft.name,
        isActive: draft.isActive,
      });
      setItems((current) => current.map((item) => (item.id === id ? saved : item)));
      setDrafts((current) => ({ ...current, [id]: saved }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗');
    } finally {
      setSavingId(null);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSavingId('new');
    setError('');
    try {
      const created = await metaApi.createMaster(type, newItem);
      setItems((current) => [...current, created]);
      setDrafts((current) => ({ ...current, [created.id]: created }));
      setNewItem(emptyDraft());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '新增失敗');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <section className="rounded-2xl bg-slate-50 p-3 md:p-0">
        <h1 className="text-xl font-bold text-slate-950">主檔管理</h1>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          新增或停用加工方式、材料、後處理。停用後不會出現在新任務選單，舊任務資料會保留。
        </p>
      </section>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {tabs.map((tab) => (
          <button
            key={tab.type}
            onClick={() => setType(tab.type)}
            className={`min-h-16 rounded-xl border px-3 py-2 text-left ${
              type === tab.type
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 active:bg-slate-50'
            }`}
          >
            <span className="block text-sm font-bold">{tab.label}</span>
            <span className={`mt-0.5 block text-xs leading-5 ${type === tab.type ? 'text-slate-300' : 'text-slate-500'}`}>
              {tab.hint}
            </span>
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {busy ? (
        <Spinner label="讀取主檔中..." />
      ) : (
        <section className="mt-4 space-y-3 md:space-y-0 md:overflow-hidden md:rounded-xl md:border md:border-slate-200 md:bg-white md:shadow-sm">
          <div className="hidden grid-cols-[1fr_1.4fr_5rem_5rem] gap-2 border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 md:grid">
            <span>Code</span>
            <span>Name</span>
            <span>啟用</span>
            <span></span>
          </div>

          {items.map((item) => {
            const draft = drafts[item.id] ?? item;
            return (
              <ItemEditor
                key={item.id}
                item={item}
                draft={draft}
                saving={savingId === item.id}
                onChange={(patch) => updateDraft(item.id, patch)}
                onSave={() => save(item.id)}
              />
            );
          })}

          <form
            onSubmit={create}
            className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 md:grid md:grid-cols-[1fr_1.4fr_5rem_5rem] md:items-center md:gap-2 md:rounded-none md:border-0 md:border-t md:border-slate-200 md:bg-slate-50"
          >
            <label className="block">
              <span className="text-xs font-medium text-slate-500 md:hidden">New code</span>
              <input
                required
                value={newItem.code}
                onChange={(event) => setNewItem((item) => ({ ...item, code: event.target.value.toUpperCase() }))}
                placeholder="NEW_CODE"
                className={`${inputCls} mt-1 font-mono md:mt-0 md:text-sm`}
              />
            </label>
            <label className="mt-3 block md:mt-0">
              <span className="text-xs font-medium text-slate-500 md:hidden">New name</span>
              <input
                required
                value={newItem.name}
                onChange={(event) => setNewItem((item) => ({ ...item, name: event.target.value }))}
                placeholder={`新增${activeTab.label}`}
                className={`${inputCls} mt-1 md:mt-0 md:text-sm`}
              />
            </label>
            <label className="mt-3 flex min-h-11 items-center justify-between rounded-lg bg-white px-3 text-sm text-slate-700 md:mt-0 md:justify-center md:bg-transparent md:px-0">
              <span className="md:hidden">啟用</span>
              <input
                type="checkbox"
                checked={newItem.isActive}
                onChange={(event) => setNewItem((item) => ({ ...item, isActive: event.target.checked }))}
                className="h-5 w-5"
              />
            </label>
            <button
              disabled={savingId !== null}
              className="mt-3 min-h-11 w-full rounded-lg bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50 md:mt-0"
            >
              {savingId === 'new' ? '新增中' : '新增'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
