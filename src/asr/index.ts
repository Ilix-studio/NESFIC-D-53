// Speech-to-text sits behind this interface so engines can be swapped without touching screens.
// The EngineRouter (router.ts) picks one per clip: the on-device model when it is installed,
// else the demo engine (synthetic transcripts, development only), else none: the clip is
// saved and the server transcribes it after sync. No engine here calls a third-party API.
import type { ClipSection } from '@/case/types';
import type { CaseLang } from '@/lang';

export type Transcript = { text: string; lang: CaseLang; engine: string; confidence?: number };

export type AsrContext = { section: ClipSection; targetKeys?: string[] };

export interface AsrEngine {
  readonly name: string;
  /** Shown to the officer, e.g. "On-device (IndicConformer)". */
  readonly label: string;
  transcribe(audioUri: string, lang: CaseLang, ctx: AsrContext): Promise<Transcript>;
}
