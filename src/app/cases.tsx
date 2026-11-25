// Cases on this phone, newest first, with "New case" at the bottom. Opened from the welcome screen.
// The settings icon (top right) opens login, settings and sync.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { openCase, setLocation } from '@/case/commands';
import { Button, Card, Pill, ProgressBar, Screen, styles, T } from '@/components/ui';
import { TOUCH, useTheme } from '@/constants/theme';
import { useRepo, useRepoData, type CaseSummary } from '@/db';
import { getLang } from '@/lang';
import { useAppSelector } from '@/store';
import { formatDateTime } from '@/utils/format';
import { currentLocation } from '@/utils/location';
import { uuidv7 } from '@/utils/uuid';

/** Header button: settings and sync (also where the officer logs in). */
function SettingsButton() {
  const t = useTheme();
  const { officer } = useAuth();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={officer ? `Settings and sync. Logged in as ${officer.name}` : 'Settings and sync. Not logged in'}
      onPress={() => router.push('/settings')}
      hitSlop={8}
      style={{ minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}
    >
      <MaterialCommunityIcons name="cog-outline" size={26} color={t.primary} />
    </Pressable>
  );
}

const STATUS_LABEL = { draft: 'Draft', in_review: 'In review', signed: 'Signed' } as const;

function CaseCard({ c }: { c: CaseSummary }) {
  const sync = c.rejectedOps
    ? { tone: 'warn' as const, text: `${c.rejectedOps} not accepted` }
    : c.pendingOps
      ? { tone: 'muted' as const, text: `${c.pendingOps} to sync` }
      : { tone: 'ok' as const, text: 'Synced' };
  return (
    <Card onPress={() => router.push({ pathname: '/case/[id]', params: { id: c.clientId } })}>
      <View style={styles.row}>
        <T variant="heading" style={styles.flex}>
          {formatDateTime(new Date(c.startedAt))}
        </T>
        <Pill tone={c.status === 'signed' ? 'ok' : 'muted'} text={STATUS_LABEL[c.status]} />
      </View>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Pill tone={sync.tone} text={sync.text} />
        {c.openProposals > 0 && <Pill tone="warn" text={`${c.openProposals} server suggestion${c.openProposals === 1 ? '' : 's'}`} />}
        <T variant="small">
          {getLang(c.lang).name} · {c.clipCount} clips · {c.photoCount} photos
        </T>
      </View>
      <ProgressBar percent={c.completeness.percent} />
    </Card>
  );
}

export default function CasesScreen() {
  const repo = useRepo();
  const { officer } = useAuth();
  const caseLang = useAppSelector((st) => st.settings.caseLang);
  const cases = useRepoData('cases', (r) => r.listCases());
  const [creating, setCreating] = useState(false);

  const newCase = async () => {
    setCreating(true);
    try {
      const clientId = uuidv7();
      await repo.commit(null, openCase({ clientId, now: new Date().toISOString(), officer, lang: caseLang }));
      router.push({ pathname: '/case/[id]', params: { id: clientId } });
      // GPS can take a few seconds outdoors; the case does not wait for it.
      currentLocation().then((loc) => {
        if (loc) repo.update(clientId, (d) => setLocation(d, loc, new Date().toISOString())).catch(() => undefined);
      });
    } catch (err) {
      Alert.alert('Could not create the case', err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Screen footer={<Button title="New case" onPress={newCase} loading={creating} />}>
      <Stack.Screen options={{ headerRight: () => <SettingsButton /> }} />
      {cases === undefined ? (
        <ActivityIndicator />
      ) : cases.length === 0 ? (
        <Card tone="dashed">
          <T variant="small">No cases yet. Tap “New case” at a crash scene. It works without network.</T>
        </Card>
      ) : (
        <>
          <T variant="label">
            {cases.length} case{cases.length === 1 ? '' : 's'} on this phone
          </T>
          {cases.map((c) => (
            <CaseCard key={c.clientId} c={c} />
          ))}
        </>
      )}
    </Screen>
  );
}
