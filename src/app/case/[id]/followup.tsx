// Wireframe 3: Follow-up questions. Contradictions first, then missing fields by priority.
// Answer by tapping, typing or voice, or skip with a reason. All on the phone, offline.
import * as Speech from 'expo-speech';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TextInput, View } from 'react-native';

import { answerFollowup, CommandError, skipFollowup } from '@/case/commands';
import { answerByVoice } from '@/case/pipeline';
import { openFollowups } from '@/case/state';
import type { Followup } from '@/case/types';
import { OptionChips } from '@/components/case-ui';
import { Button, Card, Pill, ProgressBar, Screen, styles, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useRepo, useRepoData } from '@/db';
import { CLIP_MIME, useClipRecorder } from '@/hooks/use-clip-recorder';
import type { CaseLang } from '@/lang';

const SKIP_REASONS = ['Not known at the scene', 'Person taken to hospital', 'Will check at the station'];
const SPEECH_LOCALE: Record<CaseLang, string> = { as: 'as-IN', bn: 'bn-IN', brx: 'brx-IN' };

type Recorder = ReturnType<typeof useClipRecorder>;

function QuestionCard({
  caseId,
  q,
  lang,
  locked,
  recorder,
  recordingThis,
  setRecordingFor,
}: {
  caseId: string;
  q: Followup;
  lang: CaseLang;
  locked: boolean;
  recorder: Recorder;
  recordingThis: boolean;
  setRecordingFor: (id: string | null) => void;
}) {
  const t = useTheme();
  const repo = useRepo();
  const [typed, setTyped] = useState('');
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const now = () => new Date().toISOString();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      Alert.alert('Not saved', err instanceof CommandError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const answer = (value: unknown) => run(() => repo.update(caseId, (d) => answerFollowup(d, q.id, value, { source: 'tap', now: now() })));
  const skip = () => run(() => repo.update(caseId, (d) => skipFollowup(d, q.id, reason, now())));

  const voice = async () => {
    if (!recordingThis) {
      setHeard(null);
      if (await recorder.start()) setRecordingFor(q.id);
      return;
    }
    const clip = await recorder.stop();
    setRecordingFor(null);
    if (!clip) return;
    await run(async () => {
      const result = await answerByVoice(repo, { caseId, followupId: q.id, fieldKey: q.fieldIds[0], uri: clip.uri, mimeType: CLIP_MIME, durationMs: clip.durationMs });
      setHeard(result.understood ? null : `${result.text ? `Heard: “${result.text}”. ` : ''}${result.reason}`);
    });
  };

  const readAloud = () => {
    Speech.stop();
    // Falls back to the on-screen text if the phone has no voice for the language.
    Speech.speak(q.questionAs, { language: SPEECH_LOCALE[lang], onError: () => Speech.speak(q.questionEn, { language: 'en-IN' }) });
  };

  return (
    <Card tone={q.kind === 'inconsistent' ? 'warn' : 'default'}>
      <View style={styles.row}>
        <Pill tone={q.kind === 'inconsistent' ? 'warn' : 'muted'} text={q.kind === 'inconsistent' ? 'Contradiction' : 'Missing'} />
        {q.origin === 'server' && <Pill tone="muted" text="From server" />}
        <View style={styles.flex} />
        <Button title="🔊" variant="secondary" onPress={readAloud} />
      </View>
      <T variant="heading">{q.questionAs}</T>
      {q.questionAs !== q.questionEn && <T variant="small">{q.questionEn}</T>}

      {q.options.length > 0 && <OptionChips options={q.options} onSelect={answer} disabled={busy || locked} />}
      {q.answerType !== 'enum' && (
        <View style={styles.row}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder={q.answerType === 'datetime' ? 'YYYY-MM-DDTHH:mm' : q.answerType === 'number' ? 'Number' : 'Type the answer'}
            placeholderTextColor={t.muted}
            keyboardType={q.answerType === 'number' ? 'numeric' : 'default'}
            autoCapitalize={q.fieldIds[0].startsWith('registration_number') ? 'characters' : 'sentences'}
            style={[local.input, styles.flex, { borderColor: t.border, color: t.text }]}
          />
          <Button title="Save" onPress={() => answer(typed)} disabled={!typed.trim() || busy || locked} />
        </View>
      )}

      <View style={styles.row}>
        <Button
          title={recordingThis ? 'Stop & use answer' : 'Answer by voice'}
          variant={recordingThis ? 'danger' : 'secondary'}
          style={styles.flex}
          onPress={voice}
          disabled={busy || locked || (recorder.isRecording && !recordingThis)}
        />
        <Button title="Skip" variant="secondary" onPress={() => setSkipping((s) => !s)} disabled={busy || locked} />
      </View>
      {busy && <ActivityIndicator />}
      {recordingThis && recorder.error && <T color={t.danger}>{recorder.error}</T>}
      {heard && <T variant="small" color={t.warn}>{heard}</T>}

      {skipping && (
        <View style={local.skip}>
          <T variant="label">Reason for skipping</T>
          <OptionChips options={SKIP_REASONS.map((r) => ({ code: r, label_en: r, label_as: r }))} selected={reason} onSelect={setReason} />
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Or type a reason"
            placeholderTextColor={t.muted}
            style={[local.input, { borderColor: t.border, color: t.text }]}
          />
          <Button title="Skip with this reason" variant="secondary" onPress={skip} disabled={reason.trim().length < 3 || busy} />
        </View>
      )}
    </Card>
  );
}

export default function FollowupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useRepoData(`case:${id}`, (r) => r.loadCase(id));
  // One recorder for the whole screen, used by whichever question is being answered.
  const recorder = useClipRecorder();
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  if (!doc) return <Screen><ActivityIndicator /></Screen>;

  const open = openFollowups(doc);
  const closed = doc.followups.length - open.length;
  const percent = doc.followups.length ? Math.round((closed / doc.followups.length) * 100) : 100;

  return (
    <Screen
      footer={
        <>
          <ProgressBar percent={percent} label={`${closed} of ${doc.followups.length} questions done`} />
          <Button title="Next: scene photos" onPress={() => router.push({ pathname: '/case/[id]/photos', params: { id } })} />
        </>
      }>
      <T variant="title">Questions to answer</T>
      <T variant="small">Most important first · tap 🔊 to hear a question · works offline</T>
      {open.length === 0 ? (
        <Card tone="dashed">
          <T variant="small">{doc.followups.length ? 'All questions answered or skipped.' : 'No questions yet. Record a section first.'}</T>
        </Card>
      ) : (
        open.map((q) => (
          <QuestionCard
            key={q.id}
            caseId={id}
            q={q}
            lang={doc.lang}
            locked={doc.status === 'signed'}
            recorder={recorder}
            recordingThis={recordingFor === q.id}
            setRecordingFor={setRecordingFor}
          />
        ))
      )}
    </Screen>
  );
}

const local = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, fontSize: 17 },
  skip: { gap: 8, marginTop: 4 },
});
