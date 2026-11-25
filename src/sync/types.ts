// Sync wire format (server: POST /sync/cases with { ops }, GET /sync/pull) and the two
// interfaces the worker depends on, so it can be tested without SQLite or a network.
import type { Clip, Finding, Photo, Proposal } from '@/case/types';

export type OutboxRow = {
  seq: number;
  opId: string;
  entity: string;
  clientId: string;
  caseId: string;
  op: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
};

export type WireOp = { opId: string; caseId: string; entity: string; op: string; createdAt: string; payload: Record<string, unknown> };

export type PushResult = {
  results: { opId: string; status: 'applied' | 'duplicate' | 'rejected' | 'error'; reason?: string }[];
  cases: { caseId: string; status: string }[];
};

export type PullResult = {
  cursor: string;
  proposals: Proposal[];
  cases: { caseId: string; status: string; followups: Finding[] }[];
};

export type FileUpload =
  | { kind: 'clip'; clip: Clip }
  | { kind: 'photo'; photo: Photo }
  | { kind: 'not_ready' }
  | { kind: 'missing' };

export interface SyncStore {
  dueOps(kind: 'data' | 'file', now: string, limit: number, ignoreBackoff: boolean): Promise<OutboxRow[]>;
  pendingCount(kind: 'data' | 'file'): Promise<number>;
  markDone(seqs: number[], now: string): Promise<void>;
  markRejected(seq: number, reason: string, now: string): Promise<void>;
  markRetry(seqs: number[], error: string, nextAttemptAt: string): Promise<void>;
  fileUpload(row: OutboxRow): Promise<FileUpload>;
  applyPull(pull: PullResult, now: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string | null): Promise<void>;
}

export interface SyncTransport {
  push(ops: WireOp[]): Promise<PushResult>;
  uploadClip(caseId: string, clip: Clip): Promise<void>;
  uploadPhoto(caseId: string, photo: Photo): Promise<void>;
  pull(since: string | null): Promise<PullResult>;
}

/** No connection, timeout, or server unreachable: stop and try again later. */
export class NetworkError extends Error {
  constructor(message = 'Server not reachable') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The server answered with an error status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
