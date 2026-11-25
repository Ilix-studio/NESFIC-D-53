// JS side of the native on-device speech module (android/.../VoicedarAsrModule.kt). It exists
// only in the development build: in Expo Go and on web the module is null.
import { requireOptionalNativeModule } from 'expo';

export type TranscribeOptions = {
  sampleRate: number;
  tokenOffset: number;
  langVocabSize: number;
  blankId: number;
  minSeconds: number;
  maxSeconds: number;
};

export type NativeTranscript = {
  /** Token ids and mean token probability for each piece of the clip (pieces cut at pauses). */
  pieces: { ids: number[]; confidence: number }[];
  audioMs: number;
  elapsedMs: number;
};

type VoicedarAsrModule = {
  transcribe(modelUri: string, audioUri: string, options: TranscribeOptions): Promise<NativeTranscript>;
  /** Frees the loaded model (about 200 MB). */
  release(): void;
};

export const VoicedarAsr = requireOptionalNativeModule<VoicedarAsrModule>('VoicedarAsr');
