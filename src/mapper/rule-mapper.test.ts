import samplesBn from '../../test-data/transcripts.bn.json';
import samples from '../../test-data/transcripts.as.json';
import type { CaseLang } from '@/lang';
import { ruleMapper } from './rule-mapper';

// 23 Nov 2026, 21:14 IST
const startedAt = '2026-11-23T15:44:00Z';
type Section = 'crash' | 'road' | 'vehicles' | 'persons';

const mapText = async (text: string, section: Section, lang: CaseLang = 'as') =>
  Object.fromEntries((await ruleMapper.map({ transcript: { text, lang }, section, startedAt })).map((p) => [p.fieldId, p.value]));

describe('offline rule mapper on synthetic Assamese transcripts', () => {
  test.each(['road', 'vehicles', 'persons'] as const)('%s section gives the expected fields', async (section) => {
    expect(await mapText(samples.sections[section], section)).toEqual(samples.expected[section]);
  });

  test('crash section: "ৰাতি প্ৰায় ন বজাত" becomes 21:00 on the day the case was opened', async () => {
    const { crash_datetime, ...rest } = await mapText(samples.sections.crash, 'crash');
    expect(crash_datetime).toBe('2026-11-23T21:00');
    const { crash_datetime: _ignored, ...expectedRest } = samples.expected.crash;
    expect(rest).toEqual(expectedRest);
  });

  test('every proposal keeps its transcript span', async () => {
    const text = samples.sections.road;
    const proposals = await ruleMapper.map({ transcript: { text, lang: 'as' }, section: 'road', startedAt });
    for (const p of proposals) expect(text.slice(p.transcriptSpan.start, p.transcriptSpan.end)).toBe(p.transcriptSpan.text);
  });

  test('follow-up answers map only the asked field', async () => {
    const proposals = await ruleMapper.map({
      transcript: { text: samples.followupAnswers.lighting, lang: 'as' },
      section: 'followup',
      targetKeys: ['lighting'],
    });
    expect(proposals).toEqual([expect.objectContaining({ fieldId: 'lighting', value: 'night_lights_not_working' })]);
  });
});

describe('negation', () => {
  test('a negation word after a phrase in the same clause cancels it', async () => {
    expect(await mapText('বৰষুণ দিয়া নাছিল। বতৰ পৰিষ্কাৰ।', 'road')).toEqual({ weather: 'clear' });
    expect((await mapText('কোনো গুৰুতৰ আহত নাই', 'crash')).severity).toBeUndefined();
  });

  test('a phrase that is itself negative still counts', async () => {
    expect(await mapText('হেলমেট পিন্ধা নাছিল', 'persons')).toMatchObject({ 'safety_device@1': 'helmet_not_worn' });
  });
});

describe('PLACEHOLDER language packs', () => {
  test.each(['crash', 'road'] as const)('Bengali %s transcript gives the expected fields', async (section) => {
    const got = await mapText(samplesBn.sections[section], section, 'bn');
    if (typeof got.crash_datetime === 'string') got.crash_datetime = got.crash_datetime.slice(11);
    expect(got).toEqual(samplesBn.expected[section]);
  });

  test('the empty Bodo pack still reads number plates', async () => {
    expect(await mapText('गाड़ी AS01 CD 5678', 'vehicles', 'brx')).toEqual({ 'registration_number@1': 'AS01 CD 5678' });
  });
});

test('the simulated on-device transcripts miss the road number and plate, and mishear the skid marks', async () => {
  const got: Record<string, unknown> = {};
  for (const section of ['crash', 'road', 'vehicles'] as const) Object.assign(got, await mapText(samples.onDevice.sections[section], section));
  expect(got.road_name_number).toBeUndefined();
  expect(got['registration_number@2']).toBeUndefined();
  expect(got.skid_marks_m).toBe(2);
});
