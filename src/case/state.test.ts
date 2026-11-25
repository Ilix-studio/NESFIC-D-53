import { applyProposals, incomingWins, recheck, setFieldValue } from './state';
import { makeCase, T0 } from './test-helpers';

const at = (minute: number) => `2026-11-23T16:${String(minute).padStart(2, '0')}:00.000Z`;

describe('conflict rule (CLAUDE.md rule 12)', () => {
  const speech = (m: number) => ({ source: 'speech' as const, confirmedByOfficer: false, updatedAt: at(m) });
  const officer = (m: number) => ({ source: 'officer_edit' as const, confirmedByOfficer: true, updatedAt: at(m) });
  const confirmed = (m: number) => ({ source: 'speech' as const, confirmedByOfficer: true, updatedAt: at(m) });

  test('officer_edit or confirmedByOfficer always wins, even against newer data', () => {
    expect(incomingWins(officer(1), speech(9))).toBe(false);
    expect(incomingWins(confirmed(1), speech(9))).toBe(false);
    expect(incomingWins(speech(9), confirmed(1))).toBe(true);
  });

  test('otherwise the newest updatedAt wins', () => {
    expect(incomingWins(speech(1), speech(2))).toBe(true);
    expect(incomingWins(speech(2), speech(1))).toBe(false);
    expect(incomingWins(officer(1), officer(2))).toBe(true);
    expect(incomingWins(undefined, speech(1))).toBe(true);
  });
});

test('speech never overwrites a value the officer edited or confirmed', () => {
  const doc = makeCase();
  setFieldValue(doc, 'lighting', 'night_no_lights', { source: 'officer_edit', confirmed: true, now: T0, force: true });
  setFieldValue(doc, 'weather', 'clear', { source: 'speech', confirmed: true, now: T0 });
  const applied = applyProposals(doc, [{ fieldId: 'lighting', value: 'daylight' }, { fieldId: 'weather', value: 'rain' }], { source: 'speech', now: at(5) });
  expect(applied).toEqual([]);
  expect(doc.fields.lighting.value).toBe('night_no_lights');
  expect(doc.fields.weather.value).toBe('clear');
});

test('proposals for unknown fields, options or instance numbers are dropped', () => {
  const doc = makeCase();
  const applied = applyProposals(
    doc,
    [
      { fieldId: 'weather', value: 'rain' },
      { fieldId: 'weather_made_up', value: 'rain' },
      { fieldId: 'lighting', value: 'moonlight' },
      { fieldId: 'vehicle_type', value: 'truck' },
    ],
    { source: 'speech', now: T0 },
  );
  expect(applied.map((a) => a.fieldId)).toEqual(['weather']);
});

test('recheck keeps answered questions, refreshes open ones, and keeps server questions until their field is filled', () => {
  const doc = recheck(makeCase({ crash_datetime: '2026-11-23T21:00', lighting: 'daylight' }), T0);
  const contradiction = doc.followups.find((f) => f.ruleId === 'nightButDaylight')!;
  contradiction.status = 'answered';
  doc.followups.push({
    ...doc.followups.find((f) => f.fieldIds[0] === 'weather')!,
    id: 'server-1',
    ruleId: 'serverOnly',
    origin: 'server',
  });
  recheck(doc, T0);
  expect(doc.followups.filter((f) => f.ruleId === 'nightButDaylight').map((f) => f.status)).toEqual(['answered']);
  expect(doc.followups.some((f) => f.id === 'server-1')).toBe(true);

  setFieldValue(doc, 'weather', 'rain', { source: 'tap', now: T0 });
  recheck(doc, T0);
  expect(doc.followups.some((f) => f.id === 'server-1')).toBe(false);
  expect(doc.completeness.filled).toBe(3);
});
