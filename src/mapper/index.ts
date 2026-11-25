// Maps a transcript onto eDAR field values. Swap-able like AsrEngine.
// Offline (default): RuleBasedFieldMapper, driven by the language pack. The server re-checks
// after sync and sends differences back as proposals (it never overwrites phone values).
import type { Transcript } from '@/asr';
import type { MapperProposal } from '@/case/state';
import type { ClipSection } from '@/case/types';

export type FieldProposal = Required<Pick<MapperProposal, 'fieldId' | 'value' | 'transcriptSpan' | 'confidence'>>;

export type MapInput = {
  transcript: Pick<Transcript, 'text' | 'lang'>;
  section: ClipSection;
  /** When the case was opened (ISO): gives the date for spoken crash times. */
  startedAt?: string;
  /** Follow-up answer: only these field keys, and the whole clip is about them. */
  targetKeys?: string[];
};

export interface FieldMapper {
  readonly name: string;
  map(input: MapInput): Promise<FieldProposal[]>;
}

export { ruleMapper } from './rule-mapper';
