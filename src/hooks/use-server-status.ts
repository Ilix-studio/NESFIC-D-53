import { useNetInfo } from '@react-native-community/netinfo';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, type Health } from '@/api';

export type ServerStatus =
  | { state: 'checking' }
  | { state: 'online'; health: Health }
  | { state: 'offline'; reason: string };

async function probe(): Promise<ServerStatus> {
  try {
    return { state: 'online', health: await api.health() };
  } catch (err) {
    return { state: 'offline', reason: err instanceof ApiError ? err.message : 'Server not reachable' };
  }
}

/** Pings GET /health on mount, when the network comes back, and on refresh(). */
export function useServerStatus() {
  const { isConnected } = useNetInfo();
  const [status, setStatus] = useState<ServerStatus>({ state: 'checking' });

  useEffect(() => {
    let active = true;
    probe().then((next) => active && setStatus(next));
    return () => {
      active = false;
    };
  }, [isConnected]);

  const refresh = useCallback(() => {
    setStatus({ state: 'checking' });
    probe().then(setStatus);
  }, []);

  return { status, refresh, deviceOnline: isConnected !== false };
}
