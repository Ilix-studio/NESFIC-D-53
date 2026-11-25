// Wireframe 1: New case / case home. Everything here is read from SQLite on the phone.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { setLanguage } from '@/case/commands';
import { openFollowups } from '@/case/state';
import type { Clip } from '@/case/types';
import { formatValue, OptionChips, PlaceholderNote } from '@/components/case-ui';
import { Button, Card, Pill, ProgressBar, Screen, styles, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useRepo, useRepoData } from '@/db';
import { CASE_LANGS, getLang, type CaseLang } from '@/lang';
import { getField, schema, type SectionId } from '@/schema';
import { caseLangChosen, useAppDispatch } from '@/store';
import { formatDateTime } from '@/utils/format';

const CHECKLIST_SIZE = 6;

function sectionStatus(clips: Clip[], section: SectionId): string {
  const mine = clips.filter((c) => c.section === section);
  if (!mine.length) return 'Not recorded yet';
  const last = mine[mine.length - 1];
  const filled = new Set(mine.flatMap((c) => c.filledKeys)).size;
  if (last.status === 'saved') return 'Transcribing…';
  if (last.status === 'server_only') return `${mine.length} clip(s) saved · server transcribes after sync`;
  if (last.status === 'failed') return 'Saved · offline transcription failed, server will retry';
  return `✓ ${filled} field${filled === 1 ? '' : 's'} from ${mine.length} clip${mine.length === 1 ? '' : 's'}`;
}

export default function CaseHomeScreen() {
  const t = useTheme();
  const repo = useRepo();
  const dispatch = useAppDispatch();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isConnected } = useNetInfo();
  const doc = useRepoData(`case:${id}`, (r) => r.loadCase(id));
  const clips = useRepoData(`clips:${id}`, (r) => r.listClips(id)) ?? [];
  const photos = useRepoData(`photos:${id}`, (r) => r.listPhotos(id)) ?? [];
  const summary = useRepoData(`summary:${id}`, (r) => r.caseSummary(id));

  if (doc === undefined) return <Screen><ActivityIndicator /></Screen>;
  if (doc === null) return <Screen><T>This case is not on this phone.</T></Screen>;

  const locked = doc.status === 'signed';
  const open = openFollowups(doc);
  const recorded = new Set(clips.map((c) => c.section));
  const nextSection = schema.sections.find((s) => !recorded.has(s.id)) ?? schema.sections[0];
  const checklistDone = new Set(photos.map((p) => p.checklistItem)).size;
  const pack = getLang(doc.lang);

  const pickLanguage = (lang: string) => {
    if (clips.length && lang !== doc.lang) {
      Alert.alert('Change language?', 'Clips already recorded keep their language. New clips and questions use the new one.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change', onPress: () => applyLanguage(lang as CaseLang) },
      ]);
    } else applyLanguage(lang as CaseLang);
  };
  const applyLanguage = async (lang: CaseLang) => {
    await repo.update(id, (d) => setLanguage(d, lang, new Date().toISOString()));
    dispatch(caseLangChosen(lang));
  };

  return (
    <Screen
      footer={
        <View style={styles.row}>
          <Button
            title={open.length ? `Questions (${open.length})` : 'Questions'}
            variant="secondary"
            style={styles.flex}
            onPress={() => router.push({ pathname: '/case/[id]/followup', params: { id } })}
          />
          <Button title={locked ? 'Submit & audit' : 'Review'} style={styles.flex} onPress={() => router.push({ pathname: locked ? '/case/[id]/submit' : '/case/[id]/review', params: { id } })} />
        </View>
      }>
      <View style={styles.row}>
        <T variant="title" style={styles.flex}>
          {locked ? 'Signed case' : 'Crash case'}
        </T>
        <Pill tone={isConnected === false ? 'warn' : 'muted'} text={isConnected === false ? 'Offline · saved on phone' : 'Saved on phone'} />
      </View>

      {(summary?.openProposals ?? 0) > 0 && (
        <Card tone="warn" onPress={() => router.push({ pathname: '/case/[id]/review', params: { id } })}>
          <T variant="heading">
            {summary!.openProposals} suggestion{summary!.openProposals === 1 ? '' : 's'} from the server
          </T>
          <T variant="small">The server re-checked your clips after sync. Tap to accept or reject each one in review.</T>
        </Card>
      )}

      <View style={styles.row}>
        <Card style={styles.flex}>
          <T variant="small">TIME (auto)</T>
          <T variant="heading">{formatDateTime(new Date(doc.startedAt))}</T>
        </Card>
        <Card style={styles.flex}>
          <T variant="small">GPS (auto)</T>
          <T variant="heading">{doc.location ? formatValue(getField('crash_location'), doc.location) : 'Finding…'}</T>
        </Card>
      </View>
      <T variant="small">
        {doc.policeStation ? `${doc.policeStation} · ${doc.officerName} (from login)` : 'Not logged in: police station and IO name are blank. Log in to fill them.'}
      </T>

      <ProgressBar percent={doc.completeness.percent} />

      <T variant="label">Language for this case</T>
      <OptionChips
        options={CASE_LANGS.map((code) => ({ code, label_en: getLang(code).name_en, label_as: getLang(code).name }))}
        selected={doc.lang}
        onSelect={pickLanguage}
        disabled={locked}
      />
      <PlaceholderNote lang={doc.lang} />

      <T variant="label">Record in 4 short sections · {pack.name}</T>
      {schema.sections.map((section, i) => {
        const active = !locked && section.id === nextSection.id;
        return (
          <Card
            key={section.id}
            tone={active ? 'active' : 'default'}
            onPress={locked ? undefined : () => router.push({ pathname: '/case/[id]/record/[section]', params: { id, section: section.id } })}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <T variant="heading">
                  {i + 1}. {section.label_en}
                </T>
                <T variant="small">
                  {section.label_as} · {section.hint_en}
                </T>
                <T variant="small" color={recorded.has(section.id) ? t.success : t.muted}>
                  {sectionStatus(clips, section.id)}
                </T>
              </View>
              {active && (
                <View style={[local.mic, { backgroundColor: t.primary }]}>
                  <MaterialCommunityIcons name="microphone" size={30} color={t.onPrimary} />
                </View>
              )}
            </View>
          </Card>
        );
      })}

      <Card tone="dashed" onPress={() => router.push({ pathname: '/case/[id]/photos', params: { id } })}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <T variant="heading">Scene photos</T>
            <T variant="small">
              {checklistDone} of {CHECKLIST_SIZE} checklist items · {photos.length} photo{photos.length === 1 ? '' : 's'}
            </T>
          </View>
          <T variant="heading" color={t.primary}>
            Open
          </T>
        </View>
      </Card>

      <T variant="small" selectable>
        Case id: {id}
      </T>
    </Screen>
  );
}

const local = StyleSheet.create({
  mic: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
