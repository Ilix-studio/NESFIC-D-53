// Offline engines (OFFLINE-PLAN phase O3): which languages are ready offline, model downloads
// (Wi-Fi only, SHA-256 checked), and the demo speech engine used in Expo Go.
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { onDeviceRuntime } from '@/asr/on-device';
import { Button, Card, Pill, ProgressBar, Screen, styles, T } from '@/components/ui';
import { useRepo, useRepoData } from '@/db';
import { CASE_LANGS, getLang, type CaseLang } from '@/lang';
import { deleteModel, downloadBlocker, downloadModel, freeStorageBytes, modelFor, modelStatus } from '@/models/ModelManager';

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

function LanguageCard({ lang, demoOn }: { lang: CaseLang; demoOn: boolean }) {
  const entry = modelFor(lang);
  // Bumped after a download or delete so the status below is read again.
  const [version, setVersion] = useState(0);
  const status = useRepoData(`model:${lang}:${version}`, () => modelStatus(lang));
  const blocker = useRepoData(`model-blocker:${lang}:${version}`, async () => (entry ? downloadBlocker(entry) : 'No model for this language yet'));
  const [progress, setProgress] = useState<number | null>(null);
  const pack = getLang(lang);
  const runtime = onDeviceRuntime();
  const ready = status?.state === 'installed' && runtime.available;

  const download = async () => {
    if (!entry) return;
    setProgress(0);
    try {
      await downloadModel(entry, setProgress);
    } catch (err) {
      Alert.alert('Download failed', err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
      setVersion((v) => v + 1);
    }
  };
  const remove = () => {
    if (entry) deleteModel(entry);
    setVersion((v) => v + 1);
  };

  return (
    <Card>
      <View style={styles.row}>
        <T variant="heading" style={styles.flex}>
          {pack.name} · {pack.name_en}
        </T>
        <Pill tone={ready ? 'ok' : 'warn'} text={ready ? 'Ready offline' : demoOn && lang !== 'brx' ? 'Demo only' : 'Server after sync'} />
      </View>
      <T variant="small">{entry?.label ?? 'No model listed'}</T>
      <T variant="small">
        Model:{' '}
        {status?.state === 'installed'
          ? `installed (${mb(status.sizeBytes)})`
          : status?.state === 'not_installed'
            ? `not downloaded (${mb(entry!.sizeBytes)})`
            : 'none published for this language yet'}
      </T>
      {pack.placeholder && <T variant="small">Language pack: PLACEHOLDER (keywords and questions need checking by native speakers).</T>}
      {progress !== null && <ProgressBar percent={Math.round(progress * 100)} label="Downloading" />}
      {status?.state === 'installed' ? (
        <Button title="Delete model" variant="secondary" onPress={remove} />
      ) : (
        entry && (
          <Button
            title={blocker ?? 'Download over Wi-Fi'}
            variant="secondary"
            onPress={download}
            loading={progress !== null}
            disabled={Boolean(blocker) || progress !== null}
          />
        )
      )}
    </Card>
  );
}

export default function EnginesScreen() {
  const repo = useRepo();
  const demo = useRepoData('meta:demo_asr', (r) => r.getMeta('demo_asr'));
  const demoOn = demo !== 'off';
  const runtime = onDeviceRuntime();
  const free = freeStorageBytes();

  return (
    <Screen>
      <T variant="title">Offline engines</T>
      <T variant="small">
        The phone always does the first pass with no network: speech → transcript → eDAR fields → checks. After sync, the server
        re-checks each clip and sends differences back as suggestions you accept or reject.
      </T>

      <Card tone={runtime.available ? 'default' : 'warn'}>
        <T variant="heading">On-device speech runtime</T>
        <T variant="small">{runtime.available ? 'Available.' : runtime.reason}</T>
        {free !== null && <T variant="small">Free storage: {gb(free)} (each language model is about 200 MB)</T>}
      </Card>

      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <T variant="heading">Demo speech engine</T>
            <T variant="small">
              For trying the app in Expo Go: ignores the recording and returns a SYNTHETIC Assamese (or Bengali) transcript from the test
              data. Turn it off to see what happens with no offline engine (clips are transcribed by the server after sync).
            </T>
          </View>
          <Switch value={demoOn} onValueChange={(on) => repo.setMeta('demo_asr', on ? 'on' : 'off')} accessibilityLabel="Demo speech engine" />
        </View>
      </Card>

      <T variant="label">Languages</T>
      {CASE_LANGS.map((lang) => (
        <LanguageCard key={lang} lang={lang} demoOn={demoOn} />
      ))}
    </Screen>
  );
}
