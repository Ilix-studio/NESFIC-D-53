// Opens the phone database and runs migrations. The repository only needs this small Db
// interface, which expo-sqlite's SQLiteDatabase provides (and tests provide with node:sqlite).
import { MIGRATIONS } from './migrations';

export type Bind = string | number | null;

export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: Bind[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(sql: string, ...params: Bind[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: Bind[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export const DB_NAME = 'voicedar.db';

export async function migrate(db: Db): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
