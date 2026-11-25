// Test-only: Node's built-in SQLite behind the same Db interface the app gets from
// expo-sqlite, so repository SQL, migrations and triggers run for real in Jest.
import type { Bind, Db } from './database';

type Statement = { run(...p: Bind[]): { changes: number | bigint; lastInsertRowid: number | bigint }; all(...p: Bind[]): unknown[]; get(...p: Bind[]): unknown };
type NodeDb = { exec(sql: string): void; prepare(sql: string): Statement };

export function openTestDb(): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDb };
  const db = new DatabaseSync(':memory:');
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, ...params) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getAllAsync<T>(sql: string, ...params: Bind[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: Bind[]) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
