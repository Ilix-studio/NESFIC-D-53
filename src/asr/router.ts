// EngineRouter (CLAUDE.md rule 10): the on-device engine always runs first when it can;
// server engines run only after sync and only produce proposals.
import type { CaseLang } from '@/lang';
import { modelStatus } from '@/models/ModelManager';
import { demoAsrEngine } from './demo';
import type { AsrContext, AsrEngine } from './index';
import { onDeviceAsrEngine, onDeviceRuntime } from './on-device';

export type EngineChoice = { engine: AsrEngine; note?: string } | { engine: null; reason: string };

export async function chooseAsrEngine(lang: CaseLang, ctx: AsrContext, opts: { demoEnabled: boolean }): Promise<EngineChoice> {
  const runtime = onDeviceRuntime();
  if (runtime.available && (await modelStatus(lang)).state === 'installed') return { engine: onDeviceAsrEngine };
  if (opts.demoEnabled && demoAsrEngine.has(lang, ctx)) {
    return { engine: demoAsrEngine, note: 'Demo engine: synthetic transcript.' };
  }
  return {
    engine: null,
    reason: 'No offline speech engine for this language on this phone. The clip is saved and will be transcribed on the server after sync.',
  };
}
