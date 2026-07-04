import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';

export default function Login() {
  const { user, login, booting } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!booting && user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
      nav((loc.state as { from?: string })?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登入失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-900 px-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-xl font-bold text-slate-900">零件加工任務系統</h1>
        <p className="mt-1 text-sm text-slate-500">請登入以繼續</p>

        <label className="mt-5 block text-sm font-medium text-slate-700">
          帳號
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 px-3 text-base outline-none focus:border-slate-900"
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          密碼
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 px-3 text-base outline-none focus:border-slate-900"
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
          {busy ? '登入中…' : '登入'}
        </button>
      </form>
    </div>
  );
}
