// Language packs are data. Adding a language means adding its JSON here (and in /shared/lang)
// and registering it below; no screen code changes. bn and brx are PLACEHOLDER packs.
import as from './as.json';
import bn from './bn.json';
import brx from './brx.json';
import en from './en.json';

export type LangPack = {
  code: string;
  name: string;
  name_en: string;
  placeholder?: boolean;
  note?: string;
  /** Native digits 0-9, e.g. "০১২৩৪৫৬৭৮৯" */
  digits?: string;
  /** Regex character range of the script's letters, e.g. "\\u0980-\\u09FF" */
  letters?: string;
  numberWords?: Record<string, number>;
  classifiers?: string[];
  approx?: string[];
  ordinals?: Record<string, number>;
  negations?: string[];
  time?: { hourMarkers: string[]; periods: Record<string, string> };
  keywords?: Record<string, Record<string, string[]>>;
  numberCues?: Record<string, { before?: string[]; after?: string[]; zero?: string[] }>;
  textPatterns?: Record<string, { regex: string; template: string }[]>;
  questions?: Record<string, string>;
  ruleQuestions?: Record<string, string>;
  instancePrefix?: Record<string, string>;
  ui?: Record<string, string>;
};

const packs: Record<string, LangPack> = { as, bn, brx, en };

export type LangCode = 'as' | 'bn' | 'brx' | 'en';
/** Languages an officer can record a case in (chosen per case; clips inherit it). */
export type CaseLang = 'as' | 'bn' | 'brx';

export const LANGS: LangCode[] = ['as', 'bn', 'brx', 'en'];
export const CASE_LANGS: CaseLang[] = ['as', 'bn', 'brx'];

export function getLang(code: LangCode | string): LangPack {
  const pack = packs[code];
  if (!pack) throw new Error(`No language pack for "${code}"`);
  return pack;
}

export function isCaseLang(code: string): code is CaseLang {
  return (CASE_LANGS as string[]).includes(code);
}

/** fill('{n} vehicles', { n: 2 }) -> '2 vehicles' */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
