// Runs the sync worker on app open, when the network comes back, when the app returns to the
// foreground, a few seconds after each local change, every 30 s while changes wait, and from
// "Sync now" (which skips the backoff delay). Needs the officer to be logged in.
import { useNetInfo } from '@react-native-community/netinfo';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { getToken } from '@/api/session';
import { useAuth } from '@/auth/AuthContext';
import { useRepo, useRepoData, type SyncStats } from '@/db';
import { httpTransport } from './transport';
import { runSync, type SyncReport } from './worker';

type SyncState = {
  running: boolean;
  online: boolean;
  loggedIn: boolean;
  stats: SyncStats | undefined;
  lastReport: SyncReport | null;
  syncNow: () => Promise<void>;
};

const SyncContext = createContext<SyncState | null>(null);

const AFTER_CHANGE_MS = 3_000;
const RETRY_EVERY_MS = 30_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const repo = useRepo();
  const { officer } = useAuth();
  const { isConnected } = useNetInfo();
  const online = isConnected !== false;
  const stats = useRepoData('sync-stats', (r) => r.syncStats());
  const [running, setRunning] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const busy = useRef(false);

  const run = useCallback(
    async (manual: boolean) => {
      if (busy.current || !(await getToken())) return;
      busy.current = true;
      setRunning(true);
      try {
        setLastReport(await runSync({ store: repo.syncStore, transport: httpTransport, ignoreBackoff: manual }));
      } catch (err) {
        setLastReport({ pushed: 0, uploaded: 0, rejected: 0, pulled: 0, error: err instanceof Error ? err.message : String(err) });
      } finally {
        busy.current = false;
        setRunning(false);
      }
    },
    [repo],
  );

  // App open, login, and the network coming back.
  useEffect(() => {
    if (!online || !officer) return;
    const timer = setTimeout(() => run(false), 0);
    return () => clearTimeout(timer);
  }, [online, officer, run]);

  // A few seconds after each change made on the phone.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = repo.onChange((caseId) => {
      if (caseId === null) return;
      clearTimeout(timer);
      timer = setTimeout(() => run(false), AFTER_CHANGE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [repo, run]);

  // Back in the foreground, and a slow retry loop (the worker respects its backoff).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run(false));
    const timer = setInterval(() => run(false), RETRY_EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [run]);

  const syncNow = useCallback(() => run(true), [run]);

  return (
    <SyncContext.Provider value={{ running, online, loggedIn: Boolean(officer), stats, lastReport, syncNow }}>{children}</SyncContext.Provider>
  );
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}
