// Offline-first storage (expo-sqlite). Every case, clip, transcript, field value, photo and
// audit event is written here immediately; the outbox queues it for sync.
import * as SQLite from 'expo-sqlite';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { DB_NAME, migrate } from './database';
import { Repo } from './repo';

export { Repo } from './repo';
export type { CaseSummary, SyncStats } from './repo';

export async function openRepo(): Promise<Repo> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await migrate(db);
  return new Repo(db);
}

const RepoContext = createContext<Repo | null>(null);

export function RepoProvider({ repo, children }: { repo: Repo; children: ReactNode }) {
  return <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>;
}

export function useRepo(): Repo {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error('useRepo must be used inside <RepoProvider>');
  return repo;
}

/**
 * Loads data from the repository and loads it again after every write. `key` names what is
 * loaded (e.g. "case:<id>"): change it when the inputs of `load` change.
 */
export function useRepoData<T>(key: string, load: (repo: Repo) => Promise<T>): T | undefined {
  const repo = useRepo();
  const [data, setData] = useState<T>();
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    let active = true;
    const run = () => {
      loadRef.current(repo).then(
        (next) => active && setData(next),
        () => undefined,
      );
    };
    run();
    const off = repo.onChange(run);
    return () => {
      active = false;
      off();
    };
  }, [repo, key]);
  return data;
}
