// The IO's voiceprint: after the first login (and "Record again" in Settings) the officer picks a
// language and reads its passage aloud once. The server turns the recording into a voiceprint
// (256 numbers) and deletes the recording. Every case clip is then compared with it, on the
// phone (src/speaker) and again on the server after sync. A mismatch is flagged, never blocked.
import { useNetInfo } from '@react-native-community/netinfo';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api, ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { Button, Card, Pill, Screen, styles, T } from '@/components/ui';
import { CLIP_MIME, useClipRecorder } from '@/hooks/use-clip-recorder';
import { CASE_LANGS, getLang, isCaseLang, type CaseLang } from '@/lang';
import { MIN_ENROL_SECONDS, VOICE_PASSAGES } from '@/speaker';
import { caseLangChosen, useAppDispatch, useAppSelector } from '@/store';

export default function VoiceScreen() {
  const { officer, updateOfficer } = useAuth();
  const dispatch = useAppDispatch();
  const lastLang = useAppSelector((s) => s.settings.caseLang);
  const enrolledLang = officer?.voice?.lang;
  const [lang, setLang] = useState<CaseLang>(enrolledLang && isCaseLang(enrolledLang) ? enrolledLang : lastLang);
  const recorder = useClipRecorder();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useNetInfo().isConnected !== false;
  const passage = VOICE_PASSAGES.find((p) => p.lang === lang);
  const seconds = Math.floor((recorder.durationMs ?? 0) / 1000);

  if (!officer) {
    return (
      <Screen>
        <T>Log in first.</T>
        <Button title="Log in" onPress={() => router.replace('/login')} />
      </Screen>
    );
  }

  const toggle = async () => {
    setError(null);
    if (!recorder.isRecording) {
      await recorder.start();
      return;
    }
    const clip = await recorder.stop();
    if (!clip || !passage) return;
    if (clip.durationMs < MIN_ENROL_SECONDS * 1000) {
      setError(`Read the whole passage: at least ${MIN_ENROL_SECONDS} seconds.`);
      return;
    }
    setBusy(true);
    try {
      const name = `passage.${CLIP_MIME === 'audio/webm' ? 'webm' : 'm4a'}`;
      const res = await api.enrolVoice({ file: { uri: clip.uri, name, type: CLIP_MIME }, lang, passageId: passage.id });
      await updateOfficer(res.officer);
      dispatch(caseLangChosen(lang));
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError && err.status > 0 ? err.message : 'Could not save the voiceprint. Check the network and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          title={busy ? 'Saving voiceprint…' : recorder.isRecording ? `Stop and save (${seconds} s)` : 'Start reading aloud'}
          onPress={toggle}
          loading={busy}
          disabled={busy || (!online && !recorder.isRecording)}
        />
      }
    >
      <T variant="title">Your voiceprint</T>
      <T variant="small">
        Read the passage below aloud once, in a quiet place, at your normal speed. Every recording in your cases is then checked against
        your voice, so a clip spoken by someone else is flagged for review. It never stops you recording.
      </T>
      <T variant="small">
        Only the voiceprint (a list of 256 numbers) is kept, with your account. The recording itself is deleted once the voiceprint is
        made.
      </T>
      {officer.voice && <Pill tone="ok" text={`Recorded ${new Date(officer.voice.enrolledAt).toLocaleDateString()}: reading again replaces it`} />}
      {!online && <Pill tone="warn" text="Needs network: connect to station Wi-Fi" />}

      <T variant="label">Language</T>
      <View style={styles.row}>
        {CASE_LANGS.map((code) => (
          <Button
            key={code}
            title={getLang(code).name}
            variant={code === lang ? 'primary' : 'secondary'}
            onPress={() => setLang(code)}
            disabled={recorder.isRecording || busy}
          />
        ))}
      </View>

      {passage ? (
        <Card>
          {passage.status !== 'reviewed' && (
            <Pill tone="warn" text={passage.status === 'placeholder' ? 'PLACEHOLDER text: needs a native speaker' : 'Draft text: native-speaker check pending'} />
          )}
          <T style={{ fontSize: 20, lineHeight: 34 }}>{passage.text}</T>
          <T variant="small">{passage.en}</T>
        </Card>
      ) : (
        <T>No passage for this language yet.</T>
      )}

      {recorder.isRecording && <Pill tone="muted" text={`Recording… ${seconds} s (at least ${MIN_ENROL_SECONDS} s)`} />}
      {(error ?? recorder.error) && <T variant="small">{error ?? recorder.error}</T>}
    </Screen>
  );
}
