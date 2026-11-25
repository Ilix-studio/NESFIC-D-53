import { expectedKeys, getValue, isEmpty } from '@/case/fields';
import type { Finding } from '@/case/types';
import { getField, parseFieldKey } from '@/schema';
import { fieldQuestion, optionsOf } from './helpers';
import type { Rule } from './index';

const ID = 'requiredMissing';

// A required field is still empty. Repeatable fields are checked for every vehicle / person.
export const requiredMissing: Rule = {
  id: ID,
  kind: 'missing',
  run(doc) {
    const findings: Finding[] = [];
    for (const key of expectedKeys(doc)) {
      const field = getField(parseFieldKey(key).fieldId)!;
      if (!field.required || !isEmpty(getValue(doc, key))) continue;
      findings.push({
        ruleId: ID,
        kind: 'missing',
        fieldIds: [key],
        answerType: field.type === 'photo' ? 'text' : field.type,
        ...fieldQuestion(doc, key),
        options: field.type === 'enum' ? optionsOf(field) : [],
        priority: field.priority,
      });
    }
    return findings;
  },
};
