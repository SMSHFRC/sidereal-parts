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
import OnshapePanel from './pages/OnshapePanel';
import MasterDataSettings from './pages/MasterDataSettings';
import Robots from './pages/Robots';
import SubsystemDetail from './pages/SubsystemDetail';

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
          <h1 className="text-lg font-semibold text-white">後端啟動中</h1>
          <p className="max-w-xs text-sm text-slate-400">Render 免費方案可能需要約 60 秒喚醒。</p>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold text-white">伺服器暫時無法連線</h1>
          <p className="max-w-xs text-sm text-slate-400">請稍後再試，或確認後端是否正在部署。</p>
          <button
            onClick={probe}
            className="min-h-11 rounded-xl bg-white px-8 text-sm font-semibold text-slate-900 active:bg-slate-200"
          >
            重新檢查
          </button>
        </>
      )}
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, booting } = useAuth();
  const loc = useLocation();
  if (booting) return <Spinner label="登入檢查中..." />;
  if (!user) return <Navigate to="/login" state={{ from: `${loc.pathname}${loc.search}` }} replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, booting } = useAuth();
  const loc = useLocation();
  if (booting) return <Spinner label="權限檢查中..." />;
  if (!user) return <Navigate to="/login" state={{ from: `${loc.pathname}${loc.search}` }} replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NavLink({ to, children, primary = false }: { to: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={`flex min-h-9 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-semibold ${
        primary
          ? 'bg-slate-900 text-white active:bg-slate-700'
          : 'border border-slate-300 bg-white text-slate-700 active:bg-slate-100'
      }`}
    >
      {children}
    </Link>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="mx-auto min-h-dvh max-w-5xl pb-8">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur sm:px-4">
        <div className="flex min-h-10 items-center gap-2">
          <Link to="/" className="flex min-w-0 items-center gap-2 text-base font-bold text-slate-900">
            <img src="/logo.png" alt="FRC 9501" className="h-8 w-8 shrink-0 rounded-lg" />
            <span className="hidden whitespace-nowrap sm:inline">零件任務</span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center justify-end gap-2 text-xs text-slate-600">
            {user && (
              <>
                <span className="hidden max-w-40 truncate md:inline">
                  {user.username} ({ROLE_LABEL[user.role]})
                </span>
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800">
                  {user.totalPoints} 分
                </span>
                <button
                  onClick={logout}
                  className="min-h-8 shrink-0 rounded-lg border border-slate-300 px-3 text-slate-700 active:bg-slate-100"
                >
                  登出
                </button>
              </>
            )}
          </div>
        </div>

        {user && (
          <nav className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
            <NavLink to="/tasks/new" primary>
              新增
            </NavLink>
            <NavLink to="/import">匯入</NavLink>
            <NavLink to="/robots">機器人</NavLink>
            {user.role === 'admin' && <NavLink to="/settings/master-data">主檔</NavLink>}
            <div className="shrink-0">
              <OnshapeConnectButton />
            </div>
          </nav>
        )}
      </header>
      <main className="px-3 pt-4 sm:px-4">{children}</main>
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
          path="/settings/master-data"
          element={
            <RequireAdmin>
              <Layout>
                <MasterDataSettings />
              </Layout>
            </RequireAdmin>
          }
        />
        <Route
          path="/robots"
          element={
            <RequireAuth>
              <Layout>
                <Robots />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/subsystems/:id"
          element={
            <RequireAuth>
              <Layout>
                <SubsystemDetail />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/onshape-panel"
          element={
            <RequireAuth>
              <OnshapePanel />
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
