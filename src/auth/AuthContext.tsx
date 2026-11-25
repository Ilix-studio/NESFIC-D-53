// Officer session. The profile is cached on the phone so the police station and IO name
// can fill a new case even when there is no network at the scene. State lives in the Redux
// store (store/sessionSlice); the token and profile are kept in expo-secure-store.
import { useCallback, useEffect } from 'react';

import { api } from '@/api';
import { clearSession, getCachedOfficer, getToken, saveSession } from '@/api/session';
import type { Officer } from '@/api/types';
import { loggedIn, loggedOut, restored, useAppDispatch, useAppSelector } from '@/store';

type AuthState = {
  officer: Officer | null;
  ready: boolean;
  login: (badgeNo: string, password: string) => Promise<Officer>;
  /** Replaces the cached profile, e.g. after the voiceprint is recorded. */
  updateOfficer: (officer: Officer) => Promise<void>;
  logout: () => Promise<void>;
};

/** Loads the saved session once at app start (rendered inside the store provider). */
export function SessionRestorer() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    (async () => {
      const [token, cached] = await Promise.all([getToken(), getCachedOfficer()]);
      dispatch(restored(token && cached ? cached : null));
    })().catch(() => dispatch(restored(null)));
  }, [dispatch]);
  return null;
}

export function useAuth(): AuthState {
  const dispatch = useAppDispatch();
  const { officer, ready } = useAppSelector((s) => s.session);

  // API errors (ApiError with status) reach the login screen unchanged.
  const login = useCallback(
    async (badgeNo: string, password: string) => {
      const res = await api.login(badgeNo, password);
      await saveSession(res.token, res.officer);
      dispatch(loggedIn(res.officer));
      return res.officer;
    },
    [dispatch],
  );

  const updateOfficer = useCallback(
    async (next: Officer) => {
      const token = await getToken();
      if (token) await saveSession(token, next);
      dispatch(loggedIn(next));
    },
    [dispatch],
  );

  const logout = useCallback(async () => {
    await clearSession();
    dispatch(loggedOut());
  }, [dispatch]);

  return { officer, ready, login, logout, updateOfficer };
}
