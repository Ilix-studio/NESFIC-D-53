// Typed client for the VoiceDAR server (/api/v1). Screens call these functions; nothing in
// the app talks to third-party speech or AI APIs directly, and no API keys live in the app.
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type { SectionId } from '@/schema';
import type { PullResult, PushResult, WireOp } from '@/sync/types';
import { API_URL } from './config';
import { getToken } from './session';
import type {
  AnswerResult,
  AuditEvent,
  CaseDetail,
  Clip,
  CaseSummary,
  ClipResult,
  Completeness,
  Followup,
  Health,
  Officer,
  Photo,
  PhotoChecklistItem,
  ServerFieldValue,
  SyncCase,
  SyncResult,
  UploadFile,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  timeoutMs?: number;
};

async function request<T>(path: string, { method = 'GET', body, form, auth = true, timeoutMs = 15_000 }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: controller.signal,
    });
  } catch (err) {
    // Keep the platform's reason (timeout, file not readable, ...) so sync errors can be told apart.
    const reason = controller.signal.aborted ? 'timed out' : err instanceof Error ? err.message : String(err);
    throw new ApiError(0, `Server not reachable at ${API_URL} (${reason})`);
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  return data as T;
}

/**
 * Adds a local file to multipart form data. On web the file is a Blob. On Android / iOS the
 * global fetch is Expo's (SDK 54+), which rejects React Native's { uri, name, type } parts
 * ("Unsupported FormDataPart implementation") but reads any part with bytes(), name and type.
 */
async function appendFile(form: FormData, field: string, file: UploadFile): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append(field, blob, file.name);
    return;
  }
  const source = new File(file.uri);
  const part = { name: file.name, type: file.type, bytes: () => source.bytes() };
  form.append(field, part as unknown as Blob);
}

const UPLOAD_TIMEOUT = 120_000;

// Health and login
export const health = () => request<Health>('/health', { auth: false, timeoutMs: 5_000 });
export const login = (badgeNo: string, password: string) =>
  request<{ token: string; expiresIn: string; officer: Officer }>('/auth/login', { method: 'POST', body: { badgeNo, password }, auth: false });
export const me = () => request<{ officer: Officer }>('/auth/me');

// Cases (":id" accepts the server id or the phone's clientId)
export const createCase = (body: { clientId: string; startedAt: string; location?: { lat: number; lng: number; accuracy?: number } }) =>
  request<{ case: CaseDetail; created: boolean }>('/cases', { method: 'POST', body });
export const listCases = (page = 1, limit = 20) =>
  request<{ items: CaseSummary[]; page: number; limit: number; total: number }>(`/cases?page=${page}&limit=${limit}`);
export const getCase = (id: string) => request<{ case: CaseDetail }>(`/cases/${encodeURIComponent(id)}`);
export const getAudit = (id: string) => request<{ items: AuditEvent[] }>(`/cases/${encodeURIComponent(id)}/audit`);

// Clips: upload -> server runs ASR, field mapping and checks
export async function uploadClip(
  caseId: string,
  clip: { file: UploadFile; section: SectionId; clientId?: string; recordedAt?: string; durationMs?: number },
) {
  const form = new FormData();
  await appendFile(form, 'audio', clip.file);
  form.append('section', clip.section);
  if (clip.clientId) form.append('clientId', clip.clientId);
  if (clip.recordedAt) form.append('recordedAt', clip.recordedAt);
  if (clip.durationMs != null) form.append('durationMs', String(Math.round(clip.durationMs)));
  return request<ClipResult>(`/cases/${encodeURIComponent(caseId)}/clips`, { method: 'POST', form, timeoutMs: UPLOAD_TIMEOUT });
}
export const clipAudioUrl = (caseId: string, clipId: string) => `${API_URL}/cases/${encodeURIComponent(caseId)}/clips/${clipId}/audio`;

// Follow-up questions
export const listFollowups = (caseId: string, status: 'open' | 'answered' | 'skipped' | 'all' = 'open') =>
  request<{ items: Followup[]; completeness: Completeness }>(`/cases/${encodeURIComponent(caseId)}/followups?status=${status}`);
export const answerFollowup = (caseId: string, followupId: string, answer: { code: string } | { value: ServerFieldValue['value'] }) =>
  request<AnswerResult>(`/cases/${encodeURIComponent(caseId)}/followups/${followupId}/answer`, { method: 'POST', body: answer });
export async function answerFollowupByVoice(caseId: string, followupId: string, file: UploadFile) {
  const form = new FormData();
  await appendFile(form, 'audio', file);
  return request<AnswerResult>(`/cases/${encodeURIComponent(caseId)}/followups/${followupId}/answer`, {
    method: 'POST',
    form,
    timeoutMs: UPLOAD_TIMEOUT,
  });
}
export const skipFollowup = (caseId: string, followupId: string, reason: string) =>
  request<{ followup: Followup; followups: Followup[]; completeness: Completeness }>(
    `/cases/${encodeURIComponent(caseId)}/followups/${followupId}/skip`,
    { method: 'POST', body: { reason } },
  );

// Officer review
export const editField = (caseId: string, fieldKey: string, value: ServerFieldValue['value'] | null, reason?: string) =>
  request<{ field: ServerFieldValue | null; followups: Followup[]; completeness: Completeness }>(
    `/cases/${encodeURIComponent(caseId)}/fields/${encodeURIComponent(fieldKey)}`,
    { method: 'PATCH', body: { value, reason } },
  );
export const confirmField = (caseId: string, fieldKey: string) =>
  request<{ field: ServerFieldValue; completeness: Completeness }>(
    `/cases/${encodeURIComponent(caseId)}/fields/${encodeURIComponent(fieldKey)}/confirm`,
    { method: 'POST' },
  );
export const signCase = (caseId: string) => request<{ case: CaseDetail }>(`/cases/${encodeURIComponent(caseId)}/sign`, { method: 'POST' });
export const exportEdar = (caseId: string) => request<Record<string, unknown>>(`/cases/${encodeURIComponent(caseId)}/export/edar`);

// Scene photos
export async function uploadPhoto(
  caseId: string,
  photo: { file: UploadFile; checklistItem: PhotoChecklistItem; takenAt: string; clientId?: string; lat?: number; lng?: number; accuracy?: number; note?: string },
) {
  const form = new FormData();
  await appendFile(form, 'photo', photo.file);
  form.append('checklistItem', photo.checklistItem);
  form.append('takenAt', photo.takenAt);
  for (const key of ['clientId', 'lat', 'lng', 'accuracy', 'note'] as const) {
    if (photo[key] != null) form.append(key, String(photo[key]));
  }
  return request<{ photo: Photo; created: boolean }>(`/cases/${encodeURIComponent(caseId)}/photos`, { method: 'POST', form, timeoutMs: UPLOAD_TIMEOUT });
}
export const listPhotos = (caseId: string) => request<{ items: Photo[] }>(`/cases/${encodeURIComponent(caseId)}/photos`);

// Offline sync
export const syncCases = (cases: SyncCase[]) => request<SyncResult>('/sync/cases', { method: 'POST', body: { cases } });
/** Sends outbox rows; the server applies each opId once (safe to retry). */
export const pushOps = (ops: WireOp[]) => request<PushResult>('/sync/cases', { method: 'POST', body: { ops }, timeoutMs: 30_000 });
export const pull = (since: string | null) =>
  request<PullResult>(`/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, { timeoutMs: 30_000 });

/** Evidence the phone already processed offline: the server stores it and re-checks it later. */
export async function uploadClipEvidence(
  caseId: string,
  clip: { file: UploadFile; section: string; clientId: string; recordedAt: string; durationMs?: number; transcript?: { text: string; lang: string; engine: string } },
) {
  const form = new FormData();
  await appendFile(form, 'audio', clip.file);
  form.append('section', clip.section);
  form.append('clientId', clip.clientId);
  form.append('recordedAt', clip.recordedAt);
  if (clip.durationMs != null) form.append('durationMs', String(Math.round(clip.durationMs)));
  if (clip.transcript) {
    form.append('transcriptText', clip.transcript.text);
    form.append('transcriptLang', clip.transcript.lang);
    form.append('transcriptEngine', clip.transcript.engine);
  }
  return request<{ clip: Clip; queued?: boolean; duplicate?: boolean }>(`/cases/${encodeURIComponent(caseId)}/clips?firstPass=phone`, {
    method: 'POST',
    form,
    timeoutMs: UPLOAD_TIMEOUT,
  });
}

export async function uploadPhotoEvidence(
  caseId: string,
  photo: { file: UploadFile; checklistItem: PhotoChecklistItem; takenAt: string; clientId: string; lat?: number; lng?: number; accuracy?: number; note?: string },
) {
  const form = new FormData();
  await appendFile(form, 'photo', photo.file);
  form.append('checklistItem', photo.checklistItem);
  form.append('takenAt', photo.takenAt);
  for (const key of ['clientId', 'lat', 'lng', 'accuracy', 'note'] as const) {
    if (photo[key] != null) form.append(key, String(photo[key]));
  }
  return request<{ photo: Photo; created: boolean }>(`/cases/${encodeURIComponent(caseId)}/photos?firstPass=phone`, {
    method: 'POST',
    form,
    timeoutMs: UPLOAD_TIMEOUT,
  });
}
