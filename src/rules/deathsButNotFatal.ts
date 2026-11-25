import { getValue, isEmpty } from '@/case/fields';
import { getField, optionLabel } from '@/schema';
import { optionsOf, ruleQuestion } from './helpers';
import type { Rule } from './index';

const ID = 'deathsButNotFatal';

// persons_killed > 0 but severity is set to something other than "Fatal".
export const deathsButNotFatal: Rule = {
  id: ID,
  kind: 'inconsistent',
  run(doc) {
    const killed = Number(getValue(doc, 'persons_killed'));
    const severity = getValue(doc, 'severity');
    if (!(killed > 0) || isEmpty(severity) || severity === 'fatal') return [];
    const field = getField('severity')!;
    return [
      {
        ruleId: ID,
        kind: 'inconsistent',
        fieldIds: ['severity', 'persons_killed'],
        answerType: 'enum',
        ...ruleQuestion(doc, ID, (lang) => ({ killed, severity: optionLabel(field, String(severity), lang) })),
        options: optionsOf(field),
        priority: 0,
      },
    ];
  },
};
