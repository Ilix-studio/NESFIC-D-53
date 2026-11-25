// In-memory changes to a case: field values with evidence, follow-ups, completeness.
// Port of server/src/services/caseState.js; no storage here (the repository saves).
import { runRules } from '@/rules';
import { coerceValue, fieldForKey, type FieldSource, type FieldValue, type TranscriptSpan } from '@/schema';
import { uuidv7 } from '@/utils/uuid';
import { computeCompleteness, isEmpty } from './fields';
import type { CaseDoc, Finding, Followup } from './types';

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Protectable = { source: FieldSource; confirmedByOfficer?: boolean };
export const isProtected = (fv: Protectable) => fv.source === 'officer_edit' || Boolean(fv.confirmedByOfficer);

/**
 * Conflict rule for one field (CLAUDE.md rule 12): an officer_edit or officer-confirmed value
 * beats any other value; between two values of the same kind the newer updatedAt wins.
 * Returns true if the incoming value should replace the existing one.
 */
export function incomingWins(existing: (Protectable & { updatedAt: string }) | undefined, incoming: Protectable & { updatedAt: string }): boolean {
  if (!existing) return true;
  const mine = isProtected(existing);
  const theirs = isProtected(incoming);
  if (mine !== theirs) return theirs;
  return new Date(incoming.updatedAt).getTime() > new Date(existing.updatedAt).getTime();
}

type SetOptions = {
  source: FieldSource;
  clipId?: string;
  transcriptSpan?: TranscriptSpan;
  confirmed?: boolean;
  now: string;
  /** An explicit officer action may replace an officer value. */
  force?: boolean;
};

/**
 * Sets one field value. Values the officer edited or confirmed are never overwritten unless
 * force is set. A null value removes the field.
 */
export function setFieldValue(doc: CaseDoc, key: string, value: FieldValue['value'] | null, opts: SetOptions) {
  const existing = doc.fields[key];
  const oldValue = existing?.value;
  if (existing && !opts.force && isProtected(existing)) return { changed: false, oldValue };
  if (value === null || isEmpty(value)) {
    if (!existing) return { changed: false, oldValue };
    const { [key]: _removed, ...rest } = doc.fields;
    doc.fields = rest;
    return { changed: true, oldValue };
  }
  const next: FieldValue = {
    value,
    source: opts.source,
    confirmedByOfficer: opts.confirmed ?? false,
    updatedAt: opts.now,
    ...(opts.clipId ? { clipId: opts.clipId } : {}),
    ...(opts.transcriptSpan ? { transcriptSpan: opts.transcriptSpan } : {}),
  };
  doc.fields = { ...doc.fields, [key]: next };
  return { changed: !existing || !sameValue(oldValue, value) || existing.source !== opts.source, oldValue };
}

export type MapperProposal = { fieldId: string; value: unknown; transcriptSpan?: TranscriptSpan; confidence?: number };
export type AppliedField = { fieldId: string; value: FieldValue['value']; oldValue?: unknown; transcriptSpan?: TranscriptSpan };

/** Applies mapper proposals, dropping any field id or value the schema does not allow. */
export function applyProposals(doc: CaseDoc, proposals: MapperProposal[], opts: { source: FieldSource; clipId?: string; now: string }): AppliedField[] {
  const applied: AppliedField[] = [];
  for (const p of proposals) {
    const field = fieldForKey(p.fieldId);
    if (!field) continue;
    const checked = coerceValue(field, p.value);
    if (!checked.ok) continue;
    const result = setFieldValue(doc, p.fieldId, checked.value, { ...opts, transcriptSpan: p.transcriptSpan });
    if (result.changed) applied.push({ fieldId: p.fieldId, value: checked.value, oldValue: result.oldValue, transcriptSpan: p.transcriptSpan });
  }
  return applied;
}

export const followupKey = (f: Pick<Finding, 'ruleId' | 'fieldIds'>) => `${f.ruleId}|${f.fieldIds.join(',')}`;

/**
 * Keeps answered and skipped questions and replaces open ones with the current findings. An
 * open question that is still valid keeps its id. Open questions pulled from the server stay
 * until answered or skipped, except "missing" ones whose fields have since been filled.
 */
export function mergeFollowups(doc: CaseDoc, findings: Finding[], now: string): void {
  const closed = doc.followups.filter((f) => f.status !== 'open');
  const closedKeys = new Set(closed.map(followupKey));
  const openByKey = new Map(doc.followups.filter((f) => f.status === 'open').map((f) => [followupKey(f), f]));
  const next: Followup[] = [...closed];
  const seen = new Set<string>();
  for (const finding of findings) {
    const key = followupKey(finding);
    if (closedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    const existing = openByKey.get(key);
    next.push(existing ? { ...existing, ...finding, origin: 'phone' } : { ...finding, id: uuidv7(), status: 'open', origin: 'phone', createdAt: now });
  }
  for (const [key, f] of openByKey) {
    if (seen.has(key) || f.origin !== 'server') continue;
    const stillMissing = f.kind !== 'missing' || f.fieldIds.some((k) => isEmpty(doc.fields[k]?.value));
    if (stillMissing) next.push(f);
  }
  doc.followups = next;
}

/** Contradictions first, then by priority (1 = ask first), then oldest first. */
export function sortFollowups<T extends Pick<Followup, 'kind' | 'priority' | 'createdAt'>>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      (a.kind === 'inconsistent' ? 0 : 1) - (b.kind === 'inconsistent' ? 0 : 1) ||
      a.priority - b.priority ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

export function openFollowups(doc: CaseDoc): Followup[] {
  return sortFollowups(doc.followups.filter((f) => f.status === 'open'));
}

export function unconfirmedFields(doc: CaseDoc): string[] {
  return Object.entries(doc.fields)
    .filter(([, fv]) => !isEmpty(fv.value) && !fv.confirmedByOfficer)
    .map(([key]) => key);
}

/** Re-runs every rule, refreshes the follow-ups and recomputes completeness. */
export function recheck(doc: CaseDoc, now: string): CaseDoc {
  mergeFollowups(doc, runRules(doc), now);
  doc.completeness = computeCompleteness(doc);
  return doc;
}
