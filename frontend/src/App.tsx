import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HEALTH_URL, ROLE_LABEL } from './api';
import { useAuth } from './auth';
import { Spinner } from './ui';
import { OnshapeConnectButton } from './components/Onshape';
import Login from './pages/Login';
import Board from './pages/Board';
import TaskDetail from './pages/TaskDetail';
import NewTask from './pages/NewTask';
import ImportOnshape from './pages/ImportOnshape';

// ---- 喚醒畫面：Render free tier 冷啟動約 30–60 秒 ----
function WakeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'ok' | 'down'>('checking');

  const probe = async () => {
    setState('checking');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 90_000);
      const res = await fetch(HEALTH_URL, { signal: ctrl.signal });
      clearTimeout(t);
      setState(res.ok ? 'ok' : 'down');
    } catch {
      setState('down');
    }
  };

  useEffect(() => {
    probe();
  }, []);

  if (state === 'ok') return <>{children}</>;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-900 px-6 text-center">
      {state === 'checking' ? (
        <>
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-600 border-t-white" />
          <h1 className="text-lg font-semibold text-white">伺服器喚醒中…</h1>
          <p className="max-w-xs text-sm text-slate-400">
            免費方案閒置後需要冷啟動，最多約 60 秒，請稍候。
          </p>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold text-white">無法連線到伺服器</h1>
          <p className="max-w-xs text-sm text-slate-400">請確認網路連線後重試。</p>
          <button
            onClick={probe}
            className="min-h-11 rounded-xl bg-white px-8 text-sm font-semibold text-slate-900 active:bg-slate-200"
          >
            重試
          </button>
        </>
      )}
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, booting } = useAuth();
  const loc = useLocation();
  if (booting) return <Spinner label="驗證登入中…" />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const canCreate = Boolean(user);
  return (
    <div className="mx-auto min-h-dvh max-w-5xl pb-8">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-base font-bold text-slate-900">
          <img src="/logo.png" alt="FRC 9501" className="h-8 w-8 rounded-lg" />
          零件任務
        </Link>
        {canCreate && (
          <>
            <Link
              to="/tasks/new"
              className="flex min-h-9 items-center rounded-lg bg-slate-900 px-3 text-sm font-medium text-white active:bg-slate-700"
            >
              ＋ 新增
            </Link>
            <Link
              to="/import"
              className="flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 active:bg-slate-100"
            >
              匯入
            </Link>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-600">
          {user && (
            <>
              <OnshapeConnectButton />
              <span className="hidden sm:inline">
                {user.username}（{ROLE_LABEL[user.role]}）
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                {user.totalPoints} 分
              </span>
              <button
                onClick={logout}
                className="min-h-9 rounded-lg border border-slate-300 px-3 text-slate-700 active:bg-slate-100"
              >
                登出
              </button>
            </>
          )}
        </div>
      </header>
      <main className="px-4 pt-4">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <WakeGate>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout>
                <Board />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/tasks/new"
          element={
            <RequireAuth>
              <Layout>
                <NewTask />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/import"
          element={
            <RequireAuth>
              <Layout>
                <ImportOnshape />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/tasks/:id"
          element={
            <RequireAuth>
              <Layout>
                <TaskDetail />
              </Layout>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </WakeGate>
  );
}
