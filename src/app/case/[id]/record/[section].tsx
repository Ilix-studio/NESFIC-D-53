// Wireframe 2: Record a section. The clip is saved to SQLite + app storage the moment it
// stops, then transcribed and mapped on the phone (no network needed).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { captureSectionClip, mapClipText, type ClipOutcome } from '@/case/pipeline';
import { openFollowups } from '@/case/state';
import { fieldTitle, formatValue, PlaceholderNote } from '@/components/case-ui';
import { Button, Card, Pill, Screen, styles, T } from '@/components/ui';
import { TOUCH, useTheme } from '@/constants/theme';
import { useRepo, useRepoData } from '@/db';
import { CLIP_MIME, useClipRecorder } from '@/hooks/use-clip-recorder';
import { getLang } from '@/lang';
import { fieldForKey, SECTION_IDS, schema, type SectionId } from '@/schema';

const SAY: Record<SectionId, string> = {
  crash: 'time, place, what happened, vehicles involved, injuries',
  road: 'road type, surface, lighting, weather, signs, skid marks',
  vehicles: 'each vehicle in turn ("first…", "second…"): type, number plate, what it was doing, damage',
  persons: 'each person in turn: driver / passenger / pedestrian, gender, age, injury, helmet or seat belt',
};

const LOUD_DB = -6;
const QUIET_DB = -45;
const QUIET_FOR_MS = 3000;

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Live noise / level warning from the recorder's metering (dBFS), checked a few times a second. */
function useLevelWarning(isRecording: boolean, metering: number | undefined) {
  const latest = useRef(metering);
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => {
    latest.current = metering;
  }, [metering]);
  useEffect(() => {
    if (!isRecording) return;
    let quietSince: number | null = null;
    const timer = setInterval(() => {
      const level = latest.current;
      if (level === undefined) return;
      if (level > LOUD_DB) {
        setWarning('Very loud: wind or traffic? Shield the microphone or turn away from the road.');
      } else if (level < QUIET_DB) {
        quietSince ??= Date.now();
        setWarning(Date.now() - quietSince > QUIET_FOR_MS ? 'Very quiet: hold the phone closer and speak up.' : null);
      } else {
        quietSince = null;
        setWarning(null);
      }
    }, 300);
    return () => clearInterval(timer);
  }, [isRecording]);
  return isRecording ? warning : null;
}

export default function RecordSectionScreen() {
  const t = useTheme();
  const repo = useRepo();
  const { id, section } = useLocalSearchParams<{ id: string; section: SectionId }>();
  const doc = useRepoData(`case:${id}`, (r) => r.loadCase(id));
  const clips = useRepoData(`clips:${id}:${section}`, async (r) => (await r.listClips(id)).filter((c) => c.section === section)) ?? [];
  const recorder = useClipRecorder();
  const warning = useLevelWarning(recorder.isRecording, recorder.metering);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ClipOutcome | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const index = SECTION_IDS.indexOf(section);
  const current = schema.sections[index];
  const next = schema.sections[index + 1];
  if (!current) return <Screen><T>Unknown section “{section}”.</T></Screen>;
  if (!doc) return <Screen><ActivityIndicator /></Screen>;
  const locked = doc.status === 'signed';

  const last = clips[clips.length - 1];
  const level = recorder.metering === undefined ? 0 : Math.max(0, Math.min(1, (recorder.metering + 60) / 60));

  const toggle = async () => {
    if (!recorder.isRecording) {
      setOutcome(null);
      await recorder.start();
      return;
    }
    const clip = await recorder.stop();
    if (!clip) return;
    setBusy(true);
    try {
      setOutcome(await captureSectionClip(repo, { caseId: id, section, uri: clip.uri, mimeType: CLIP_MIME, durationMs: clip.durationMs }));
    } finally {
      setBusy(false);
    }
  };

  const saveCorrection = async () => {
    if (!last || editing === null) return;
    setBusy(true);
    try {
      setOutcome(await mapClipText(repo, { caseId: id, clipId: last.clientId, section, text: editing, engine: 'officer-corrected' }));
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const filledKeys = [...new Set(clips.flatMap((c) => c.filledKeys))];
  const openCount = openFollowups(doc).length;

  return (
    <Screen
      footer={
        <>
          <Button
            title={openCount ? `Answer follow-up questions (${openCount})` : 'Follow-up questions'}
            onPress={() => router.push({ pathname: '/case/[id]/followup', params: { id } })}
            disabled={recorder.isRecording}
          />
          {next && (
            <Button
              title={`Next: ${next.label_en}`}
              variant="secondary"
              disabled={recorder.isRecording}
              onPress={() => router.replace({ pathname: '/case/[id]/record/[section]', params: { id, section: next.id } })}
            />
          )}
        </>
      }>
      <T variant="small">Section {index + 1} of 4 · {getLang(doc.lang).name}</T>
      <T variant="title">{current.label_en}</T>
      <T variant="small">
        {current.label_as} · Say: {SAY[current.id]}
      </T>
      <PlaceholderNote lang={doc.lang} />

      <View style={[local.panel, { backgroundColor: t.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recorder.isRecording ? 'Stop and save' : 'Record'}
          disabled={busy || locked}
          onPress={toggle}
          style={({ pressed }) => [local.recordButton, { backgroundColor: recorder.isRecording ? t.text : t.danger }, (pressed || busy || locked) && { opacity: 0.6 }]}>
          <T variant="heading" color={recorder.isRecording ? t.background : '#FFFFFF'}>
            {recorder.isRecording ? 'Stop' : 'Record'}
          </T>
        </Pressable>
        <View style={styles.flex}>
          <T variant="heading">{mmss(recorder.durationMs)} recorded</T>
          <View style={[local.meter, { backgroundColor: t.border }]}>
            <View style={[local.meterFill, { width: `${level * 100}%`, backgroundColor: warning ? t.warn : t.success }]} />
          </View>
          <T variant="small" color={warning ? t.warn : t.muted}>
            {warning ?? (recorder.isRecording ? 'Listening…' : locked ? 'This case is signed.' : 'Tap Record and speak. Tap Stop to save.')}
          </T>
          {recorder.error && <T color={t.danger}>{recorder.error}</T>}
        </View>
      </View>

      {busy && (
        <Card>
          <View style={styles.row}>
            <ActivityIndicator />
            <T>Transcribing on the phone…</T>
          </View>
        </Card>
      )}
      {outcome?.status === 'server_only' && (
        <Card tone="warn">
          <T variant="heading">Clip saved</T>
          <T variant="small">{outcome.reason}</T>
        </Card>
      )}
      {outcome?.status === 'failed' && (
        <Card tone="warn">
          <T variant="heading">Clip saved, offline transcription failed</T>
          <T variant="small">{outcome.error}. The server will transcribe it after sync.</T>
        </Card>
      )}

      <T variant="label">Transcript ({getLang(doc.lang).name})</T>
      {last?.transcriptText ? (
        <Card>
          {last.transcriptEngine === 'demo' && <Pill tone="warn" text="Demo engine: synthetic transcript, not your recording" />}
          {last.transcriptEngine === 'officer-corrected' && <Pill tone="muted" text="Corrected by IO" />}
          {editing === null ? (
            <>
              <T selectable>{last.transcriptText}</T>
              {!locked && <Button title="Correct transcript" variant="secondary" onPress={() => setEditing(last.transcriptText ?? '')} />}
            </>
          ) : (
            <>
              <TextInput
                multiline
                value={editing}
                onChangeText={setEditing}
                style={[local.input, { borderColor: t.border, color: t.text, backgroundColor: t.background }]}
              />
              <View style={styles.row}>
                <Button title="Cancel" variant="secondary" style={styles.flex} onPress={() => setEditing(null)} />
                <Button title="Read fields again" style={styles.flex} onPress={saveCorrection} loading={busy} />
              </View>
            </>
          )}
        </Card>
      ) : (
        <Card tone="dashed">
          <T variant="small">
            {last?.status === 'server_only' ? 'No offline transcript for this clip: the server transcribes it after sync.' : 'The transcript appears here after you save a clip.'}
          </T>
        </Card>
      )}

      <T variant="label">Filled from this section</T>
      {filledKeys.length ? (
        <Card>
          {filledKeys.map((key) => {
            const fv = doc.fields[key];
            return (
              <View key={key} style={[styles.row, local.fieldRow]}>
                <T variant="small" style={styles.flex}>
                  {fieldTitle(key)}
                </T>
                <T variant="heading">{formatValue(fieldForKey(key), fv?.value)}</T>
              </View>
            );
          })}
        </Card>
      ) : (
        <Card tone="dashed">
          <T variant="small">No fields yet.</T>
        </Card>
      )}
      {outcome?.status === 'transcribed' && outcome.note && <T variant="small">{outcome.note}</T>}
    </Screen>
  );
}

const local = StyleSheet.create({
  panel: { flexDirection: 'row', alignItems: 'center', gap: 20, padding: 20, borderRadius: 14 },
  recordButton: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  meter: { height: 8, borderRadius: 4, overflow: 'hidden', marginVertical: 6 },
  meterFill: { height: 8, borderRadius: 4 },
  input: { minHeight: 120, borderWidth: 1.5, borderRadius: 10, padding: 12, fontSize: 17, textAlignVertical: 'top' },
  fieldRow: { minHeight: TOUCH - 16 },
});
