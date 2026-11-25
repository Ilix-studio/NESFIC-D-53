// DEMO engine for prototyping in Expo Go, where no on-device model can run. It ignores the
// audio and returns SYNTHETIC transcripts from test-data/: for Assamese, the "onDevice"
// variant that simulates a weaker phone model (so the server's re-check has something to
// suggest). It is clearly labelled in the app and can be switched off in Offline engines.
import samplesBn from '../../test-data/transcripts.bn.json';
import samples from '../../test-data/transcripts.as.json';
import type { CaseLang } from '@/lang';
import { parseFieldKey } from '@/schema';
import type { AsrContext, AsrEngine, Transcript } from './index';

const SECTIONS: Partial<Record<CaseLang, Record<string, string>>> = {
  as: samples.onDevice.sections,
  bn: samplesBn.sections,
};
const ANSWERS: Partial<Record<CaseLang, Record<string, string>>> = { as: samples.followupAnswers };

function sampleText(lang: CaseLang, { section, targetKeys }: AsrContext): string | undefined {
  if (section === 'followup') {
    const answers = ANSWERS[lang];
    const { fieldId } = parseFieldKey(targetKeys?.[0] ?? '');
    return answers?.[fieldId] ?? answers?._default;
  }
  return SECTIONS[lang]?.[section];
}

export const demoAsrEngine: AsrEngine & { has(lang: CaseLang, ctx: AsrContext): boolean } = {
  name: 'demo',
  label: 'Demo (synthetic transcript)',
  has: (lang, ctx) => sampleText(lang, ctx) !== undefined,
  async transcribe(_audioUri, lang, ctx): Promise<Transcript> {
    const text = sampleText(lang, ctx);
    if (text === undefined) throw new Error(`No demo transcript for ${lang} / ${ctx.section}`);
    // A short pause, so the "Transcribing…" state is visible as it would be on a real model.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { text, lang, engine: 'demo', confidence: 0.6 };
  },
};
