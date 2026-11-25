// On-device speech-to-text: AI4Bharat IndicConformer, int8 ONNX, one model per language
// (OFFLINE-PLAN phase O4), run by the native module in modules/voicedar-asr (decode the clip,
// ONNX Runtime, greedy CTC). Needs the development build: Expo Go and web have no native
// module, so the engine reports itself unavailable there and the router falls back.
// Model files are managed by src/models/ModelManager.ts.
import Constants, { ExecutionEnvironment } from 'expo-constants';

import type { CaseLang } from '@/lang';
import { modelFile, modelFor } from '@/models/ModelManager';
import { VoicedarAsr } from '../../modules/voicedar-asr';
import { joinPieces, tokenTable } from './ctc';
import type { AsrContext, AsrEngine, Transcript } from './index';

// Same cut as the server (src/services/asr/indicconformer.asr.js): the int8 export loses
// words when one pass holds more than about 14 s of speech.
const CHUNKING = { minSeconds: 4, maxSeconds: 12 };

export function onDeviceRuntime(): { available: boolean; reason?: string } {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return { available: false, reason: 'Expo Go cannot run on-device models. Install the development build.' };
  }
  if (!VoicedarAsr) return { available: false, reason: 'This build has no on-device speech module (Android development build only).' };
  return { available: true };
}

const tables = new Map<string, string[]>();

export const onDeviceAsrEngine: AsrEngine = {
  name: 'indicconformer',
  label: 'On-device (IndicConformer)',
  async transcribe(audioUri: string, lang: CaseLang, _ctx: AsrContext): Promise<Transcript> {
    const runtime = onDeviceRuntime();
    if (!VoicedarAsr) throw new Error(runtime.reason);
    const entry = modelFor(lang);
    const file = entry && modelFile(entry);
    if (!entry || !file?.exists) throw new Error('The speech model for this language is not downloaded.');
    if (!tables.has(entry.id)) tables.set(entry.id, tokenTable(entry.tokens));

    const result = await VoicedarAsr.transcribe(file.uri, audioUri, {
      sampleRate: entry.sampleRate,
      tokenOffset: entry.tokenOffset,
      langVocabSize: entry.langVocabSize,
      blankId: entry.blankId,
      ...CHUNKING,
    });
    const { text, confidence } = joinPieces(result.pieces, tables.get(entry.id)!);
    return { text, lang, engine: 'indicconformer', confidence };
  },
};
