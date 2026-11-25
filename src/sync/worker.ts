// Sync worker (OFFLINE-PLAN phase O1). One run:
//   1. sends due outbox data rows in seq order, in batches (the server applies each opId once);
//   2. then uploads audio and photos, one file per request;
//   3. then pulls proposals and follow-ups since the last cursor.
// On a network failure it stops and backs off; rows stay queued, nothing is lost, and audio
// is never deleted from the phone. Runs on app open, when the network returns, after local
// changes, and from "Sync now".
import { HttpError, NetworkError, type OutboxRow, type SyncStore, type SyncTransport, type WireOp } from './types';

export type SyncReport = { pushed: number; uploaded: number; rejected: number; pulled: number; error?: string };

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 10 * 60_000;

export const backoffMs = (attempts: number) => Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);

const toWire = (r: OutboxRow): WireOp => ({ opId: r.opId, caseId: r.caseId, entity: r.entity, op: r.op, createdAt: r.createdAt, payload: r.payload });
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** 4xx answers will not change on retry (except timeouts and rate limits). */
const permanent = (err: unknown) => err instanceof HttpError && err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status);

export async function runSync(opts: {
  store: SyncStore;
  transport: SyncTransport;
  now?: () => Date;
  batchSize?: number;
  /** "Sync now": ignore the backoff delays. */
  ignoreBackoff?: boolean;
}): Promise<SyncReport> {
  const { store, transport, now = () => new Date(), batchSize = 50, ignoreBackoff = false } = opts;
  const iso = () => now().toISOString();
  const retryAt = (attempts: number) => new Date(now().getTime() + backoffMs(attempts)).toISOString();
  const report: SyncReport = { pushed: 0, uploaded: 0, rejected: 0, pulled: 0 };
  const fail = async (error: string) => {
    report.error = error;
    await store.setMeta('last_sync_error', error);
    return report;
  };

  // 1. Data, in order.
  for (;;) {
    const rows = await store.dueOps('data', iso(), batchSize, ignoreBackoff);
    if (!rows.length) break;
    let res;
    try {
      res = await transport.push(rows.map(toWire));
    } catch (err) {
      await store.markRetry(rows.map((r) => r.seq), message(err), retryAt(rows[0].attempts));
      return fail(message(err));
    }
    const bySeq = new Map(rows.map((r) => [r.opId, r.seq]));
    const done: number[] = [];
    const errored: number[] = [];
    for (const r of res.results) {
      const seq = bySeq.get(r.opId);
      if (seq === undefined) continue;
      if (r.status === 'applied' || r.status === 'duplicate') done.push(seq);
      else if (r.status === 'rejected') {
        await store.markRejected(seq, r.reason ?? 'rejected by server', iso());
        report.rejected++;
      } else errored.push(seq);
    }
    await store.markDone(done, iso());
    report.pushed += done.length;
    if (errored.length) {
      // Keep later changes behind the one that failed, so the server applies them in order.
      await store.markRetry(errored, 'server error', retryAt(rows[0].attempts));
      return fail('The server could not apply some changes; will retry.');
    }
  }

  // 2. Files, only once every data row has gone (the case must exist on the server).
  if ((await store.pendingCount('data')) === 0) {
    const files = await store.dueOps('file', iso(), 20, ignoreBackoff);
    for (const row of files) {
      const upload = await store.fileUpload(row);
      if (upload.kind === 'not_ready') continue;
      if (upload.kind === 'missing') {
        await store.markRejected(row.seq, 'file record missing on this phone', iso());
        report.rejected++;
        continue;
      }
      try {
        if (upload.kind === 'clip') await transport.uploadClip(row.caseId, upload.clip);
        else await transport.uploadPhoto(row.caseId, upload.photo);
        await store.markDone([row.seq], iso());
        report.uploaded++;
      } catch (err) {
        if (permanent(err)) {
          await store.markRejected(row.seq, message(err), iso());
          report.rejected++;
          continue;
        }
        await store.markRetry([row.seq], message(err), retryAt(row.attempts));
        if (err instanceof NetworkError) return fail(message(err));
      }
    }
  }

  // 3. Pull what the server found since last time.
  try {
    const pull = await transport.pull(await store.getMeta('sync_cursor'));
    await store.applyPull(pull, iso());
    await store.setMeta('sync_cursor', pull.cursor);
    report.pulled = pull.proposals.length;
  } catch (err) {
    return fail(message(err));
  }

  await store.setMeta('last_sync_at', iso());
  await store.setMeta('last_sync_error', null);
  return report;
}
