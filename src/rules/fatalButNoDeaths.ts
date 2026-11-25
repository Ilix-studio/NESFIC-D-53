import { getValue, isEmpty } from '@/case/fields';
import { getField, optionLabel } from '@/schema';
import { numberOptions, ruleQuestion } from './helpers';
import type { Rule } from './index';

const ID = 'fatalButNoDeaths';

// Severity is "Fatal" but persons_killed is 0 or empty.
export const fatalButNoDeaths: Rule = {
  id: ID,
  kind: 'inconsistent',
  run(doc) {
    if (getValue(doc, 'severity') !== 'fatal') return [];
    const killed = getValue(doc, 'persons_killed');
    if (!isEmpty(killed) && Number(killed) > 0) return [];
    return [
      {
        ruleId: ID,
        kind: 'inconsistent',
        fieldIds: ['persons_killed', 'severity'],
        answerType: 'number',
        ...ruleQuestion(doc, ID, (lang) => ({ severity: optionLabel(getField('severity')!, 'fatal', lang) })),
        options: numberOptions(1, 2, 3),
        priority: 0,
      },
    ];
  },
};
