/**
 * @jest-environment node
 */
import { openCase } from '@/case/commands';
import type { Clip } from '@/case/types';
import { migrate } from '@/db/database';
import { Repo } from '@/db/repo';
import { openTestDb } from '@/db/test-db';
import { HttpError, NetworkError, type PullResult, type SyncTransport, type WireOp } from './types';
import { backoffMs, runSync } from './worker';

const T = (s: number) => new Date(Date.UTC(2026, 10, 23, 16, 0, s));
const officer = { name: 'Test IO', badgeNo: 'T-1', policeStation: 'Test PS', district: 'Kamrup (Metro)' };

/** A fake server that applies each opId once, like the real one, and can fail on demand. */
function fakeServer() {
  const applied: WireOp[] = [];
  const seen = new Set<string>();
  const uploads: string[] = [];
  const failures = { dropAfterApply: 0, uploadNetwork: 0, uploadReject: 0 };
  const transport: SyncTransport = {
    async push(ops) {
      const results = ops.map((op) => {
        if (seen.has(op.opId)) return { opId: op.opId, status: 'duplicate' as const };
        seen.add(op.opId);
        applied.push(op);
        return { opId: op.opId, status: 'applied' as const };
      });
      // The server applied the batch, but the connection dropped before the phone got the answer.
      if (failures.dropAfterApply-- > 0) throw new NetworkError('connection lost');
      return { results, cases: [] };
    },
    async uploadClip(_caseId, clip) {
      if (failures.uploadNetwork-- > 0) throw new NetworkError('connection lost mid-upload');
      if (failures.uploadReject-- > 0) throw new HttpError(409, 'locked');
      uploads.push(clip.clientId);
    },
    async uploadPhoto() {},
    async pull(): Promise<PullResult> {
      return { cursor: T(59).toISOString(), proposals: [], cases: [] };
    },
  };
  return { transport, applied, uploads, failures };
}

async function setup() {
  const db = openTestDb();
  await migrate(db);
  const repo = new Repo(db);
  const change = openCase({ clientId: 'case-w1', now: T(0).toISOString(), officer, lang: 'as' });
  await repo.commit(null, change);
  const clip: Clip = {
    clientId: 'clip-w1',
    caseId: 'case-w1',
    section: 'crash',
    uri: 'file:///audio/clip-w1.m4a',
    mimeType: 'audio/m4a',
    recordedAt: T(1).toISOString(),
    status: 'transcribed',
    filledKeys: [],
  };
  await repo.addClip(clip, { id: 'audit-w1', caseId: 'case-w1', type: 'clip_saved', at: T(1).toISOString() });
  return { repo };
}

test('a batch the server applied but whose answer was lost is sent again and applied only once', async () => {
  const { repo } = await setup();
  const server = fakeServer();
  server.failures.dropAfterApply = 1;

  const first = await runSync({ store: repo.syncStore, transport: server.transport, now: () => T(10) });
  expect(first.error).toMatch(/connection lost/);
  expect((await repo.syncStats()).pending).toBeGreaterThan(0);
  expect(server.uploads).toEqual([]); // files wait until the data has gone

  // Backing off: a run right away does nothing; after the delay it retries.
  const early = await runSync({ store: repo.syncStore, transport: server.transport, now: () => T(11) });
  expect(early.pushed).toBe(0);
  const later = new Date(T(10).getTime() + backoffMs(0) + 1000);
  const second = await runSync({ store: repo.syncStore, transport: server.transport, now: () => later });
  expect(second.error).toBeUndefined();
  expect(server.applied.length).toBe(new Set(server.applied.map((o) => o.opId)).size);
  expect(server.uploads).toEqual(['clip-w1']);
  expect(await repo.syncStats()).toMatchObject({ pending: 0, rejected: 0, lastSyncAt: later.toISOString() });
  expect(await repo.getMeta('sync_cursor')).toBe(T(59).toISOString());
});

test('an interrupted audio upload stays queued, keeps the clip, and finishes on the next run', async () => {
  const { repo } = await setup();
  const server = fakeServer();
  server.failures.uploadNetwork = 1;

  const first = await runSync({ store: repo.syncStore, transport: server.transport, now: () => T(10) });
  expect(first).toMatchObject({ uploaded: 0, error: expect.stringMatching(/mid-upload/) });
  expect(await repo.getClip('clip-w1')).toMatchObject({ uri: 'file:///audio/clip-w1.m4a' });
  expect((await repo.syncStats()).pending).toBe(1);

  const second = await runSync({ store: repo.syncStore, transport: server.transport, now: () => T(20), ignoreBackoff: true });
  expect(second).toMatchObject({ uploaded: 1 });
  expect(server.uploads).toEqual(['clip-w1']);
  expect((await repo.syncStats()).pending).toBe(0);
});

test('a file the server refuses for good is marked rejected instead of retried forever', async () => {
  const { repo } = await setup();
  const server = fakeServer();
  server.failures.uploadReject = 1;
  const report = await runSync({ store: repo.syncStore, transport: server.transport, now: () => T(10) });
  expect(report).toMatchObject({ rejected: 1, uploaded: 0 });
  expect(await repo.syncStats()).toMatchObject({ pending: 0, rejected: 1 });
});

test('a clip still being transcribed is not uploaded yet', async () => {
  const { repo } = await setup();
  await repo.updateClip('clip-w1', { status: 'saved' });
  const server = fakeServer();
  await runSync({ store: repo.syncStore, transport: server.transport, now: () => T(10) });
  expect(server.uploads).toEqual([]);
  expect((await repo.syncStats()).pending).toBe(1);
});
