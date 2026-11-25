// Wireframe 5: Officer review. Server suggestions (after sync) with Accept / Reject, every
// field with its evidence, Confirm / Edit, and signing once nothing is left open.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { acceptProposal, CommandError, confirmFields, editField, rejectProposal, signBlockers, signCase } from '@/case/commands';
import { instanceCount, isEmpty } from '@/case/fields';
import { openFollowups, unconfirmedFields } from '@/case/state';
import type { CaseDoc, Proposal } from '@/case/types';
import { fieldTitle, formatValue, OptionChips, PROPOSAL_SOURCE, SourcePills, type ViewLang } from '@/components/case-ui';
import { Button, Card, Pill, ProgressBar, Screen, styles, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useRepo, useRepoData } from '@/db';
import { fieldForKey, fieldKey, fieldsInSection, schema, type FieldDef } from '@/schema';
import { currentLocation } from '@/utils/location';

const now = () => new Date().toISOString();

function ProposalsCard({ doc, proposals, lang, onAct }: { doc: CaseDoc; proposals: Proposal[]; lang: ViewLang; onAct: (fn: () => Promise<unknown>) => void }) {
  const t = useTheme();
  const repo = useRepo();
  const open = proposals.filter((p) => p.status === 'open');
  const decided = proposals.filter((p) => p.status === 'accepted' || p.status === 'rejected');
  if (!open.length && !decided.length) return null;
  const accept = (p: Proposal) => repo.update(doc.clientId, (d) => acceptProposal(d, p, now()));
  const reject = (p: Proposal) => repo.update(doc.clientId, (d) => rejectProposal(d, p, now()));

  return (
    <Card tone={open.length ? 'warn' : 'default'}>
      <T variant="heading">
        {open.length ? `${open.length} suggestion${open.length === 1 ? '' : 's'} from the server` : 'Server suggestions'}
      </T>
      <T variant="small">The server re-checked your clips after sync. Nothing changes unless you accept it.</T>
      {open.map((p) => {
        const field = fieldForKey(p.fieldId);
        const current = doc.fields[p.fieldId];
        return (
          <View key={p.id} style={[local.proposal, { borderTopColor: t.border }]}>
            <T variant="label">{fieldTitle(p.fieldId, lang)}</T>
            <T variant="small">
              Now: {formatValue(field, current?.value, lang)}
              {current?.confirmedByOfficer ? ' (you confirmed this)' : ''}
            </T>
            <T variant="heading">Suggested: {formatValue(field, p.value, lang)}</T>
            {p.evidence?.transcriptSpan?.text && <T variant="small">Heard: “{p.evidence.transcriptSpan.text}”</T>}
            <T variant="small">{PROPOSAL_SOURCE[p.source]}{p.evidence?.engine ? ` (${p.evidence.engine})` : ''}</T>
            <View style={styles.row}>
              <Button title="Reject" variant="secondary" style={styles.flex} onPress={() => onAct(() => reject(p))} />
              <Button title="Accept" variant="success" style={styles.flex} onPress={() => onAct(() => accept(p))} />
            </View>
          </View>
        );
      })}
      {open.length > 1 && (
        <Button
          title={`Accept all ${open.length}`}
          variant="secondary"
          onPress={() => onAct(async () => {
            for (const p of open) await accept(p);
          })}
        />
      )}
      {decided.length > 0 && (
        <T variant="small">
          Decided: {decided.map((p) => `${fieldTitle(p.fieldId, lang)} ${p.status}`).join(' · ')}
        </T>
      )}
    </Card>
  );
}

function FieldEditor({ field, current, onSave, onCancel }: { field: FieldDef; current: unknown; onSave: (value: unknown) => void; onCancel: () => void }) {
  const t = useTheme();
  const [text, setText] = useState(current == null ? '' : typeof current === 'object' ? '' : String(current));
  return (
    <View style={local.editor}>
      {field.type === 'enum' && <OptionChips options={field.options ?? []} selected={String(current ?? '')} onSelect={onSave} />}
      {(field.type === 'text' || field.type === 'number' || field.type === 'datetime') && (
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          placeholder={field.type === 'datetime' ? 'YYYY-MM-DDTHH:mm' : field.label_en}
          placeholderTextColor={t.muted}
          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
          style={[local.input, { borderColor: t.border, color: t.text }]}
        />
      )}
      {field.type === 'geo' && (
        <Button
          title="Use current GPS"
          variant="secondary"
          onPress={async () => {
            const loc = await currentLocation();
            if (loc) onSave(loc);
            else Alert.alert('No GPS fix', 'Allow location and try again outdoors.');
          }}
        />
      )}
      <View style={styles.row}>
        <Button title="Cancel" variant="secondary" style={styles.flex} onPress={onCancel} />
        {current != null && <Button title="Clear" variant="secondary" style={styles.flex} onPress={() => onSave(null)} />}
        {field.type !== 'enum' && field.type !== 'geo' && <Button title="Save" style={styles.flex} onPress={() => onSave(text)} disabled={!text.trim()} />}
      </View>
    </View>
  );
}

function FieldRow({
  doc,
  keyName,
  field,
  lang,
  editing,
  setEditing,
  onAct,
}: {
  doc: CaseDoc;
  keyName: string;
  field: FieldDef;
  lang: ViewLang;
  editing: boolean;
  setEditing: (key: string | null) => void;
  onAct: (fn: () => Promise<unknown>) => void;
}) {
  const t = useTheme();
  const repo = useRepo();
  const fv = doc.fields[keyName];
  const locked = doc.status === 'signed';
  const missingRequired = field.required && isEmpty(fv?.value);

  return (
    <View style={[local.fieldRow, { borderTopColor: t.border }]}>
      <View style={styles.row}>
        <T variant="small" style={styles.flex} color={missingRequired ? t.warn : undefined}>
          {lang === 'as' ? field.label_as : field.label_en}
          {field.required ? ' *' : ''}
        </T>
        <T variant="heading" style={local.value}>
          {formatValue(field, fv?.value, lang)}
        </T>
      </View>
      {fv && <SourcePills fv={fv} />}
      {fv?.transcriptSpan?.text && <T variant="small">“{fv.transcriptSpan.text}”</T>}
      {!locked && !editing && (
        <View style={styles.row}>
          {fv && !fv.confirmedByOfficer && (
            <Button title="Confirm" variant="success" style={styles.flex} onPress={() => onAct(() => repo.update(doc.clientId, (d) => confirmFields(d, [keyName], now())))} />
          )}
          <Button title={fv ? 'Edit' : 'Add'} variant="secondary" style={styles.flex} onPress={() => setEditing(keyName)} />
        </View>
      )}
      {editing && (
        <FieldEditor
          field={field}
          current={fv?.value}
          onCancel={() => setEditing(null)}
          onSave={(value) =>
            onAct(async () => {
              await repo.update(doc.clientId, (d) => editField(d, keyName, value, now()));
              setEditing(null);
            })
          }
        />
      )}
    </View>
  );
}

export default function ReviewScreen() {
  const t = useTheme();
  const repo = useRepo();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useRepoData(`case:${id}`, (r) => r.loadCase(id));
  const proposals = useRepoData(`proposals:${id}`, (r) => r.listProposals(id)) ?? [];
  const [lang, setLang] = useState<ViewLang>('en');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!doc) return <Screen><ActivityIndicator /></Screen>;
  const locked = doc.status === 'signed';

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      Alert.alert('Not saved', err instanceof CommandError ? [err.message, ...err.reasons].join('\n') : String(err));
    } finally {
      setBusy(false);
    }
  };

  const blockers = signBlockers(doc, proposals);
  const open = openFollowups(doc);
  const unconfirmed = unconfirmedFields(doc);

  const sign = () =>
    Alert.alert('Sign and lock this case?', 'After signing, the case is read-only on the phone and on the server.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign',
        onPress: () =>
          act(async () => {
            await repo.update(id, (d) => signCase(d, proposals, now()));
            router.replace({ pathname: '/case/[id]/submit', params: { id } });
          }),
      },
    ]);

  const toggle = (value: ViewLang, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: lang === value }}
      onPress={() => setLang(value)}
      style={[local.toggle, { borderColor: lang === value ? t.primarySoft : t.border, backgroundColor: lang === value ? t.primarySoft : 'transparent' }]}>
      <T variant="heading" color={lang === value ? t.primary : t.text}>
        {label}
      </T>
    </Pressable>
  );

  return (
    <Screen
      footer={
        <>
          <ProgressBar percent={doc.completeness.percent} />
          {locked ? (
            <Button title="Signed · open submit & audit" onPress={() => router.push({ pathname: '/case/[id]/submit', params: { id } })} />
          ) : (
            <Button title="I confirm, sign and submit" onPress={sign} disabled={blockers.length > 0 || busy} loading={busy} />
          )}
        </>
      }>
      <T variant="title">{locked ? 'Signed report' : 'Review before submitting'}</T>
      <View style={styles.row}>
        {toggle('en', 'English (eDAR)')}
        {toggle('as', 'অসমীয়া view')}
      </View>
      <T variant="small">PLACEHOLDER eDAR schema v{schema.version}: not the official MoRTH field list.</T>

      <ProposalsCard doc={doc} proposals={proposals} lang={lang} onAct={act} />

      {schema.sections.map((section) => {
        const count = instanceCount(doc, section.id);
        const blocks = section.repeatable ? Array.from({ length: count }, (_, i) => i + 1) : [null];
        return blocks.map((index) => {
          const keys = fieldsInSection(section.id).map((f) => ({ key: fieldKey(f.id, index), field: f }));
          const toConfirm = keys.filter(({ key }) => doc.fields[key] && !doc.fields[key].confirmedByOfficer).map(({ key }) => key);
          const title = index ? fieldTitle(fieldKey(keys[0].field.id, index), lang).split(' · ')[0] : section[`label_${lang}`];
          return (
            <View key={`${section.id}-${index ?? 0}`} style={local.section}>
              <T variant="label">{title}</T>
              <Card>
                {keys.map(({ key, field }) => (
                  <FieldRow key={key} doc={doc} keyName={key} field={field} lang={lang} editing={editing === key} setEditing={setEditing} onAct={act} />
                ))}
                {!locked && toConfirm.length > 0 && (
                  <Button
                    title={`Confirm ${toConfirm.length} value${toConfirm.length === 1 ? '' : 's'} in this block`}
                    variant="secondary"
                    onPress={() => act(() => repo.update(id, (d) => confirmFields(d, toConfirm, now())))}
                  />
                )}
              </Card>
            </View>
          );
        });
      })}

      {!locked && (
        <Card tone={blockers.length || open.length ? 'warn' : 'default'}>
          <T variant="heading">Still open</T>
          {open.length > 0 && (
            <T variant="small" color={t.warn} onPress={() => router.push({ pathname: '/case/[id]/followup', params: { id } })}>
              {open.length} question(s) not answered (you can still sign; answer or skip them first if you can) ›
            </T>
          )}
          {unconfirmed.length > 0 && <T variant="small" color={t.warn}>{unconfirmed.length} filled field(s) to confirm</T>}
          {blockers.length === 0 && <T variant="small">Ready to sign.</T>}
          {blockers.length > 0 && (
            <View style={styles.row}>
              <Pill tone="warn" text="Signing blocked" />
              <T variant="small" style={styles.flex}>
                {blockers.join(' · ')}
              </T>
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}

const local = StyleSheet.create({
  toggle: { minHeight: 44, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center' },
  section: { gap: 8 },
  fieldRow: { gap: 6, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  value: { flexShrink: 1, textAlign: 'right', maxWidth: '55%' },
  proposal: { gap: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  editor: { gap: 8 },
  input: { minHeight: 48, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, fontSize: 17 },
});
