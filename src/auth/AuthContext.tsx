// Officer session. The profile is cached on the phone so the police station and IO name
// can fill a new case even when there is no network at the scene.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { api } from '@/api';
import { clearSession, getCachedOfficer, getToken, saveSession } from '@/api/session';
import type { Officer } from '@/api/types';

type AuthState = {
  officer: Officer | null;
  ready: boolean;
  login: (badgeNo: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [officer, setOfficer] = useState<Officer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [token, cached] = await Promise.all([getToken(), getCachedOfficer()]);
      if (token && cached) setOfficer(cached);
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  const login = useCallback(async (badgeNo: string, password: string) => {
    const res = await api.login(badgeNo, password);
    await saveSession(res.token, res.officer);
    setOfficer(res.officer);
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
    setOfficer(null);
  }, []);

  return <AuthContext.Provider value={{ officer, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
