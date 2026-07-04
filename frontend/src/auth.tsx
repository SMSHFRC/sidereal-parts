import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, setUnauthorizedHandler, tokens, type Me } from './api';

interface AuthCtx {
  user: Me | null;
  booting: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [booting, setBooting] = useState(true);

  const refreshMe = async () => {
    setUser(await authApi.me());
  };

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (!tokens.access) {
      setBooting(false);
      return;
    }
    refreshMe()
      .catch(() => tokens.clear())
      .finally(() => setBooting(false));
  }, []);

  const login = async (username: string, password: string) => {
    const data = await authApi.login(username, password);
    tokens.set(data.accessToken, data.refreshToken);
    await refreshMe();
  };

  const logout = () => {
    authApi.logout();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, booting, login, logout, refreshMe }}>{children}</Ctx.Provider>
  );
}
