// Missing / inconsistent checks: pure TypeScript, one file per rule, each unit-tested in
// rules.test.ts. The server runs the same checks (server/src/services/rules/).
import type { CaseDoc, Finding } from '@/case/types';
import { deathsButNotFatal } from './deathsButNotFatal';
import { fatalButNoDeaths } from './fatalButNoDeaths';
import { nightButDaylight } from './nightButDaylight';
import { requiredMissing } from './requiredMissing';
import { vehicleCountMismatch } from './vehicleCountMismatch';

export interface Rule {
  readonly id: string;
  readonly kind: Finding['kind'];
  run(doc: CaseDoc): Finding[];
}

export const rules: Rule[] = [nightButDaylight, fatalButNoDeaths, deathsButNotFatal, vehicleCountMismatch, requiredMissing];

export function runRules(doc: CaseDoc): Finding[] {
  return rules.flatMap((rule) => rule.run(doc));
}
