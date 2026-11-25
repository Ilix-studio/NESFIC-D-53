// The offline capture pipeline, run on the phone as soon as a clip is saved:
// save clip (SQLite row + file) -> EngineRouter picks an ASR engine -> transcript ->
// rule mapper -> fields + rules + follow-ups. With no offline engine the clip is kept and the
// server transcribes it after sync; its results come back as proposals.
import { chooseAsrEngine } from '@/asr/router';
import type { Repo } from '@/db/repo';
import { ruleMapper } from '@/mapper';
import type { TranscriptSpan } from '@/schema';
import { uuidv7 } from '@/utils/uuid';
import { answerFollowup, applyTranscript } from './commands';
import type { AppliedField } from './state';
import type { ClipSection } from './types';

export type ClipOutcome =
  | { status: 'transcribed'; clipId: string; text: string; engine: string; filled: AppliedField[]; note?: string }
  | { status: 'server_only'; clipId: string; reason: string }
  | { status: 'failed'; clipId: string; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const isDemoEnabled = async (repo: Repo) => (await repo.getMeta('demo_asr')) !== 'off';

async function saveClip(repo: Repo, input: { caseId: string; section: ClipSection; uri: string; mimeType: string; durationMs?: number }) {
  const clipId = uuidv7();
  const now = new Date().toISOString();
  await repo.addClip(
    { clientId: clipId, caseId: input.caseId, section: input.section, uri: input.uri, mimeType: input.mimeType, durationMs: input.durationMs, recordedAt: now, status: 'saved', filledKeys: [] },
    { id: uuidv7(), caseId: input.caseId, type: 'clip_saved', at: now, meta: { clipId, section: input.section, durationMs: input.durationMs } },
  );
  return clipId;
}

/** Saves a section clip and runs the offline pipeline on it. */
export async function captureSectionClip(
  repo: Repo,
  input: { caseId: string; section: ClipSection; uri: string; mimeType: string; durationMs?: number },
): Promise<ClipOutcome> {
  const clipId = await saveClip(repo, input);
  const doc = (await repo.loadCase(input.caseId))!;
  const choice = await chooseAsrEngine(doc.lang, { section: input.section }, { demoEnabled: await isDemoEnabled(repo) });
  if (!choice.engine) {
    await repo.updateClip(clipId, { status: 'server_only' });
    return { status: 'server_only', clipId, reason: choice.reason };
  }
  try {
    const transcript = await choice.engine.transcribe(input.uri, doc.lang, { section: input.section });
    const outcome = await mapClipText(repo, { caseId: input.caseId, clipId, section: input.section, text: transcript.text, engine: transcript.engine });
    return { ...outcome, note: choice.note };
  } catch (err) {
    await repo.updateClip(clipId, { status: 'failed', error: message(err) });
    return { status: 'failed', clipId, error: message(err) };
  }
}

/** Maps a transcript (from an engine, or corrected by the officer) onto the case. */
export async function mapClipText(
  repo: Repo,
  input: { caseId: string; clipId: string; section: ClipSection; text: string; engine: string },
): Promise<Extract<ClipOutcome, { status: 'transcribed' }>> {
  const doc = (await repo.loadCase(input.caseId))!;
  const proposals = await ruleMapper.map({ transcript: { text: input.text, lang: doc.lang }, section: input.section, startedAt: doc.startedAt });
  const now = new Date().toISOString();
  const change = await repo.update(input.caseId, (d) =>
    applyTranscript(d, { clipId: input.clipId, section: input.section, engine: input.engine, proposals, now }),
  );
  await repo.updateClip(input.clipId, {
    status: 'transcribed',
    transcriptText: input.text,
    transcriptEngine: input.engine,
    transcriptLang: doc.lang,
    filledKeys: change.filled.map((f) => f.fieldId),
    error: undefined,
  });
  return { status: 'transcribed', clipId: input.clipId, text: input.text, engine: input.engine, filled: change.filled };
}

export type VoiceAnswer =
  | { understood: true; text: string; value: unknown }
  | { understood: false; text?: string; reason: string };

/** A spoken answer to one follow-up question: transcribe, map only the asked field, answer. */
export async function answerByVoice(
  repo: Repo,
  input: { caseId: string; followupId: string; fieldKey: string; uri: string; mimeType: string; durationMs?: number },
): Promise<VoiceAnswer> {
  const clipId = await saveClip(repo, { ...input, section: 'followup' });
  const doc = (await repo.loadCase(input.caseId))!;
  const ctx = { section: 'followup' as const, targetKeys: [input.fieldKey] };
  const choice = await chooseAsrEngine(doc.lang, ctx, { demoEnabled: await isDemoEnabled(repo) });
  if (!choice.engine) {
    await repo.updateClip(clipId, { status: 'server_only' });
    return { understood: false, reason: 'No offline speech engine for this language. Tap an answer instead.' };
  }
  try {
    const transcript = await choice.engine.transcribe(input.uri, doc.lang, ctx);
    const [hit] = await ruleMapper.map({ transcript: { text: transcript.text, lang: doc.lang }, section: 'followup', startedAt: doc.startedAt, targetKeys: [input.fieldKey] });
    await repo.updateClip(clipId, {
      status: 'transcribed',
      transcriptText: transcript.text,
      transcriptEngine: transcript.engine,
      transcriptLang: doc.lang,
      filledKeys: hit ? [input.fieldKey] : [],
    });
    if (!hit) return { understood: false, text: transcript.text, reason: 'Not understood. Tap an answer or try again.' };
    const span: TranscriptSpan = hit.transcriptSpan;
    await repo.update(input.caseId, (d) =>
      answerFollowup(d, input.followupId, hit.value, { source: 'speech', clipId, transcriptSpan: span, now: new Date().toISOString() }),
    );
    return { understood: true, text: transcript.text, value: hit.value };
  } catch (err) {
    await repo.updateClip(clipId, { status: 'failed', error: message(err) });
    return { understood: false, reason: message(err) };
  }
}
