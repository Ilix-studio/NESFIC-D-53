// On-device speech models (OFFLINE-PLAN phase O3). Models are NOT bundled in the APK: the app
// downloads them once over station Wi-Fi from our own server (GET /models/:id/file) and checks
// the SHA-256 pinned here before use, so a swapped file on the server is rejected.
// The list is data/speech-models.json, a copy of shared/models (npm run sync-shared).
import { API_URL } from '@/api/config';
import type { CaseLang } from '@/lang';
import asTokens from './data/indicconformer-as-int8.tokens.json';
import brxTokens from './data/indicconformer-brx-int8.tokens.json';
import speechModels from './data/speech-models.json';

export type ModelEntry = {
  id: string;
  lang: CaseLang;
  label: string;
  url: string;
  sizeBytes: number;
  sha256: string;
  sampleRate: number;
  tokenOffset: number;
  langVocabSize: number;
  blankId: number;
  tokens: Record<string, string>;
};

const TOKENS: Record<string, Record<string, string>> = {
  'indicconformer-as-int8.tokens.json': asTokens,
  'indicconformer-brx-int8.tokens.json': brxTokens,
};

export const MODEL_MANIFEST: ModelEntry[] = speechModels.models.map((m) => ({
  id: m.id,
  lang: m.lang as CaseLang,
  label: m.label,
  url: `${API_URL}/models/${m.id}/file`,
  sizeBytes: m.sizeBytes,
  sha256: m.sha256,
  sampleRate: m.sampleRate,
  tokenOffset: m.tokenOffset,
  langVocabSize: m.langVocabSize,
  blankId: m.blankId,
  tokens: TOKENS[m.tokens],
}));
