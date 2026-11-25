// Builds in-memory cases for unit tests.
import type { CaseLang } from '@/lang';
import type { FieldValue } from '@/schema';
import type { CaseDoc } from './types';

export const T0 = '2026-11-23T15:44:00.000Z';

export function makeCase(values: Record<string, FieldValue['value']> = {}, lang: CaseLang = 'as'): CaseDoc {
  return {
    clientId: 'case-test',
    startedAt: T0,
    lang,
    status: 'draft',
    fields: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, { value, source: 'speech', confirmedByOfficer: false, updatedAt: T0 }]),
    ),
    followups: [],
    completeness: { filled: 0, total: 0, percent: 0 },
    createdAt: T0,
    updatedAt: T0,
  };
}
