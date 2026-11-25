// Settings: officer login, sync status, offline engines and the server connection.
// Kept off the main flow (Welcome -> Cases -> Case); opened from the welcome screen.
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { API_URL } from '@/api';
import { onDeviceRuntime } from '@/asr/on-device';
import { useAuth } from '@/auth/AuthContext';
import { Button, Card, Pill, Screen, styles, T } from '@/components/ui';
import { SyncCard } from '@/components/SyncCard';
import { useRepoData } from '@/db';
import { useServerStatus } from '@/hooks/use-server-status';

function ServerCard() {
  const { status, refresh } = useServerStatus();
  return (
    <Card>
      <View style={styles.row}>
        <T variant="heading" style={styles.flex}>
          Server
        </T>
        {status.state === 'checking' && <ActivityIndicator />}
        {status.state === 'online' && <Pill tone="ok" text="Connected" />}
        {status.state === 'offline' && <Pill tone="warn" text="Not reachable" />}
      </View>
      {status.state === 'online' && (
        <T variant="small">
          Re-checks synced clips with: {status.health.engines.asr} speech engine · {status.health.engines.mapper} mapper
        </T>
      )}
      {status.state === 'offline' && <T variant="small">Everything still works on this phone. It syncs when the server is reachable.</T>}
      <T variant="small" selectable>
        {API_URL}
      </T>
      <Button title="Check again" variant="secondary" onPress={refresh} disabled={status.state === 'checking'} />
    </Card>
  );
}

function OfficerCard() {
  const { officer, logout } = useAuth();
  if (!officer) {
    return (
      <Card tone="warn">
        <T variant="heading">Not logged in</T>
        <T variant="small">Log in once at the station. The police station and IO name then fill every case, even offline, and sync can run.</T>
        <Button title="Log in" onPress={() => router.push('/login')} />
      </Card>
    );
  }
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.flex}>
          <T variant="heading">{officer.name}</T>
          <T variant="small">
            {officer.badgeNo} · {officer.policeStation}
          </T>
        </View>
        <Button title="Log out" variant="secondary" onPress={logout} />
      </View>
      {officer.voice ? (
        <Pressable onPress={() => router.push('/voice')} accessibilityRole="button">
          <T variant="small">Voiceprint recorded {new Date(officer.voice.enrolledAt).toLocaleDateString()} · Record again ›</T>
        </Pressable>
      ) : (
        <Button title="Record your voiceprint" onPress={() => router.push('/voice')} />
      )}
    </Card>
  );
}

function EnginesCard() {
  const demo = useRepoData('meta:demo_asr', (r) => r.getMeta('demo_asr'));
  const runtime = onDeviceRuntime();
  return (
    <Card onPress={() => router.push('/engines')}>
      <View style={styles.row}>
        <T variant="heading" style={styles.flex}>
          Offline engines
        </T>
        <T variant="heading">›</T>
      </View>
      <T variant="small">
        Speech on this phone: {runtime.available ? 'on-device model' : demo === 'off' ? 'none (server after sync)' : 'demo engine (synthetic transcripts)'} ·
        fields: rule mapper · checks: 5 rules
      </T>
    </Card>
  );
}

export default function SettingsScreen() {
  return (
    <Screen>
      <OfficerCard />
      <SyncCard />
      <EnginesCard />
      <ServerCard />
    </Screen>
  );
}
