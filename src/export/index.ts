// eDAR-schema JSON export, built on the phone so it works offline. Same layout as the server
// export (server/src/services/export.service.js). It follows the PLACEHOLDER schema and must
// be re-checked against NIC's eDAR integration spec once that is shared.
import { expectedKeys, getValue, instanceCount, isEmpty } from '@/case/fields';
import type { CaseDoc } from '@/case/types';
import { fieldKey, fieldsInSection, schema, type SectionId } from '@/schema';

export const EXPORT_FORMAT = 'edar-json';

function sectionValues(doc: CaseDoc, section: SectionId, index: number | null) {
  const out: Record<string, unknown> = {};
  for (const field of fieldsInSection(section)) {
    const value = getValue(doc, fieldKey(field.id, index));
    out[field.id] = isEmpty(value) ? null : value;
  }
  return out;
}

export function buildEdarJson(doc: CaseDoc, counts: { clips: number; photos: number }) {
  const sections: Record<string, unknown> = {};
  for (const section of schema.sections) {
    if (!section.repeatable) {
      sections[section.id] = sectionValues(doc, section.id, null);
      continue;
    }
    const n = instanceCount(doc, section.id);
    sections[section.id] = Array.from({ length: n }, (_, i) => ({ no: i + 1, ...sectionValues(doc, section.id, i + 1) }));
  }
  return {
    format: EXPORT_FORMAT,
    schema: { id: schema.schemaId, version: schema.version, placeholder: schema.placeholder },
    case: {
      clientId: doc.clientId,
      policeStation: doc.policeStation ?? null,
      district: doc.district ?? null,
      startedAt: doc.startedAt,
      location: doc.location ?? null,
      language: doc.lang,
      signedAt: doc.signedAt ?? null,
      signedBy: doc.officerBadge ? { name: doc.officerName, badgeNo: doc.officerBadge } : null,
    },
    ...sections,
    blankFields: expectedKeys(doc).filter((k) => isEmpty(getValue(doc, k))),
    skippedQuestions: doc.followups
      .filter((f) => f.status === 'skipped')
      .map((f) => ({ fieldIds: f.fieldIds, question: f.questionEn, reason: f.skipReason })),
    evidence: counts,
    completeness: doc.completeness,
    exportedAt: new Date().toISOString(),
  };
}
