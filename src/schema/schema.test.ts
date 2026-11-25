import { getLang } from '@/lang';
import { fieldKey, getField, parseFieldKey, schema } from '@/schema';

describe('placeholder eDAR schema', () => {
  test('is marked as a placeholder, not the official field list', () => {
    expect(schema.placeholder).toBe(true);
    expect(schema.note).toMatch(/PLACEHOLDER/);
  });

  test('has about 40 fields across the 4 recording sections', () => {
    expect(schema.sections.map((s) => s.id)).toEqual(['crash', 'road', 'vehicles', 'persons']);
    expect(schema.fields.length).toBeGreaterThanOrEqual(35);
    expect(new Set(schema.fields.map((f) => f.id)).size).toBe(schema.fields.length);
  });

  test('every enum option has an English code and an Assamese label', () => {
    for (const field of schema.fields.filter((f) => f.type === 'enum')) {
      for (const option of field.options ?? []) {
        expect(option.code).toMatch(/^[a-z0-9_]+$/);
        expect(option.label_as.trim()).not.toBe('');
      }
    }
  });
});

describe('language packs', () => {
  test.each(['as', 'en'] as const)('%s has a question for every field', (code) => {
    const questions = getLang(code).questions as Record<string, string>;
    for (const field of schema.fields) expect(questions[field.id]).toBeTruthy();
  });

  test.each(['as', 'bn', 'brx'] as const)('%s keywords only point at fields and option codes that exist', (code) => {
    const keywords = getLang(code).keywords ?? {};
    for (const [fieldId, options] of Object.entries(keywords)) {
      const field = getField(fieldId);
      expect(field?.type).toBe('enum');
      for (const option of Object.keys(options)) expect(field?.options?.map((o) => o.code)).toContain(option);
    }
  });

  test('Bengali and Bodo are marked as PLACEHOLDER packs; Assamese is not', () => {
    expect(getLang('bn').placeholder).toBe(true);
    expect(getLang('brx').placeholder).toBe(true);
    expect(getLang('as').placeholder).toBeUndefined();
  });
});

test('field keys address one vehicle or person', () => {
  expect(fieldKey('vehicle_type', 2)).toBe('vehicle_type@2');
  expect(parseFieldKey('vehicle_type@2')).toEqual({ fieldId: 'vehicle_type', index: 2 });
  expect(parseFieldKey('weather')).toEqual({ fieldId: 'weather', index: null });
});
