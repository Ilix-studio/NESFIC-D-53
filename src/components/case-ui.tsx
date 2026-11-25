// Case-specific UI pieces shared by several screens.
import { Pressable, StyleSheet, View } from 'react-native';

import type { Proposal } from '@/case/types';
import { Pill, T } from '@/components/ui';
import { TOUCH, useTheme } from '@/constants/theme';
import { getLang } from '@/lang';
import { fieldForKey, getField, optionLabel, parseFieldKey, type FieldDef, type FieldOption, type FieldValue, type LatLng } from '@/schema';
import { formatDateTime } from '@/utils/format';

export type ViewLang = 'en' | 'as';

/** "Vehicle 2 · Registration number" */
export function fieldTitle(key: string, lang: ViewLang = 'en'): string {
  const field = fieldForKey(key) ?? getField(parseFieldKey(key).fieldId);
  if (!field) return key;
  const label = lang === 'as' ? field.label_as : field.label_en;
  const { index } = parseFieldKey(key);
  if (!index) return label;
  const prefix = getLang(lang).instancePrefix?.[field.section] ?? '{n}: ';
  return `${prefix.replace('{n}', String(index)).replace('{detail}', '').replace(/:\s*$/, '')} · ${label}`;
}

export function formatValue(field: FieldDef | undefined, value: FieldValue['value'] | null | undefined, lang: ViewLang = 'en'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (!field) return String(value);
  switch (field.type) {
    case 'enum':
      return optionLabel(field, String(value), lang);
    case 'datetime': {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value));
      return m ? formatDateTime(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))) : String(value);
    }
    case 'geo': {
      const { lat, lng, accuracy } = value as LatLng;
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}${accuracy != null ? ` (±${accuracy} m)` : ''}`;
    }
    default:
      return String(value);
  }
}

const SOURCE_LABEL: Record<FieldValue['source'], string> = {
  speech: 'From speech',
  tap: 'Tapped',
  auto: 'Auto',
  officer_edit: 'Edited by IO',
};

export function SourcePills({ fv }: { fv: FieldValue }) {
  return (
    <View style={local.pills}>
      <Pill tone="muted" text={SOURCE_LABEL[fv.source]} />
      {fv.confirmedByOfficer && <Pill tone="ok" text="✓ Confirmed" />}
    </View>
  );
}

export function OptionChips({
  options,
  selected,
  onSelect,
  lang = 'en',
  disabled,
}: {
  options: FieldOption[];
  selected?: string | null;
  onSelect: (code: string) => void;
  lang?: ViewLang;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={local.chips}>
      {options.map((o) => {
        const active = selected === o.code;
        return (
          <Pressable
            key={o.code}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onSelect(o.code)}
            style={({ pressed }) => [
              local.chip,
              { borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primarySoft : t.background },
              pressed && { opacity: 0.7 },
              disabled && { opacity: 0.45 },
            ]}>
            <T variant="heading" color={active ? t.primary : t.text}>
              {lang === 'as' ? o.label_as : o.label_en}
            </T>
            {lang === 'en' && o.label_as !== o.label_en && <T variant="small">{o.label_as}</T>}
          </Pressable>
        );
      })}
    </View>
  );
}

export const PROPOSAL_SOURCE: Record<Proposal['source'], string> = {
  server_asr: 'Server speech re-check',
  server_llm: 'Server AI mapper',
  server_vision: 'Server photo check',
};

/** Placeholder language packs must never look official. */
export function PlaceholderNote({ lang }: { lang: string }) {
  const pack = getLang(lang);
  if (!pack.placeholder) return null;
  return (
    <T variant="small" style={local.note}>
      {pack.name_en} is a PLACEHOLDER language pack: {pack.note}
    </T>
  );
}

const local = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: TOUCH, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, justifyContent: 'center' },
  note: { fontStyle: 'italic' },
});
