// Sync status badge (OFFLINE-PLAN phase O1): pending changes, last sync, and "Sync now".
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, Pill, styles, T } from '@/components/ui';
import { useSync } from '@/sync/SyncContext';
import { formatDateTime } from '@/utils/format';

export function SyncCard() {
  const { running, online, loggedIn, stats, lastReport, syncNow } = useSync();
  const pending = stats?.pending ?? 0;
  const rejected = stats?.rejected ?? 0;
  const tone = !online || !loggedIn || stats?.lastError ? 'warn' : pending ? 'muted' : 'ok';
  const label = running
    ? 'Syncing…'
    : !online
      ? 'Offline'
      : !loggedIn
        ? 'Log in to sync'
        : pending
          ? `${pending} waiting`
          : 'All synced';

  return (
    <Card>
      <View style={styles.row}>
        <T variant="heading" style={styles.flex}>
          Sync
        </T>
        {running ? <ActivityIndicator /> : <Pill tone={tone} text={label} />}
      </View>
      <T variant="small">
        {pending} change{pending === 1 ? '' : 's'} waiting on this phone
        {stats?.lastSyncAt ? ` · last synced ${formatDateTime(new Date(stats.lastSyncAt))}` : ' · never synced'}
      </T>
      {rejected > 0 && <T variant="small">{rejected} change(s) were not accepted by the server. Open the case and go to Submit to see why.</T>}
      {stats?.lastError && !running && <T variant="small">Last attempt: {stats.lastError}</T>}
      {lastReport && !lastReport.error && lastReport.pulled > 0 && <T variant="small">{lastReport.pulled} update(s) received from the server.</T>}
      <Button title="Sync now" variant="secondary" onPress={syncNow} disabled={running || !loggedIn || !online} />
    </Card>
  );
}
