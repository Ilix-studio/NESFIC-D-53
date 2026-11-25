// The case as the phone holds it. Same shape and rules as the server's case document, so the
// pure pipeline (mapper -> rules -> follow-ups) gives the same answers offline.
import type { CaseLang } from '@/lang';
import type { FieldOption, FieldValue, FieldValues, LatLng, TranscriptSpan } from '@/schema';

export type Completeness = { filled: number; total: number; percent: number };
export type CaseStatus = 'draft' | 'in_review' | 'signed';
export type AnswerType = 'enum' | 'number' | 'text' | 'datetime' | 'geo';

/** What a rule returns: a missing field or a contradiction, with the question to ask. */
export type Finding = {
  ruleId: string;
  kind: 'missing' | 'inconsistent';
  fieldIds: string[];
  answerType: AnswerType;
  questionEn: string;
  /** Question in the case language (as, bn or brx). Named like the server field. */
  questionAs: string;
  options: FieldOption[];
  priority: number;
};

export type Followup = Finding & {
  id: string;
  status: 'open' | 'answered' | 'skipped';
  /** 'server' = pulled after sync; kept until answered or skipped. */
  origin: 'phone' | 'server';
  answer?: FieldValue['value'];
  skipReason?: string;
  answeredAt?: string;
  createdAt: string;
};

export type CaseDoc = {
  clientId: string;
  startedAt: string;
  location?: LatLng;
  lang: CaseLang;
  status: CaseStatus;
  signedAt?: string;
  policeStation?: string;
  district?: string;
  officerName?: string;
  officerBadge?: string;
  fields: FieldValues;
  followups: Followup[];
  completeness: Completeness;
  createdAt: string;
  updatedAt: string;
};

export type ProposalSource = 'server_asr' | 'server_llm' | 'server_vision';

/** A value the server suggests after its re-check. The officer accepts or rejects it. */
export type Proposal = {
  id: string;
  caseId: string;
  fieldId: string;
  value: FieldValue['value'];
  currentValue?: FieldValue['value'] | null;
  currentConfirmed: boolean;
  source: ProposalSource;
  evidence?: { clipClientId?: string; engine?: string; transcriptSpan?: TranscriptSpan };
  confidence?: number;
  status: 'open' | 'accepted' | 'rejected' | 'superseded';
  createdAt: string;
  updatedAt: string;
};

export type ClipSection = 'crash' | 'road' | 'vehicles' | 'persons' | 'followup';

export type Clip = {
  clientId: string;
  caseId: string;
  section: ClipSection;
  uri: string;
  mimeType: string;
  durationMs?: number;
  recordedAt: string;
  transcriptText?: string;
  transcriptEngine?: string;
  transcriptLang?: string;
  /** saved -> transcribed (on the phone) | server_only (no offline engine) | failed */
  status: 'saved' | 'transcribed' | 'server_only' | 'failed';
  error?: string;
  filledKeys: string[];
  /** Voice check against the IO's voiceprint; absent = not checked. A mismatch never blocks. */
  speaker?: SpeakerCheck;
};

export type SpeakerCheck = { score: number; match: boolean; engine: string };

export type PhotoChecklistItem = 'road_surface' | 'vehicle_positions' | 'skid_marks' | 'lighting' | 'signs' | 'number_plates' | 'other';

export type Photo = {
  clientId: string;
  caseId: string;
  checklistItem: PhotoChecklistItem;
  uri: string;
  mimeType: string;
  takenAt: string;
  location?: LatLng;
  note?: string;
};

export const AUDIT_TYPES = [
  'case_opened',
  'clip_saved',
  'clip_processed',
  'fields_filled',
  'followup_answered',
  'followup_skipped',
  'field_edited',
  'field_confirmed',
  'photo_added',
  'case_signed',
  'case_exported',
  'language_set',
  'proposal_accepted',
  'proposal_rejected',
  'speaker_mismatch',
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export type AuditEntry = {
  id: string;
  caseId: string;
  type: AuditType;
  fieldId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  meta?: Record<string, unknown>;
  at: string;
};
