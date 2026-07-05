import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ApiError,
  metaApi,
  type MasterDataItem,
  type MasterDataType,
} from '../api';
import { ErrorBox, Spinner } from '../ui';

const inputCls =
  'min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-900';

const tabs: Array<{ type: MasterDataType; label: string; hint: string }> = [
  { type: 'methods', label: '加工方式', hint: 'CNC Router、車床、雷切機、3D 列印等' },
  { type: 'materials', label: '材料', hint: 'PLA、PA-CF、PC、6061 鋁板、軸材等' },
  { type: 'postProcesses', label: '後處理', hint: '攻牙、倒角等' },
];

function emptyDraft() {
  return { code: '', name: '', isActive: true };
}

export default function MasterDataSettings() {
  const [type, setType] = useState<MasterDataType>('methods');
  const [items, setItems] = useState<MasterDataItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, MasterDataItem>>({});
  const [newItem, setNewItem] = useState(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<number | 'new' | null>(null);
  const [error, setError] = useState('');
  const activeTab = useMemo(() => tabs.find((t) => t.type === type)!, [type]);

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
      <div>
        <h1 className="text-lg font-bold text-slate-900">主檔管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          新增或停用加工方式、材料、後處理。停用後不會出現在新任務選單，舊任務資料會保留。
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {tabs.map((tab) => (
          <button
            key={tab.type}
            onClick={() => setType(tab.type)}
            className={`min-h-12 rounded-lg border px-3 text-left text-sm ${
              type === tab.type
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 active:bg-slate-50'
            }`}
          >
            <span className="block font-semibold">{tab.label}</span>
            <span className={`block text-xs ${type === tab.type ? 'text-slate-300' : 'text-slate-500'}`}>
              {tab.hint}
            </span>
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}
      {busy ? (
        <Spinner label="讀取主檔中..." />
      ) : (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1fr_1.4fr_5rem_5rem] gap-2 border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
            <span>Code</span>
            <span>Name</span>
            <span>啟用</span>
            <span></span>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const draft = drafts[item.id] ?? item;
              return (
                <div key={item.id} className="grid grid-cols-[1fr_1.4fr_5rem_5rem] gap-2 px-3 py-2">
                  <input
                    value={draft.code}
                    onChange={(event) => updateDraft(item.id, { code: event.target.value.toUpperCase() })}
                    className={inputCls}
                  />
                  <input
                    value={draft.name}
                    onChange={(event) => updateDraft(item.id, { name: event.target.value })}
                    className={inputCls}
                  />
                  <label className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={draft.isActive}
                      onChange={(event) => updateDraft(item.id, { isActive: event.target.checked })}
                      className="h-5 w-5"
                    />
                  </label>
                  <button
                    onClick={() => save(item.id)}
                    disabled={savingId !== null}
                    className="min-h-10 rounded-lg bg-slate-900 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {savingId === item.id ? '...' : '儲存'}
                  </button>
                </div>
              );
            })}
          </div>

          <form onSubmit={create} className="grid grid-cols-[1fr_1.4fr_5rem_5rem] gap-2 border-t border-slate-200 bg-slate-50 px-3 py-3">
            <input
              required
              value={newItem.code}
              onChange={(event) => setNewItem((item) => ({ ...item, code: event.target.value.toUpperCase() }))}
              placeholder="NEW_CODE"
              className={inputCls}
            />
            <input
              required
              value={newItem.name}
              onChange={(event) => setNewItem((item) => ({ ...item, name: event.target.value }))}
              placeholder={`新增${activeTab.label}`}
              className={inputCls}
            />
            <label className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={newItem.isActive}
                onChange={(event) => setNewItem((item) => ({ ...item, isActive: event.target.checked }))}
                className="h-5 w-5"
              />
            </label>
            <button
              disabled={savingId !== null}
              className="min-h-10 rounded-lg bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingId === 'new' ? '...' : '新增'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
