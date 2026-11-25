// The eDAR schema is data (edar.schema.json, copied from /shared by `npm run sync-shared`).
// This file validates it with zod at load time and exposes typed lookups.
import { z } from 'zod';

import raw from './edar.schema.json';

export const SECTION_IDS = ['crash', 'road', 'vehicles', 'persons'] as const;
export const SectionIdSchema = z.enum(SECTION_IDS);
export type SectionId = z.infer<typeof SectionIdSchema>;

const OptionSchema = z.object({ code: z.string(), label_en: z.string(), label_as: z.string() });

export const FieldDefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    section: SectionIdSchema,
    label_en: z.string(),
    label_as: z.string(),
    type: z.enum(['enum', 'text', 'number', 'datetime', 'geo', 'photo']),
    required: z.boolean(),
    priority: z.number().int().min(0),
    options: z.array(OptionSchema).optional(),
    auto: z.enum(['gps', 'login', 'time']).optional(),
  })
  .refine((f) => f.type !== 'enum' || (f.options?.length ?? 0) > 0, { message: 'enum fields need options' });

export const EdarSchemaSchema = z.object({
  schemaId: z.string(),
  version: z.string(),
  placeholder: z.boolean(),
  note: z.string().optional(),
  sections: z.array(
    z.object({ id: SectionIdSchema, label_en: z.string(), label_as: z.string(), hint_en: z.string(), repeatable: z.boolean() }),
  ),
  fields: z.array(FieldDefSchema),
});

export type EdarSchema = z.infer<typeof EdarSchemaSchema>;
export type FieldDef = z.infer<typeof FieldDefSchema>;
export type FieldOption = z.infer<typeof OptionSchema>;
export type Section = EdarSchema['sections'][number];

export const schema: EdarSchema = EdarSchemaSchema.parse(raw);

export type LatLng = { lat: number; lng: number; accuracy?: number };
export type FieldSource = 'speech' | 'tap' | 'auto' | 'officer_edit';
export type TranscriptSpan = { start: number; end: number; text: string };

/** Every stored value keeps its evidence (CLAUDE.md rule 6). */
export type FieldValue = {
  value: string | number | LatLng;
  source: FieldSource;
  clipId?: string;
  transcriptSpan?: TranscriptSpan;
  confirmedByOfficer: boolean;
  updatedAt: string;
};

/** Field values keyed by field key: "weather", or "vehicle_type@2" for the 2nd vehicle. */
export type FieldValues = Record<string, FieldValue>;

const fieldsById = new Map(schema.fields.map((f) => [f.id, f]));
const sectionsById = new Map(schema.sections.map((s) => [s.id, s]));

export function getField(id: string): FieldDef | undefined {
  return fieldsById.get(id);
}

export function getSection(id: string): Section | undefined {
  return sectionsById.get(id as SectionId);
}

export function isRepeatable(section: string): boolean {
  return Boolean(sectionsById.get(section as SectionId)?.repeatable);
}

export function fieldsInSection(section: SectionId): FieldDef[] {
  return schema.fields.filter((f) => f.section === section);
}

/** Field definition for a stored key, or undefined if the key is not valid for the schema. */
export function fieldForKey(key: string): FieldDef | undefined {
  const { fieldId, index } = parseFieldKey(key);
  const field = fieldsById.get(fieldId);
  if (!field) return undefined;
  const repeatable = isRepeatable(field.section);
  if (repeatable && !(index !== null && index >= 1)) return undefined;
  if (!repeatable && index !== null) return undefined;
  return field;
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export type Coerced = { ok: true; value: FieldValue['value'] } | { ok: false; error: string };

/**
 * Checks a raw value against the field type and returns the normalised value. Only option
 * codes and field ids that exist in the schema are accepted (same rules as the server).
 */
export function coerceValue(field: FieldDef, raw: unknown): Coerced {
  if (raw === null || raw === undefined || raw === '') return { ok: false, error: 'Value is empty' };
  switch (field.type) {
    case 'enum': {
      const code = String(raw);
      return field.options?.some((o) => o.code === code)
        ? { ok: true, value: code }
        : { ok: false, error: `"${code}" is not an option for ${field.id}` };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false, error: `${field.id} must be a number` };
    }
    case 'datetime': {
      const s = String(raw);
      return DATETIME_RE.test(s) ? { ok: true, value: s } : { ok: false, error: `${field.id} must be YYYY-MM-DDTHH:mm` };
    }
    case 'geo': {
      const { lat, lng, accuracy } = (raw ?? {}) as Partial<LatLng>;
      const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180;
      return valid
        ? { ok: true, value: accuracy == null ? { lat: lat!, lng: lng! } : { lat: lat!, lng: lng!, accuracy } }
        : { ok: false, error: `${field.id} must be { lat, lng }` };
    }
    default: {
      const s = String(raw).trim();
      return s ? { ok: true, value: s.slice(0, 500) } : { ok: false, error: 'Value is empty' };
    }
  }
}

export function parseFieldKey(key: string): { fieldId: string; index: number | null } {
  const [fieldId, idx] = key.split('@');
  return { fieldId, index: idx === undefined ? null : Number(idx) };
}

export function fieldKey(fieldId: string, index?: number | null): string {
  return index ? `${fieldId}@${index}` : fieldId;
}

/** Option label in English or Assamese; other languages use the English label. */
export function optionLabel(field: FieldDef, code: string, lang: string): string {
  const option = field.options?.find((o) => o.code === code);
  if (!option) return code;
  return lang === 'as' ? option.label_as : option.label_en;
}
