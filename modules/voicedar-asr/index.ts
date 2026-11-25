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

export type SpeakerOptions = { sampleRate: number; melBins: number };

/** A voiceprint scaled to length 1 (null when the clip is under 25 ms), and the clip length. */
export type NativeVoiceprint = { embedding: number[] | null; seconds: number };

type VoicedarAsrModule = {
  transcribe(modelUri: string, audioUri: string, options: TranscribeOptions): Promise<NativeTranscript>;
  /** Officer voice check: the clip's voiceprint from the WeSpeaker model (Fbank.kt + ONNX). */
  embedSpeaker(modelUri: string, audioUri: string, options: SpeakerOptions): Promise<NativeVoiceprint>;
  /** Frees the loaded models (speech about 200 MB, speaker about 27 MB). */
  release(): void;
};

export const VoicedarAsr = requireOptionalNativeModule<VoicedarAsrModule>('VoicedarAsr');
