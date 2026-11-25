// Officer voice check on the phone, offline: the clip's voiceprint (native module: Fbank.kt +
// WeSpeaker ONNX) compared with the IO's voiceprint from enrolment. Mirrors the server's
// src/services/speaker. A mismatch is flagged for review and in the audit trail; it never blocks.
import { Platform } from 'react-native';

import type { OfficerVoice } from '@/api/types';
import { API_URL } from '@/api/config';
import type { SpeakerCheck } from '@/case/types';
import { modelFile } from '@/models/ModelManager';
import { VoicedarAsr } from '../../modules/voicedar-asr';
import passages from './data/passages.json';
import speakerModels from '../models/data/speaker-models.json';

const entry = speakerModels.models[0];

/** The speaker model, downloaded once over Wi-Fi like the speech models (SHA-256 pinned). */
export const SPEAKER_MODEL = {
  id: entry.id,
  label: entry.label,
  url: `${API_URL}/models/${entry.id}/file`,
  sizeBytes: entry.sizeBytes,
  sha256: entry.sha256,
  sampleRate: entry.sampleRate,
  melBins: entry.melBins,
  threshold: entry.matchThreshold,
};

export const VOICE_PASSAGES = passages.passages;
export const MIN_ENROL_SECONDS = passages.minSeconds;

// Shorter clips do not carry enough voice to judge (same as the server).
const MIN_CLIP_SECONDS = 1.5;

export function speakerModelInstalled(): boolean {
  if (Platform.OS === 'web' || !VoicedarAsr) return false;
  try {
    return modelFile(SPEAKER_MODEL).exists;
  } catch {
    return false;
  }
}

export const cosine = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);

/** null when there is nothing to compare: no voiceprint, no model or module, or a short clip. */
export async function checkSpeaker(audioUri: string, voice?: OfficerVoice): Promise<SpeakerCheck | null> {
  if (!voice?.embedding?.length || voice.model !== SPEAKER_MODEL.id || !VoicedarAsr || !speakerModelInstalled()) return null;
  const { embedding, seconds } = await VoicedarAsr.embedSpeaker(modelFile(SPEAKER_MODEL).uri, audioUri, {
    sampleRate: SPEAKER_MODEL.sampleRate,
    melBins: SPEAKER_MODEL.melBins,
  });
  if (!embedding || seconds < MIN_CLIP_SECONDS) return null;
  const score = Math.round(cosine(embedding, voice.embedding) * 1000) / 1000;
  return { score, match: score >= SPEAKER_MODEL.threshold, engine: SPEAKER_MODEL.id };
}
