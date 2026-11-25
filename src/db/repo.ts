// The only way the app writes to SQLite. Every change is saved in one transaction together
// with its audit events and its outbox rows (CLAUDE.md rule 12), so nothing can be changed
// on the phone without being queued for sync. Also implements the sync worker's store.
import type { Change, ExtraOp } from '@/case/commands';
import { followupKey, sameValue } from '@/case/state';
import type { AuditEntry, CaseDoc, CaseStatus, Clip, Followup, Photo, Proposal } from '@/case/types';
import type { CaseLang } from '@/lang';
import type { FieldValue } from '@/schema';
import type { FileUpload, OutboxRow, PullResult, SyncStore } from '@/sync/types';
import { uuidv7 } from '@/utils/uuid';
import type { Bind, Db } from './database';

type Listener = (caseId: string | null) => void;
type Row = Record<string, unknown>;

export type CaseSummary = {
  clientId: string;
  startedAt: string;
  status: CaseStatus;
  lang: CaseLang;
  completeness: CaseDoc['completeness'];
  serverStatus?: string;
  pendingOps: number;
  rejectedOps: number;
  openProposals: number;
  clipCount: number;
  photoCount: number;
};

export type SyncStats = { pending: number; rejected: number; lastSyncAt: string | null; lastError: string | null };

/** An outbox row before it gets its id and sequence number. */
export type OutboxDraft = { entity: string; op: string; clientId: string; caseId: string; payload: Record<string, unknown> };

const FILE_ENTITIES = "('clip', 'photo')";

const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));
function parse<T>(s: unknown): T | undefined {
  return typeof s === 'string' ? (JSON.parse(s) as T) : undefined;
}
const str = (v: unknown) => (v == null ? undefined : String(v));
const num = (v: unknown) => (v == null ? undefined : Number(v));

/** Outbox rows for a change, in the order the server must apply them. */
export function deriveOps(prev: CaseDoc | null, change: Change): OutboxDraft[] {
  const { doc } = change;
  const caseId = doc.clientId;
  const extra = (entity: ExtraOp['entity']) =>
    (change.ops ?? []).filter((o) => o.entity === entity).map((o) => ({ ...o, caseId }));
  const ops: OutboxDraft[] = [...extra('case')];

  const keys = new Set([...Object.keys(prev?.fields ?? {}), ...Object.keys(doc.fields)]);
  for (const key of keys) {
    const before = prev?.fields[key];
    const after = doc.fields[key];
    if (after && before && sameValue(before, after)) continue;
    if (after) {
      ops.push({
        entity: 'field',
        op: 'set',
        clientId: key,
        caseId,
        payload: {
          key,
          value: after.value,
          source: after.source,
          confirmedByOfficer: after.confirmedByOfficer,
          ...(after.transcriptSpan ? { transcriptSpan: after.transcriptSpan } : {}),
          ...(after.clipId ? { clipId: after.clipId } : {}),
          updatedAt: after.updatedAt,
        },
      });
    } else if (before) {
      ops.push({
        entity: 'field',
        op: 'set',
        clientId: key,
        caseId,
        payload: { key, value: null, source: 'officer_edit', confirmedByOfficer: true, updatedAt: doc.updatedAt },
      });
    }
  }

  const prevStatus = new Map((prev?.followups ?? []).map((f) => [f.id, f.status]));
  for (const f of doc.followups) {
    if (f.status === 'open' || prevStatus.get(f.id) === f.status) continue;
    const ref = { ruleId: f.ruleId, kind: f.kind, fieldIds: f.fieldIds, questionEn: f.questionEn, questionAs: f.questionAs, at: f.answeredAt ?? doc.updatedAt };
    ops.push(
      f.status === 'answered'
        ? { entity: 'followup', op: 'answer', clientId: f.id, caseId, payload: { ...ref, answer: f.answer ?? null } }
        : { entity: 'followup', op: 'skip', clientId: f.id, caseId, payload: { ...ref, reason: f.skipReason ?? '' } },
    );
  }

  if (prev && prev.lang !== doc.lang) ops.push({ entity: 'case', op: 'lang', clientId: caseId, caseId, payload: { lang: doc.lang } });
  ops.push(...extra('proposal'));
  if (prev?.status !== 'signed' && doc.status === 'signed') {
    ops.push({ entity: 'case', op: 'sign', clientId: caseId, caseId, payload: { signedAt: doc.signedAt } });
  }
  for (const a of change.audit) {
    const { id, caseId: _c, ...payload } = a;
    ops.push({ entity: 'audit', op: 'append', clientId: id, caseId, payload });
  }
  return ops;
}

export class Repo {
  private listeners = new Set<Listener>();
  private writes: Promise<unknown> = Promise.resolve();
  private updates: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: Db) {}

  /**
   * Loads the latest case, applies a command and commits it. Updates run one after another,
   * so two quick taps never compute their change from the same stale case.
   */
  update<C extends Change>(clientId: string, command: (doc: CaseDoc) => C): Promise<C> {
    const run = async () => {
      const doc = await this.loadCase(clientId);
      if (!doc) throw new Error('Case not found on this phone');
      const change = command(doc);
      await this.commit(doc, change);
      return change;
    };
    const next = this.updates.then(run, run);
    this.updates = next.catch(() => undefined);
    return next;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(caseId: string | null) {
    for (const l of this.listeners) l(caseId);
  }

  /** Writes run one at a time: expo-sqlite transactions are not exclusive. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writes.then(fn, fn);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private tx(fn: () => Promise<void>) {
    return this.serial(() => this.db.withTransactionAsync(fn));
  }

  // ---------------------------------------------------------------------------------------
  // Reads

  async loadCase(clientId: string): Promise<CaseDoc | null> {
    const row = await this.db.getFirstAsync<Row>('SELECT * FROM cases WHERE client_id = ?', clientId);
    if (!row) return null;
    const fieldRows = await this.db.getAllAsync<Row>('SELECT * FROM field_values WHERE case_id = ?', clientId);
    const followupRows = await this.db.getAllAsync<Row>('SELECT * FROM followups WHERE case_id = ? ORDER BY created_at, id', clientId);
    const fields: Record<string, FieldValue> = {};
    for (const f of fieldRows) {
      fields[String(f.field_key)] = {
        value: parse<FieldValue['value']>(f.value)!,
        source: f.source as FieldValue['source'],
        confirmedByOfficer: Boolean(f.confirmed),
        updatedAt: String(f.updated_at),
        ...(f.clip_id ? { clipId: String(f.clip_id) } : {}),
        ...(f.transcript_span ? { transcriptSpan: parse(f.transcript_span) } : {}),
      };
    }
    const followups: Followup[] = followupRows.map((f) => ({
      id: String(f.id),
      ruleId: String(f.rule_id),
      kind: f.kind as Followup['kind'],
      fieldIds: parse<string[]>(f.field_ids)!,
      answerType: f.answer_type as Followup['answerType'],
      questionEn: String(f.question_en),
      questionAs: String(f.question_as),
      options: parse(f.options) ?? [],
      priority: Number(f.priority),
      status: f.status as Followup['status'],
      origin: f.origin as Followup['origin'],
      ...(f.answer != null ? { answer: parse(f.answer) } : {}),
      ...(f.skip_reason != null ? { skipReason: String(f.skip_reason) } : {}),
      ...(f.answered_at != null ? { answeredAt: String(f.answered_at) } : {}),
      createdAt: String(f.created_at),
    }));
    return {
      clientId,
      startedAt: String(row.started_at),
      ...(row.lat != null ? { location: { lat: Number(row.lat), lng: Number(row.lng), ...(row.accuracy != null ? { accuracy: Number(row.accuracy) } : {}) } } : {}),
      lang: row.lang as CaseLang,
      status: row.status as CaseStatus,
      ...(row.signed_at ? { signedAt: String(row.signed_at) } : {}),
      policeStation: str(row.police_station),
      district: str(row.district),
      officerName: str(row.officer_name),
      officerBadge: str(row.officer_badge),
      fields,
      followups,
      completeness: parse(row.completeness)!,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private summarySql(where = '') {
    return `SELECT c.*,
      (SELECT COUNT(*) FROM outbox o WHERE o.case_id = c.client_id AND o.status = 'pending') AS pending_ops,
      (SELECT COUNT(*) FROM outbox o WHERE o.case_id = c.client_id AND o.status = 'rejected') AS rejected_ops,
      (SELECT COUNT(*) FROM proposals p WHERE p.case_id = c.client_id AND p.status = 'open') AS open_proposals,
      (SELECT COUNT(*) FROM clips k WHERE k.case_id = c.client_id) AS clip_count,
      (SELECT COUNT(*) FROM photos h WHERE h.case_id = c.client_id) AS photo_count
      FROM cases c ${where} ORDER BY c.created_at DESC`;
  }

  private toSummary(r: Row): CaseSummary {
    return {
      clientId: String(r.client_id),
      startedAt: String(r.started_at),
      status: r.status as CaseStatus,
      lang: r.lang as CaseLang,
      completeness: parse(r.completeness)!,
      serverStatus: str(r.server_status),
      pendingOps: Number(r.pending_ops),
      rejectedOps: Number(r.rejected_ops),
      openProposals: Number(r.open_proposals),
      clipCount: Number(r.clip_count),
      photoCount: Number(r.photo_count),
    };
  }

  async listCases(): Promise<CaseSummary[]> {
    return (await this.db.getAllAsync<Row>(this.summarySql())).map((r) => this.toSummary(r));
  }

  async caseSummary(clientId: string): Promise<CaseSummary | null> {
    const row = await this.db.getFirstAsync<Row>(this.summarySql('WHERE c.client_id = ?'), clientId);
    return row ? this.toSummary(row) : null;
  }

  private toClip(r: Row): Clip {
    return {
      clientId: String(r.client_id),
      caseId: String(r.case_id),
      section: r.section as Clip['section'],
      uri: String(r.uri),
      mimeType: String(r.mime_type),
      durationMs: num(r.duration_ms),
      recordedAt: String(r.recorded_at),
      transcriptText: str(r.transcript_text),
      transcriptEngine: str(r.transcript_engine),
      transcriptLang: str(r.transcript_lang),
      status: r.status as Clip['status'],
      error: str(r.error),
      filledKeys: parse<string[]>(r.filled_keys) ?? [],
    };
  }

  async listClips(caseId: string): Promise<Clip[]> {
    return (await this.db.getAllAsync<Row>('SELECT * FROM clips WHERE case_id = ? ORDER BY recorded_at', caseId)).map((r) => this.toClip(r));
  }

  async getClip(clientId: string): Promise<Clip | null> {
    const r = await this.db.getFirstAsync<Row>('SELECT * FROM clips WHERE client_id = ?', clientId);
    return r ? this.toClip(r) : null;
  }

  private toPhoto(r: Row): Photo {
    return {
      clientId: String(r.client_id),
      caseId: String(r.case_id),
      checklistItem: r.checklist_item as Photo['checklistItem'],
      uri: String(r.uri),
      mimeType: String(r.mime_type),
      takenAt: String(r.taken_at),
      ...(r.lat != null ? { location: { lat: Number(r.lat), lng: Number(r.lng), ...(r.accuracy != null ? { accuracy: Number(r.accuracy) } : {}) } } : {}),
      note: str(r.note),
    };
  }

  async listPhotos(caseId: string): Promise<Photo[]> {
    return (await this.db.getAllAsync<Row>('SELECT * FROM photos WHERE case_id = ? ORDER BY taken_at', caseId)).map((r) => this.toPhoto(r));
  }

  async getPhoto(clientId: string): Promise<Photo | null> {
    const r = await this.db.getFirstAsync<Row>('SELECT * FROM photos WHERE client_id = ?', clientId);
    return r ? this.toPhoto(r) : null;
  }

  async listProposals(caseId: string): Promise<Proposal[]> {
    const rows = await this.db.getAllAsync<Row>(
      "SELECT * FROM proposals WHERE case_id = ? AND status != 'superseded' ORDER BY created_at",
      caseId,
    );
    return rows.map((r) => ({
      id: String(r.id),
      caseId: String(r.case_id),
      fieldId: String(r.field_key),
      value: parse<FieldValue['value']>(r.value)!,
      currentValue: parse<FieldValue['value']>(r.current_value) ?? null,
      currentConfirmed: Boolean(r.current_confirmed),
      source: r.source as Proposal['source'],
      evidence: parse(r.evidence),
      confidence: num(r.confidence),
      status: r.status as Proposal['status'],
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  async listAudit(caseId: string): Promise<AuditEntry[]> {
    const rows = await this.db.getAllAsync<Row>('SELECT * FROM audit_events WHERE case_id = ? ORDER BY at, id', caseId);
    return rows.map((r) => ({
      id: String(r.id),
      caseId: String(r.case_id),
      type: r.type as AuditEntry['type'],
      fieldId: str(r.field_id),
      oldValue: parse(r.old_value),
      newValue: parse(r.new_value),
      meta: parse(r.meta),
      at: String(r.at),
    }));
  }

  async caseOutbox(caseId: string): Promise<{ pending: number; rejected: { op: string; reason: string }[] }> {
    const pending = await this.db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE case_id = ? AND status = 'pending'", caseId);
    const rejected = await this.db.getAllAsync<Row>("SELECT entity, op, last_error FROM outbox WHERE case_id = ? AND status = 'rejected' ORDER BY seq", caseId);
    return {
      pending: Number(pending?.n ?? 0),
      rejected: rejected.map((r) => ({ op: `${r.entity}/${r.op}`, reason: String(r.last_error ?? '') })),
    };
  }

  async syncStats(): Promise<SyncStats> {
    const counts = await this.db.getFirstAsync<{ pending: number; rejected: number }>(
      "SELECT SUM(status = 'pending') AS pending, SUM(status = 'rejected') AS rejected FROM outbox",
    );
    return {
      pending: Number(counts?.pending ?? 0),
      rejected: Number(counts?.rejected ?? 0),
      lastSyncAt: await this.getMeta('last_sync_at'),
      lastError: await this.getMeta('last_sync_error'),
    };
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', key);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    await this.serial(() =>
      this.db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value),
    );
    this.emit(null);
  }

  // ---------------------------------------------------------------------------------------
  // Writes

  private async insertOutbox(drafts: OutboxDraft[], now: string) {
    for (const d of drafts) {
      await this.db.runAsync(
        'INSERT INTO outbox (op_id, entity, client_id, case_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        uuidv7(),
        d.entity,
        d.clientId,
        d.caseId,
        d.op,
        JSON.stringify(d.payload),
        now,
      );
    }
  }

  private async insertAudit(entries: AuditEntry[]) {
    for (const a of entries) {
      await this.db.runAsync(
        'INSERT INTO audit_events (id, case_id, type, field_id, old_value, new_value, meta, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        a.id,
        a.caseId,
        a.type,
        a.fieldId ?? null,
        json(a.oldValue),
        json(a.newValue),
        json(a.meta),
        a.at,
      );
    }
  }

  private async writeFollowup(caseId: string, f: Followup) {
    await this.db.runAsync(
      `INSERT INTO followups (id, case_id, rule_id, kind, field_ids, answer_type, question_en, question_as, options, priority,
         status, origin, answer, skip_reason, answered_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, answer_type = excluded.answer_type, question_en = excluded.question_en,
         question_as = excluded.question_as, options = excluded.options, priority = excluded.priority, status = excluded.status,
         origin = excluded.origin, answer = excluded.answer, skip_reason = excluded.skip_reason, answered_at = excluded.answered_at`,
      f.id,
      caseId,
      f.ruleId,
      f.kind,
      JSON.stringify(f.fieldIds),
      f.answerType,
      f.questionEn,
      f.questionAs,
      JSON.stringify(f.options),
      f.priority,
      f.status,
      f.origin,
      json(f.answer),
      f.skipReason ?? null,
      f.answeredAt ?? null,
      f.createdAt,
    );
  }

  /** Saves a change from src/case/commands.ts: case, fields, follow-ups, audit and outbox. */
  async commit(prev: CaseDoc | null, change: Change): Promise<void> {
    const { doc } = change;
    const drafts = deriveOps(prev, change);
    const id = doc.clientId;
    await this.tx(async () => {
      // The status is written last, so a case being signed can still save its last fields.
      const prevStatus = prev?.status ?? doc.status;
      await this.db.runAsync(
        `INSERT INTO cases (client_id, started_at, lat, lng, accuracy, lang, status, signed_at, police_station, district,
           officer_name, officer_badge, completeness, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
           lang = excluded.lang, completeness = excluded.completeness, updated_at = excluded.updated_at`,
        id,
        doc.startedAt,
        doc.location?.lat ?? null,
        doc.location?.lng ?? null,
        doc.location?.accuracy ?? null,
        doc.lang,
        prevStatus,
        prev?.signedAt ?? null,
        doc.policeStation ?? null,
        doc.district ?? null,
        doc.officerName ?? null,
        doc.officerBadge ?? null,
        JSON.stringify(doc.completeness),
        doc.createdAt,
        doc.updatedAt,
      );

      const keys = new Set([...Object.keys(prev?.fields ?? {}), ...Object.keys(doc.fields)]);
      for (const key of keys) {
        const before = prev?.fields[key];
        const after = doc.fields[key];
        if (after && before && sameValue(before, after)) continue;
        if (!after) {
          await this.db.runAsync('DELETE FROM field_values WHERE case_id = ? AND field_key = ?', id, key);
          continue;
        }
        await this.db.runAsync(
          `INSERT INTO field_values (case_id, field_key, value, source, clip_id, transcript_span, confirmed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(case_id, field_key) DO UPDATE SET value = excluded.value, source = excluded.source, clip_id = excluded.clip_id,
             transcript_span = excluded.transcript_span, confirmed = excluded.confirmed, updated_at = excluded.updated_at`,
          id,
          key,
          JSON.stringify(after.value),
          after.source,
          after.clipId ?? null,
          json(after.transcriptSpan),
          after.confirmedByOfficer ? 1 : 0,
          after.updatedAt,
        );
      }

      const before = new Map((prev?.followups ?? []).map((f) => [f.id, f]));
      for (const f of doc.followups) {
        if (!sameValue(before.get(f.id), f)) await this.writeFollowup(id, f);
        before.delete(f.id);
      }
      for (const gone of before.keys()) await this.db.runAsync('DELETE FROM followups WHERE id = ?', gone);

      for (const d of change.proposalDecisions ?? []) {
        await this.db.runAsync('UPDATE proposals SET status = ?, local_decision = 1, updated_at = ? WHERE id = ?', d.status, doc.updatedAt, d.id);
      }
      if (doc.status !== prevStatus || doc.signedAt !== prev?.signedAt) {
        await this.db.runAsync('UPDATE cases SET status = ?, signed_at = ? WHERE client_id = ?', doc.status, doc.signedAt ?? null, id);
      }
      await this.insertAudit(change.audit);
      await this.insertOutbox(drafts, doc.updatedAt);
    });
    this.emit(id);
  }

  /** Saves a clip (SQLite row + the file already in app storage) and queues its upload. */
  async addClip(clip: Clip, audit: AuditEntry): Promise<void> {
    await this.tx(async () => {
      await this.db.runAsync(
        `INSERT INTO clips (client_id, case_id, section, uri, mime_type, duration_ms, recorded_at, status, filled_keys)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        clip.clientId,
        clip.caseId,
        clip.section,
        clip.uri,
        clip.mimeType,
        clip.durationMs ?? null,
        clip.recordedAt,
        clip.status,
        JSON.stringify(clip.filledKeys),
      );
      await this.insertAudit([audit]);
      const { id, caseId, ...payload } = audit;
      await this.insertOutbox(
        [
          { entity: 'audit', op: 'append', clientId: id, caseId, payload },
          { entity: 'clip', op: 'upload', clientId: clip.clientId, caseId: clip.caseId, payload: { section: clip.section } },
        ],
        audit.at,
      );
    });
    this.emit(clip.caseId);
  }

  async updateClip(
    clientId: string,
    patch: Partial<Pick<Clip, 'status' | 'transcriptText' | 'transcriptEngine' | 'transcriptLang' | 'error' | 'filledKeys'>>,
  ): Promise<void> {
    const columns: Record<string, string> = {
      status: 'status',
      transcriptText: 'transcript_text',
      transcriptEngine: 'transcript_engine',
      transcriptLang: 'transcript_lang',
      error: 'error',
      filledKeys: 'filled_keys',
    };
    const sets: string[] = [];
    const params: Bind[] = [];
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${columns[key]} = ?`);
      params.push(key === 'filledKeys' ? JSON.stringify(value) : ((value ?? null) as Bind));
    }
    if (!sets.length) return;
    const clip = await this.getClip(clientId);
    await this.serial(() => this.db.runAsync(`UPDATE clips SET ${sets.join(', ')} WHERE client_id = ?`, ...params, clientId));
    this.emit(clip?.caseId ?? null);
  }

  async addPhoto(photo: Photo, audit: AuditEntry): Promise<void> {
    await this.tx(async () => {
      await this.db.runAsync(
        `INSERT INTO photos (client_id, case_id, checklist_item, uri, mime_type, taken_at, lat, lng, accuracy, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        photo.clientId,
        photo.caseId,
        photo.checklistItem,
        photo.uri,
        photo.mimeType,
        photo.takenAt,
        photo.location?.lat ?? null,
        photo.location?.lng ?? null,
        photo.location?.accuracy ?? null,
        photo.note ?? null,
      );
      await this.insertAudit([audit]);
      const { id, caseId, ...payload } = audit;
      await this.insertOutbox(
        [
          { entity: 'audit', op: 'append', clientId: id, caseId, payload },
          { entity: 'photo', op: 'upload', clientId: photo.clientId, caseId: photo.caseId, payload: { checklistItem: photo.checklistItem } },
        ],
        audit.at,
      );
    });
    this.emit(photo.caseId);
  }

  // ---------------------------------------------------------------------------------------
  // Sync store (used by src/sync/worker.ts)

  readonly syncStore: SyncStore = {
    dueOps: async (kind, now, limit, ignoreBackoff) => {
      const rows = await this.db.getAllAsync<Row>(
        `SELECT * FROM outbox WHERE status = 'pending' AND entity ${kind === 'file' ? 'IN' : 'NOT IN'} ${FILE_ENTITIES}
           AND (? = 1 OR next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY seq LIMIT ?`,
        ignoreBackoff ? 1 : 0,
        now,
        limit,
      );
      return rows.map(
        (r): OutboxRow => ({
          seq: Number(r.seq),
          opId: String(r.op_id),
          entity: String(r.entity),
          clientId: String(r.client_id),
          caseId: String(r.case_id),
          op: String(r.op),
          payload: parse<Record<string, unknown>>(r.payload) ?? {},
          createdAt: String(r.created_at),
          attempts: Number(r.attempts),
        }),
      );
    },
    pendingCount: async (kind) => {
      const row = await this.db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending' AND entity ${kind === 'file' ? 'IN' : 'NOT IN'} ${FILE_ENTITIES}`,
      );
      return Number(row?.n ?? 0);
    },
    markDone: async (seqs, now) => {
      if (!seqs.length) return;
      await this.serial(() =>
        this.db.runAsync(
          `UPDATE outbox SET status = 'done', done_at = ?, last_error = NULL WHERE seq IN (${seqs.map(() => '?').join(',')})`,
          now,
          ...seqs,
        ),
      );
      this.emit(null);
    },
    markRejected: async (seq, reason, now) => {
      await this.serial(() =>
        this.db.runAsync("UPDATE outbox SET status = 'rejected', last_error = ?, done_at = ?, attempts = attempts + 1 WHERE seq = ?", reason, now, seq),
      );
      this.emit(null);
    },
    markRetry: async (seqs, error, nextAttemptAt) => {
      if (!seqs.length) return;
      await this.serial(() =>
        this.db.runAsync(
          `UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE seq IN (${seqs.map(() => '?').join(',')})`,
          error,
          nextAttemptAt,
          ...seqs,
        ),
      );
      this.emit(null);
    },
    fileUpload: async (row): Promise<FileUpload> => {
      if (row.entity === 'clip') {
        const clip = await this.getClip(row.clientId);
        if (!clip) return { kind: 'missing' };
        // Still being transcribed: upload once the phone's own transcript is stored.
        if (clip.status === 'saved') return { kind: 'not_ready' };
        return { kind: 'clip', clip };
      }
      const photo = await this.getPhoto(row.clientId);
      return photo ? { kind: 'photo', photo } : { kind: 'missing' };
    },
    applyPull: (pull, now) => this.applyPull(pull, now),
    getMeta: (key) => this.getMeta(key),
    setMeta: (key, value) => this.setMeta(key, value),
  };

  /**
   * Stores what the server sent back. Proposals are upserted by id, except that a decision
   * the officer already made on this phone is never undone. Open server follow-ups that the
   * phone does not have yet are added (origin "server").
   */
  async applyPull(pull: PullResult, now: string): Promise<void> {
    const known = new Set((await this.db.getAllAsync<{ client_id: string }>('SELECT client_id FROM cases')).map((r) => r.client_id));
    const docs = new Map<string, CaseDoc>();
    for (const c of pull.cases) {
      if (!known.has(c.caseId) || !c.followups.length) continue;
      const doc = await this.loadCase(c.caseId);
      if (doc) docs.set(c.caseId, doc);
    }
    await this.tx(async () => {
      for (const p of pull.proposals) {
        if (!known.has(p.caseId)) continue;
        const existing = await this.db.getFirstAsync<{ local_decision: number }>('SELECT local_decision FROM proposals WHERE id = ?', p.id);
        if (existing?.local_decision) continue;
        await this.db.runAsync(
          `INSERT INTO proposals (id, case_id, field_key, value, current_value, current_confirmed, source, evidence, confidence, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
          p.id,
          p.caseId,
          p.fieldId,
          JSON.stringify(p.value),
          json(p.currentValue ?? undefined),
          p.currentConfirmed ? 1 : 0,
          p.source,
          json(p.evidence),
          p.confidence ?? null,
          p.status,
          p.createdAt,
          p.updatedAt,
        );
      }
      for (const c of pull.cases) {
        if (!known.has(c.caseId)) continue;
        await this.db.runAsync('UPDATE cases SET server_status = ? WHERE client_id = ?', c.status, c.caseId);
        const doc = docs.get(c.caseId);
        if (!doc || doc.status === 'signed') continue;
        const have = new Set(doc.followups.map(followupKey));
        for (const f of c.followups) {
          if (have.has(followupKey(f))) continue;
          await this.writeFollowup(c.caseId, { ...f, id: uuidv7(), status: 'open', origin: 'server', createdAt: now });
        }
      }
    });
    this.emit(null);
  }
}
