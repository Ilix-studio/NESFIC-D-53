// Shapes returned by the VoiceDAR server (server/src). Keep in step with server/CLAUDE.md.
import type { FieldOption, FieldSource, LatLng, SectionId, TranscriptSpan } from '@/schema';

export type Officer = {
  _id: string;
  name: string;
  badgeNo: string;
  policeStation: string;
  district: string;
  role: 'io' | 'supervisor' | 'admin';
  /** Set once the IO has read a passage aloud (POST /voice/enrol). */
  voice?: OfficerVoice;
};

/** The IO's voiceprint: 256 numbers from the speaker model, not the recording itself. */
export type OfficerVoice = {
  lang: string;
  passageId: string;
  model: string;
  embedding: number[];
  seconds: number;
  enrolledAt: string;
};

export type VoicePassage = { id: string; lang: string; status: 'draft' | 'placeholder' | 'reviewed'; text: string; en: string };

export type Health = {
  status: 'ok' | 'degraded';
  db: string;
  engines: { asr: string; mapper: string };
  schema: { id: string; version: string; placeholder: boolean };
  time: string;
};

export type Completeness = { filled: number; total: number; percent: number };
export type CaseStatus = 'draft' | 'in_review' | 'signed' | 'exported';

export type ServerFieldValue = {
  fieldId: string;
  value: string | number | LatLng;
  source: FieldSource;
  clip?: string;
  transcriptSpan?: TranscriptSpan;
  confirmedByOfficer: boolean;
  updatedAt: string;
};

export type Followup = {
  _id: string;
  ruleId: string;
  kind: 'missing' | 'inconsistent';
  fieldIds: string[];
  answerType: 'enum' | 'number' | 'text' | 'datetime' | 'geo';
  questionEn: string;
  questionAs: string;
  options: FieldOption[];
  priority: number;
  status: 'open' | 'answered' | 'skipped';
  skipReason?: string;
  answer?: unknown;
  answeredAt?: string;
  createdAt: string;
};

export type CaseSummary = {
  _id: string;
  clientId: string;
  status: CaseStatus;
  startedAt: string;
  completeness: Completeness;
  policeStation: string;
  district: string;
  signedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CaseDetail = CaseSummary & {
  officer: string;
  location?: { type: 'Point'; coordinates: [number, number]; accuracy?: number };
  fields: ServerFieldValue[];
  followups: Followup[];
  locked: boolean;
  signedBy?: string;
  schemaVersion: string;
  langPack: string;
};

export type Clip = {
  _id: string;
  case: string;
  clientId?: string;
  section: SectionId | 'followup';
  mimeType: string;
  durationMs?: number;
  recordedAt: string;
  transcript?: { text: string; lang: string; engine: string; confidence?: number };
  processingStatus: 'pending' | 'done' | 'failed';
  error?: string;
};

export type ClipResult = {
  clip: Clip;
  duplicate?: boolean;
  filledFields: { fieldId: string; value: ServerFieldValue['value']; oldValue?: unknown; transcriptSpan?: TranscriptSpan }[];
  followups: Followup[];
  completeness: Completeness;
};

export type AnswerResult = {
  understood: boolean;
  transcript?: Clip['transcript'];
  followup: Followup;
  field?: ServerFieldValue;
  followups: Followup[];
  completeness: Completeness;
};

export type PhotoChecklistItem = 'road_surface' | 'vehicle_positions' | 'skid_marks' | 'lighting' | 'signs' | 'number_plates' | 'other';

export type Photo = {
  _id: string;
  case: string;
  clientId?: string;
  checklistItem: PhotoChecklistItem;
  mimeType: string;
  takenAt: string;
  location?: { type: 'Point'; coordinates: [number, number]; accuracy?: number };
  note?: string;
};

export type AuditEvent = {
  _id: string;
  type: string;
  fieldId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  meta?: Record<string, unknown>;
  officer?: { name: string; badgeNo: string };
  at: string;
};

export type SyncCase = {
  clientId: string;
  startedAt: string;
  location?: LatLng;
  status?: 'draft' | 'in_review' | 'signed';
  signedAt?: string;
  fields: (Omit<ServerFieldValue, 'clip'> & { value: ServerFieldValue['value'] | null })[];
};

export type SyncResult = {
  results: {
    clientId: string;
    id?: string;
    status: 'created' | 'updated' | 'locked' | 'forbidden' | 'error';
    caseStatus?: CaseStatus;
    fieldsApplied?: number;
    rejected?: { fieldId: string; reason: string }[];
    completeness?: Completeness;
  }[];
};

/** A local file to upload (from expo-audio, expo-image-picker or expo-file-system). */
export type UploadFile = { uri: string; name: string; type: string };
