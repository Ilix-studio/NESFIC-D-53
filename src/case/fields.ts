// Pure helpers over a case's field values (port of server/src/utils/caseFields.js).
import { fieldKey, fieldsInSection, isRepeatable, parseFieldKey, schema, type SectionId } from '@/schema';
import type { CaseDoc, Completeness } from './types';

const MAX_INSTANCES = 20;

export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

export function getValue(doc: Pick<CaseDoc, 'fields'>, key: string) {
  return doc.fields[key]?.value;
}

/** Highest instance number that has at least one value in a repeatable section. */
export function describedInstances(doc: Pick<CaseDoc, 'fields'>, section: SectionId): number {
  const ids = new Set(fieldsInSection(section).map((f) => f.id));
  let max = 0;
  for (const [key, fv] of Object.entries(doc.fields)) {
    const { fieldId, index } = parseFieldKey(key);
    if (ids.has(fieldId) && index && !isEmpty(fv.value)) max = Math.max(max, index);
  }
  return max;
}

/** How many vehicles / persons the report should describe. */
export function instanceCount(doc: Pick<CaseDoc, 'fields'>, section: SectionId): number {
  if (!isRepeatable(section)) return 1;
  let n = Math.max(1, describedInstances(doc, section));
  if (section === 'vehicles') {
    const declared = Number(getValue(doc, 'vehicles_count'));
    if (Number.isFinite(declared)) n = Math.max(n, declared);
  }
  return Math.min(n, MAX_INSTANCES);
}

/** Every field key the report is expected to contain, in schema order. */
export function expectedKeys(doc: Pick<CaseDoc, 'fields'>): string[] {
  const keys: string[] = [];
  for (const section of schema.sections) {
    const fields = fieldsInSection(section.id);
    if (!section.repeatable) {
      keys.push(...fields.map((f) => f.id));
      continue;
    }
    const count = instanceCount(doc, section.id);
    for (let i = 1; i <= count; i++) keys.push(...fields.map((f) => fieldKey(f.id, i)));
  }
  return keys;
}

export function computeCompleteness(doc: Pick<CaseDoc, 'fields'>): Completeness {
  const keys = expectedKeys(doc);
  const filled = keys.filter((k) => !isEmpty(getValue(doc, k))).length;
  const total = keys.length;
  return { filled, total, percent: total ? Math.round((filled / total) * 100) : 0 };
}

/** Hour (0-23) from a stored "YYYY-MM-DDTHH:mm" value, or null. */
export function hourOf(datetime: unknown): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(String(datetime ?? ''));
  return m ? Number(m[1]) : null;
}

export function timeOf(datetime: unknown): string {
  const m = /T(\d{2}:\d{2})/.exec(String(datetime ?? ''));
  return m ? m[1] : '';
}
