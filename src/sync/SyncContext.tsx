// Runs the sync worker on app open, when the network comes back, when the app returns to the
// foreground, a few seconds after each local change, every 30 s while changes wait, and from
// "Sync now" (which skips the backoff delay). Needs the officer to be logged in.
// Status lives in the Redux store (store/syncSlice); SyncRunner only decides when to run.
import { useNetInfo } from '@react-native-community/netinfo';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { useRepo, useRepoData, type SyncStats } from '@/db';
import { syncNow as runSyncPass, useAppDispatch, useAppSelector } from '@/store';
import type { SyncReport } from './worker';

type SyncState = {
  running: boolean;
  online: boolean;
  loggedIn: boolean;
  stats: SyncStats | undefined;
  lastReport: SyncReport | null;
  syncNow: () => Promise<void>;
};

const AFTER_CHANGE_MS = 3_000;
const RETRY_EVERY_MS = 30_000;

const useOnline = () => useNetInfo().isConnected !== false;

export function SyncRunner() {
  const repo = useRepo();
  const dispatch = useAppDispatch();
  const loggedIn = useAppSelector((s) => Boolean(s.session.officer));
  const online = useOnline();

  const run = useCallback(() => void dispatch(runSyncPass({ repo, manual: false })), [dispatch, repo]);

  // App open, login, and the network coming back.
  useEffect(() => {
    if (!online || !loggedIn) return;
    const timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }, [online, loggedIn, run]);

  // A few seconds after each change made on the phone.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = repo.onChange((caseId) => {
      if (caseId === null) return;
      clearTimeout(timer);
      timer = setTimeout(run, AFTER_CHANGE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [repo, run]);

  // Back in the foreground, and a slow retry loop (the worker respects its backoff).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    const timer = setInterval(run, RETRY_EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [run]);

  return null;
}

export function useSync(): SyncState {
  const repo = useRepo();
  const dispatch = useAppDispatch();
  const { running, lastReport } = useAppSelector((s) => s.sync);
  const loggedIn = useAppSelector((s) => Boolean(s.session.officer));
  const online = useOnline();
  const stats = useRepoData('sync-stats', (r) => r.syncStats());
  const syncNow = useCallback(async () => {
    await dispatch(runSyncPass({ repo, manual: true }));
  }, [dispatch, repo]);
  return { running, online, loggedIn, stats, lastReport, syncNow };
}
