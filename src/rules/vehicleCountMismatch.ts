import { describedInstances, getValue } from '@/case/fields';
import { numberOptions, ruleQuestion } from './helpers';
import type { Rule } from './index';

const ID = 'vehicleCountMismatch';

// vehicles_count says N but fewer vehicles are described. Waits until at least one vehicle
// has been described, so it does not fire before the vehicles section is recorded.
export const vehicleCountMismatch: Rule = {
  id: ID,
  kind: 'inconsistent',
  run(doc) {
    const count = Number(getValue(doc, 'vehicles_count'));
    const described = describedInstances(doc, 'vehicles');
    if (!(count > 0) || described === 0 || described >= count) return [];
    return [
      {
        ruleId: ID,
        kind: 'inconsistent',
        fieldIds: ['vehicles_count'],
        answerType: 'number',
        ...ruleQuestion(doc, ID, () => ({ count, described })),
        options: numberOptions(described, count),
        priority: 0,
      },
    ];
  },
};
