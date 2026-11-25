// Shared wording helpers for rules (port of server/src/services/rules/helpers.js). Pure.
import { getValue } from '@/case/fields';
import type { CaseDoc } from '@/case/types';
import { fill, getLang } from '@/lang';
import { getField, optionLabel, parseFieldKey, type FieldDef, type FieldOption } from '@/schema';

/** Writes ASCII digits in the language pack's own digits (e.g. 21:00 -> ২১:০০). */
function localDigits(text: string, lang: string): string {
  const digits = getLang(lang).digits;
  return digits ? text.replace(/[0-9]/g, (d) => digits[Number(d)]) : text;
}

export function optionsOf(field: FieldDef, codes?: string[]): FieldOption[] {
  return (field.options ?? [])
    .filter((o) => !codes || codes.includes(o.code))
    .map(({ code, label_en, label_as }) => ({ code, label_en, label_as }));
}

export function numberOptions(...numbers: number[]): FieldOption[] {
  return [...new Set(numbers)].map((n) => ({ code: String(n), label_en: String(n), label_as: String(n) }));
}

// " (Truck)" after "Vehicle 1", so the officer knows which vehicle or person is meant.
function instanceDetail(doc: CaseDoc, section: string, index: number, lang: string): string {
  const detailField = ({ vehicles: 'vehicle_type', persons: 'person_role' } as Record<string, string>)[section];
  const code = detailField && getValue(doc, `${detailField}@${index}`);
  return code ? ` (${optionLabel(getField(detailField)!, String(code), lang)})` : '';
}

/** Question for a missing field in English and the case's language. */
export function fieldQuestion(doc: CaseDoc, key: string) {
  const { fieldId, index } = parseFieldKey(key);
  const field = getField(fieldId)!;
  const make = (lang: string) => {
    const pack = getLang(lang);
    const label = lang === 'as' ? field.label_as : field.label_en;
    const base = pack.questions?.[fieldId] ?? getLang('en').questions?.[fieldId] ?? label;
    if (!index) return base;
    const prefix = pack.instancePrefix?.[field.section] ?? getLang('en').instancePrefix?.[field.section] ?? '{n}{detail}: ';
    return fill(prefix, { n: index, detail: instanceDetail(doc, field.section, index, lang) }) + base;
  };
  return { questionEn: make('en'), questionAs: localDigits(make(doc.lang), doc.lang) };
}

/** Question for an inconsistency; vars(lang) supplies the values in that language. */
export function ruleQuestion(doc: CaseDoc, ruleId: string, vars: (lang: string) => Record<string, string | number>) {
  const en = getLang('en').ruleQuestions![ruleId];
  return {
    questionEn: fill(en, vars('en')),
    questionAs: localDigits(fill(getLang(doc.lang).ruleQuestions?.[ruleId] ?? en, vars(doc.lang)), doc.lang),
  };
}
