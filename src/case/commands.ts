// Everything an officer can do to a case, as pure functions: each returns the new case and
// the audit events to append. The repository (src/db/repo.ts) saves the change in one
// transaction and derives the outbox rows from it, so no change can skip the sync queue.
import type { CaseLang } from '@/lang';
import { coerceValue, fieldForKey, getField, parseFieldKey, type FieldValue, type LatLng, type TranscriptSpan } from '@/schema';
import { uuidv7 } from '@/utils/uuid';
import { isEmpty } from './fields';
import { applyProposals, recheck, sameValue, setFieldValue, unconfirmedFields, type AppliedField, type MapperProposal } from './state';
import type { AuditEntry, AuditType, CaseDoc, ClipSection, Proposal } from './types';

export type OfficerInfo = { name: string; badgeNo: string; policeStation: string; district: string };

/** An outbox row the change needs besides the field / follow-up / status diffs. */
export type ExtraOp = { entity: 'case' | 'proposal'; op: string; clientId: string; payload: Record<string, unknown> };

export type Change = {
  doc: CaseDoc;
  audit: AuditEntry[];
  ops?: ExtraOp[];
  proposalDecisions?: { id: string; status: 'accepted' | 'rejected' }[];
};

export class CaseLockedError extends Error {
  constructor() {
    super('This case is signed and read-only');
    this.name = 'CaseLockedError';
  }
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

const copy = (doc: CaseDoc): CaseDoc => JSON.parse(JSON.stringify(doc));

function editable(doc: CaseDoc, now: string): CaseDoc {
  if (doc.status === 'signed') throw new CaseLockedError();
  const next = copy(doc);
  next.updatedAt = now;
  return next;
}

function event(doc: CaseDoc, type: AuditType, now: string, extra: Partial<AuditEntry> = {}): AuditEntry {
  return { id: uuidv7(), caseId: doc.clientId, type, at: now, ...extra };
}

function checkedValue(key: string, raw: unknown): FieldValue['value'] {
  const field = fieldForKey(key);
  if (!field) throw new CommandError(`Unknown field "${key}"`);
  const checked = coerceValue(field, raw);
  if (!checked.ok) throw new CommandError(checked.error);
  return checked.value;
}

export function openCase(input: { clientId: string; now: string; officer: OfficerInfo | null; location?: LatLng; lang: CaseLang }): Change {
  const { clientId, now, officer, location, lang } = input;
  const doc: CaseDoc = {
    clientId,
    startedAt: now,
    lang,
    status: 'draft',
    ...(location ? { location } : {}),
    ...(officer
      ? { policeStation: officer.policeStation, district: officer.district, officerName: officer.name, officerBadge: officer.badgeNo }
      : {}),
    fields: {},
    followups: [],
    completeness: { filled: 0, total: 0, percent: 0 },
    createdAt: now,
    updatedAt: now,
  };
  if (officer) {
    setFieldValue(doc, 'police_station', officer.policeStation, { source: 'auto', now });
    setFieldValue(doc, 'district', officer.district, { source: 'auto', now });
  }
  if (location) setFieldValue(doc, 'crash_location', location, { source: 'auto', now });
  recheck(doc, now);
  return {
    doc,
    audit: [event(doc, 'case_opened', now, { meta: { gps: Boolean(location), lang } })],
    ops: [{ entity: 'case', op: 'create', clientId, payload: { startedAt: now, ...(location ? { location } : {}), lang } }],
  };
}

/** GPS often arrives a few seconds after the case is opened. */
export function setLocation(doc: CaseDoc, location: LatLng, now: string): Change {
  const next = editable(doc, now);
  next.location = location;
  setFieldValue(next, 'crash_location', location, { source: 'auto', now });
  recheck(next, now);
  return { doc: next, audit: [] };
}

export function setLanguage(doc: CaseDoc, lang: CaseLang, now: string): Change {
  const next = editable(doc, now);
  if (next.lang === lang) return { doc: next, audit: [] };
  next.lang = lang;
  recheck(next, now);
  return { doc: next, audit: [event(next, 'language_set', now, { oldValue: doc.lang, newValue: lang })] };
}

/** Speech pass over one clip: mapper proposals become field values with source "speech". */
export function applyTranscript(
  doc: CaseDoc,
  input: { clipId: string; section: ClipSection; engine: string; proposals: MapperProposal[]; now: string },
): Change & { filled: AppliedField[] } {
  const { clipId, section, engine, proposals, now } = input;
  const next = editable(doc, now);
  const filled = applyProposals(next, proposals, { source: 'speech', clipId, now });
  recheck(next, now);
  const audit = [event(next, 'clip_processed', now, { meta: { clipId, section, engine, status: 'done' } })];
  if (filled.length) audit.push(event(next, 'fields_filled', now, { meta: { clipId, count: filled.length, fieldIds: filled.map((f) => f.fieldId) } }));
  return { doc: next, audit, filled };
}

export function answerFollowup(
  doc: CaseDoc,
  followupId: string,
  raw: unknown,
  opts: { source: 'tap' | 'speech'; now: string; clipId?: string; transcriptSpan?: TranscriptSpan },
): Change {
  const next = editable(doc, opts.now);
  const followup = next.followups.find((f) => f.id === followupId);
  if (!followup || followup.status !== 'open') throw new CommandError('This question is no longer open');
  const key = followup.fieldIds[0];
  const value = checkedValue(key, raw);
  const oldValue = next.fields[key]?.value;
  // Correcting an existing value is an officer edit (shown as "Edited by IO" in review).
  const correcting = !isEmpty(oldValue) && !sameValue(oldValue, value);
  setFieldValue(next, key, value, {
    source: correcting ? 'officer_edit' : opts.source,
    clipId: opts.clipId,
    transcriptSpan: opts.transcriptSpan,
    now: opts.now,
    force: true,
  });
  Object.assign(followup, { status: 'answered', answer: value, answeredAt: opts.now });
  recheck(next, opts.now);
  return {
    doc: next,
    audit: [
      event(next, 'followup_answered', opts.now, {
        fieldId: key,
        oldValue,
        newValue: value,
        meta: { ruleId: followup.ruleId, via: opts.source === 'speech' ? 'voice' : 'tap' },
      }),
    ],
  };
}

export function skipFollowup(doc: CaseDoc, followupId: string, reason: string, now: string): Change {
  const next = editable(doc, now);
  const followup = next.followups.find((f) => f.id === followupId);
  if (!followup || followup.status !== 'open') throw new CommandError('This question is no longer open');
  if (reason.trim().length < 3) throw new CommandError('Give a short reason');
  Object.assign(followup, { status: 'skipped', skipReason: reason.trim(), answeredAt: now });
  return {
    doc: next,
    audit: [event(next, 'followup_skipped', now, { fieldId: followup.fieldIds[0], meta: { ruleId: followup.ruleId, reason: reason.trim() } })],
  };
}

/** Officer edit from review. null clears the field. Typing a value counts as confirming it. */
export function editField(doc: CaseDoc, key: string, raw: unknown, now: string): Change {
  const next = editable(doc, now);
  const value = raw === null || raw === '' ? null : checkedValue(key, raw);
  const oldValue = next.fields[key]?.value;
  setFieldValue(next, key, value, { source: 'officer_edit', confirmed: true, now, force: true });
  if (next.status === 'draft') next.status = 'in_review';
  recheck(next, now);
  return { doc: next, audit: [event(next, 'field_edited', now, { fieldId: key, oldValue, newValue: value })] };
}

export function confirmFields(doc: CaseDoc, keys: string[], now: string): Change {
  const next = editable(doc, now);
  const audit: AuditEntry[] = [];
  for (const key of keys) {
    const fv = next.fields[key];
    if (!fv || isEmpty(fv.value) || fv.confirmedByOfficer) continue;
    next.fields[key] = { ...fv, confirmedByOfficer: true, updatedAt: now };
    audit.push(event(next, 'field_confirmed', now, { fieldId: key, newValue: fv.value }));
  }
  if (audit.length && next.status === 'draft') next.status = 'in_review';
  return { doc: next, audit };
}

/** Accepting a server suggestion is the officer confirming that value. */
export function acceptProposal(doc: CaseDoc, proposal: Proposal, now: string): Change {
  const next = editable(doc, now);
  const value = checkedValue(proposal.fieldId, proposal.value);
  const oldValue = next.fields[proposal.fieldId]?.value;
  setFieldValue(next, proposal.fieldId, value, {
    source: proposal.source === 'server_vision' ? 'auto' : 'speech',
    confirmed: true,
    transcriptSpan: proposal.evidence?.transcriptSpan,
    now,
    force: true,
  });
  if (next.status === 'draft') next.status = 'in_review';
  recheck(next, now);
  return {
    doc: next,
    audit: [event(next, 'proposal_accepted', now, { fieldId: proposal.fieldId, oldValue, newValue: value, meta: { proposalId: proposal.id, source: proposal.source } })],
    ops: [{ entity: 'proposal', op: 'decide', clientId: proposal.id, payload: { proposalId: proposal.id, status: 'accepted', at: now } }],
    proposalDecisions: [{ id: proposal.id, status: 'accepted' }],
  };
}

export function rejectProposal(doc: CaseDoc, proposal: Proposal, now: string): Change {
  const next = editable(doc, now);
  return {
    doc: next,
    audit: [
      event(next, 'proposal_rejected', now, {
        fieldId: proposal.fieldId,
        oldValue: next.fields[proposal.fieldId]?.value,
        newValue: proposal.value,
        meta: { proposalId: proposal.id, source: proposal.source },
      }),
    ],
    ops: [{ entity: 'proposal', op: 'decide', clientId: proposal.id, payload: { proposalId: proposal.id, status: 'rejected', at: now } }],
    proposalDecisions: [{ id: proposal.id, status: 'rejected' }],
  };
}

/** Why the case cannot be signed yet (empty = it can). */
export function signBlockers(doc: CaseDoc, proposals: Proposal[]): string[] {
  const reasons: string[] = [];
  const unconfirmed = unconfirmedFields(doc);
  if (unconfirmed.length) reasons.push(`${unconfirmed.length} filled field(s) not confirmed`);
  const openRequired = proposals.filter((p) => p.status === 'open' && getField(parseFieldKey(p.fieldId).fieldId)?.required);
  if (openRequired.length) reasons.push(`${openRequired.length} server suggestion(s) for required fields still open`);
  return reasons;
}

export function signCase(doc: CaseDoc, proposals: Proposal[], now: string): Change {
  const next = editable(doc, now);
  const reasons = signBlockers(next, proposals);
  if (reasons.length) throw new CommandError('Not ready to sign', reasons);
  next.status = 'signed';
  next.signedAt = now;
  return { doc: next, audit: [event(next, 'case_signed', now, { meta: { completeness: next.completeness } })] };
}

/** Exporting is allowed after signing; it only adds to the audit trail. */
export function recordExport(doc: CaseDoc, now: string): Change {
  return { doc, audit: [event(doc, 'case_exported', now, { meta: { format: 'edar-json' } })] };
}
