// Keyword + number mapping from a transcript to eDAR field values, driven entirely by the
// language pack (keywords, number words, ordinals, time words, negations). No language is
// hard-coded here. Port of server/src/services/mapper/rule.mapper.js: keep the two in step.
import { getLang, type LangPack } from '@/lang';
import { fieldKey, fieldsInSection, getField, isRepeatable, parseFieldKey, schema, type FieldDef, type SectionId } from '@/schema';
import type { FieldMapper, FieldProposal, MapInput } from './index';

// Officers are in Assam; stored crash times are local (IST, UTC+05:30).
const LOCAL_OFFSET_MIN = 330;
// A word starts at the beginning of the text or after a space / punctuation mark.
const WORD_START = '(?<=^|[\\s,।;:!?"\'(\\-])';
// Script block of the pack's letters (default Bengali-Assamese): stops a number word or a
// negation word matching the start of a longer word.
const DEFAULT_LETTERS = '\\u0980-\\u09FF';
// A negation word ("নাই", "নাছিল") this close after a phrase, in the same clause, cancels it.
const NEGATION_WINDOW = 24;
const CLAUSE_END = /[।,;:!?.\n]/;
// Indian registration plates are written in Latin script whatever the spoken language.
const PLATE_RE = /\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{1,4})\b/;

type Hit = { value: string | number; start: number; end: number };
type Segment = { index: number | null; start: number; end: number };
type Compiled = {
  pack: LangPack;
  notLetterAfter: string;
  negation: RegExp | null;
  numToken: string;
  classifier: string;
  approx: string;
  toNumber: (tok: string) => number | undefined;
};
type MatchOptions = { startedAt?: string; useLabels: boolean; anyNumber: boolean };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = (words: Iterable<string>) => [...words].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

const compiled = new Map<string, Compiled>();

function compile(lang: string): Compiled {
  const cached = compiled.get(lang);
  if (cached) return cached;
  const pack = getLang(lang);
  const words = pack.numberWords ?? {};
  const wordAlt = alternation(Object.keys(words));
  const notLetterAfter = `(?![${pack.letters ?? DEFAULT_LETTERS}])`;
  const c: Compiled = {
    pack,
    notLetterAfter,
    negation: pack.negations?.length ? new RegExp(`${WORD_START}(?:${alternation(pack.negations)})${notLetterAfter}`) : null,
    numToken: wordAlt ? `(\\d+|${wordAlt})` : '(\\d+)',
    classifier: pack.classifiers?.length ? `(?:${alternation(pack.classifiers)})?` : '',
    approx: pack.approx?.length ? `(?:(?:${alternation(pack.approx)})\\s*)?` : '',
    toNumber: (tok) => (/^\d+$/.test(tok) ? Number(tok) : words[tok]),
  };
  compiled.set(lang, c);
  return c;
}

/** Native digits -> ASCII. Each digit is one UTF-16 unit, so offsets stay valid. */
function asciiDigits(text: string, digits?: string): string {
  if (!digits) return text;
  return text.replace(new RegExp(`[${digits}]`, 'g'), (d) => String(digits.indexOf(d)));
}

function findAtWordStart(text: string, phrase: string): number {
  const m = new RegExp(WORD_START + escapeRe(phrase)).exec(text);
  return m ? m.index : -1;
}

function negatedAfter(text: string, end: number, c: Compiled): boolean {
  if (!c.negation) return false;
  let tail = text.slice(end, end + NEGATION_WINDOW);
  const stop = tail.search(CLAUSE_END);
  if (stop >= 0) tail = tail.slice(0, stop);
  return c.negation.test(tail);
}

/** First place a phrase starts a word and is not negated right after (unless it is itself negative). */
function findAffirmed(text: string, phrase: string, c: Compiled): number {
  const selfNegative = c.negation?.test(phrase) ?? false;
  for (const m of text.matchAll(new RegExp(WORD_START + escapeRe(phrase), 'g'))) {
    if (selfNegative || !negatedAfter(text, m.index + phrase.length, c)) return m.index;
  }
  return -1;
}

/** Splits a vehicles/persons transcript on ordinals ("প্ৰথম", "দ্বিতীয়" ...) into instances. */
function segments(text: string, section: string, c: Compiled): Segment[] {
  if (!isRepeatable(section)) return [{ index: null, start: 0, end: text.length }];
  const ordinals = c.pack.ordinals ?? {};
  const alt = alternation(Object.keys(ordinals));
  const marks = alt ? [...text.matchAll(new RegExp(`${WORD_START}(${alt})`, 'g'))] : [];
  if (!marks.length) return [{ index: 1, start: 0, end: text.length }];
  return marks.map((m, i) => ({
    index: ordinals[m[1]],
    start: i === 0 ? 0 : m.index,
    end: i + 1 < marks.length ? marks[i + 1].index : text.length,
  }));
}

function matchEnum(field: FieldDef, text: string, seg: Segment, c: Compiled, { useLabels }: MatchOptions): Hit | null {
  const keywords = c.pack.keywords?.[field.id] ?? {};
  const part = text.slice(seg.start, seg.end);
  let best: (Hit & { len: number; order: number }) | null = null;
  (field.options ?? []).forEach((option, order) => {
    const phrases = [...(keywords[option.code] ?? [])];
    if (useLabels && c.pack.code === 'as' && option.label_as) phrases.push(option.label_as);
    for (const phrase of phrases) {
      const at = findAffirmed(part, phrase, c);
      if (at < 0) continue;
      // Longest phrase wins ("মটৰ চাইকেল" over "চাইকেল"); ties go to the earlier option.
      if (!best || phrase.length > best.len || (phrase.length === best.len && order < best.order)) {
        best = { value: option.code, start: seg.start + at, end: seg.start + at + phrase.length, len: phrase.length, order };
      }
    }
  });
  return best;
}

function matchNumber(field: FieldDef, text: string, seg: Segment, c: Compiled, { anyNumber }: MatchOptions): Hit | null {
  const cues = c.pack.numberCues?.[field.id] ?? {};
  const part = text.slice(seg.start, seg.end);
  const hit = (value: number, index: number, length: number): Hit => ({ value, start: seg.start + index, end: seg.start + index + length });

  for (const phrase of cues.zero ?? []) {
    const at = findAtWordStart(part, phrase);
    if (at >= 0) return hit(0, at, phrase.length);
  }
  for (const cue of cues.before ?? []) {
    const m = new RegExp(`${WORD_START}${c.numToken}${c.classifier}\\s*${escapeRe(cue)}`).exec(part);
    const n = m ? c.toNumber(m[1]) : undefined;
    if (m && n != null) return hit(n, m.index, m[0].length);
  }
  for (const cue of cues.after ?? []) {
    const m = new RegExp(`${WORD_START}${escapeRe(cue)}\\s*${c.approx}${c.numToken}${c.notLetterAfter}`).exec(part);
    const n = m ? c.toNumber(m[1]) : undefined;
    if (m && n != null) return hit(n, m.index, m[0].length);
  }
  if (anyNumber) {
    const m = new RegExp(`${WORD_START}${c.numToken}${c.classifier}${c.notLetterAfter}`).exec(part);
    const n = m ? c.toNumber(m[1]) : undefined;
    if (m && n != null) return hit(n, m.index, m[0].length);
  }
  return null;
}

function matchTime(text: string, seg: Segment, c: Compiled, startedAt?: string): Hit | null {
  const t = c.pack.time;
  if (!t?.hourMarkers?.length) return null;
  const part = text.slice(seg.start, seg.end);
  const periods = alternation(Object.keys(t.periods ?? {}));
  const re = new RegExp(`${WORD_START}(?:(${periods || '(?!)'})\\s*)?${c.approx}${c.numToken}\\s*(?:${alternation(t.hourMarkers)})`);
  const m = re.exec(part);
  if (!m) return null;
  let hour = c.toNumber(m[2]);
  if (hour == null || hour > 24) return null;
  const period = m[1] ? t.periods[m[1]] : null;
  if ((period === 'afternoon' || period === 'evening') && hour < 12) hour += 12;
  if (period === 'night' && hour >= 6 && hour < 12) hour += 12;
  if (period === 'noon' && hour < 6) hour += 12;
  hour %= 24;

  // Date comes from when the case was opened (local time). A crash time later than that
  // must have been the previous day (e.g. case opened 00:30, crash at 23:00).
  const opened = new Date(new Date(startedAt ?? Date.now()).getTime() + LOCAL_OFFSET_MIN * 60_000);
  const openedMinutes = opened.getUTCHours() * 60 + opened.getUTCMinutes();
  if (hour * 60 > openedMinutes + 30) opened.setUTCDate(opened.getUTCDate() - 1);
  const date = opened.toISOString().slice(0, 10);
  return { value: `${date}T${String(hour).padStart(2, '0')}:00`, start: seg.start + m.index, end: seg.start + m.index + m[0].length };
}

function matchPlate(text: string, seg: Segment): Hit | null {
  const m = PLATE_RE.exec(text.slice(seg.start, seg.end));
  if (!m) return null;
  const [, state, district, series, number] = m;
  return { value: `${state}${district.padStart(2, '0')} ${series} ${number}`, start: seg.start + m.index, end: seg.start + m.index + m[0].length };
}

function matchTextPattern(field: FieldDef, text: string, seg: Segment, c: Compiled): Hit | null {
  const part = text.slice(seg.start, seg.end);
  for (const p of c.pack.textPatterns?.[field.id] ?? []) {
    const m = new RegExp(p.regex).exec(part);
    if (m) {
      const value = p.template.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? '');
      return { value, start: seg.start + m.index, end: seg.start + m.index + m[0].length };
    }
  }
  return null;
}

function matchField(field: FieldDef, text: string, seg: Segment, c: Compiled, opts: MatchOptions): Hit | null {
  switch (field.type) {
    case 'enum':
      return matchEnum(field, text, seg, c, opts);
    case 'number':
      return matchNumber(field, text, seg, c, opts);
    case 'datetime':
      return matchTime(text, seg, c, opts.startedAt);
    case 'text':
      return field.id === 'registration_number' ? matchPlate(text, seg) : matchTextPattern(field, text, seg, c);
    default:
      return null; // geo comes from GPS, not speech
  }
}

const singleFields = () => schema.fields.filter((f) => !isRepeatable(f.section));

export const ruleMapper: FieldMapper = {
  name: 'rule',
  async map({ transcript, section, startedAt, targetKeys }: MapInput): Promise<FieldProposal[]> {
    const raw = transcript.text ?? '';
    const c = compile(transcript.lang ?? 'as');
    const text = asciiDigits(raw, c.pack.digits);
    const proposals: FieldProposal[] = [];
    const push = (key: string, hit: Hit, confidence = 0.7) =>
      proposals.push({
        fieldId: key,
        value: hit.value,
        confidence,
        transcriptSpan: { start: hit.start, end: hit.end, text: raw.slice(hit.start, hit.end) },
      });

    // Follow-up answer: only the asked field, and the whole clip is about it.
    if (targetKeys?.length) {
      const whole: Segment = { index: null, start: 0, end: text.length };
      for (const key of targetKeys) {
        const field = getField(parseFieldKey(key).fieldId);
        if (!field) continue;
        const hit = matchField(field, text, whole, c, { startedAt, useLabels: true, anyNumber: true });
        if (hit) push(key, hit, 0.8);
        else if (field.type === 'text' && raw.trim()) push(key, { value: raw.trim(), start: 0, end: raw.length }, 0.5);
      }
      return proposals;
    }

    // crash / road clips fill the single-instance fields; vehicles / persons clips fill
    // their own section, one instance per ordinal.
    const fields = isRepeatable(section) ? fieldsInSection(section as SectionId) : singleFields();
    for (const seg of segments(text, section, c)) {
      for (const field of fields) {
        const hit = matchField(field, text, seg, c, { startedAt, useLabels: false, anyNumber: false });
        if (hit) push(fieldKey(field.id, seg.index), hit);
      }
    }
    return proposals;
  },
};
