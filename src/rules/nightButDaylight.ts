import { getValue, hourOf, timeOf } from '@/case/fields';
import { getField, optionLabel } from '@/schema';
import { optionsOf, ruleQuestion } from './helpers';
import type { Rule } from './index';

const ID = 'nightButDaylight';
const NIGHT_OPTIONS = ['night_street_lights', 'night_lights_not_working', 'night_no_lights'];

// Crash time is between 18:00 and 05:59 but lighting says "Daylight".
export const nightButDaylight: Rule = {
  id: ID,
  kind: 'inconsistent',
  run(doc) {
    const when = getValue(doc, 'crash_datetime');
    const hour = hourOf(when);
    if (getValue(doc, 'lighting') !== 'daylight' || hour === null) return [];
    if (hour >= 6 && hour < 18) return [];
    const lighting = getField('lighting')!;
    return [
      {
        ruleId: ID,
        kind: 'inconsistent',
        fieldIds: ['lighting', 'crash_datetime'],
        answerType: 'enum',
        ...ruleQuestion(doc, ID, (lang) => ({ time: timeOf(when), lighting: optionLabel(lighting, 'daylight', lang) })),
        options: optionsOf(lighting, NIGHT_OPTIONS),
        priority: 0,
      },
    ];
  },
};
