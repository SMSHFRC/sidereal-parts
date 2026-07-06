import { useState, type CSSProperties, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';

const pageStyle: CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0f172a',
  padding: '24px',
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: '380px',
  borderRadius: '16px',
  background: '#fff',
  padding: '24px',
  boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
};

const logoStyle: CSSProperties = {
  display: 'block',
  width: '80px',
  height: '80px',
  maxWidth: '80px',
  objectFit: 'contain',
  margin: '0 auto',
  borderRadius: '16px',
};

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: '44px',
  borderRadius: '10px',
  border: '1px solid #cbd5e1',
  padding: '0 12px',
  fontSize: '16px',
  outline: 'none',
};

export default function Login() {
  const { user, login, booting } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const returnTo = (loc.state as { from?: string })?.from ?? '/';

  if (!booting && user) return <Navigate to={returnTo} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
      nav(returnTo, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登入失敗，請確認帳號密碼');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-900 px-6" style={pageStyle}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" style={cardStyle}>
        <img src="/logo.png" alt="FRC 9501" className="mx-auto h-20 w-20 rounded-2xl object-contain" style={logoStyle} />
        <h1 className="mt-4 text-center text-xl font-bold text-slate-900" style={{ marginTop: '16px', textAlign: 'center', fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
          零件加工任務系統
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500" style={{ marginTop: '4px', textAlign: 'center', fontSize: '14px', color: '#64748b' }}>
          FRC 9501 — 請登入以繼續
        </p>

        <label className="mt-5 block text-sm font-medium text-slate-700" style={{ display: 'block', marginTop: '20px', fontSize: '14px', fontWeight: 500, color: '#334155' }}>
          帳號
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 px-3 text-base outline-none focus:border-slate-900"
            style={{ ...inputStyle, marginTop: '4px' }}
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700" style={{ display: 'block', marginTop: '12px', fontSize: '14px', fontWeight: 500, color: '#334155' }}>
          密碼
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 px-3 text-base outline-none focus:border-slate-900"
            style={{ ...inputStyle, marginTop: '4px' }}
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" style={{ marginTop: '12px', borderRadius: '10px', background: '#fef2f2', padding: '8px 12px', fontSize: '14px', color: '#b91c1c' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full min-h-12 rounded-xl bg-slate-900 text-base font-semibold text-white active:bg-slate-700 disabled:opacity-50"
          style={{
            marginTop: '20px',
            width: '100%',
            minHeight: '48px',
            border: 0,
            borderRadius: '12px',
            background: '#0f172a',
            color: '#fff',
            fontSize: '16px',
            fontWeight: 700,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? '登入中...' : '登入'}
        </button>
      </form>
    </div>
  );
}
