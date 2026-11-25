import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { Screen, T } from '@/components/ui';
import { openRepo, RepoProvider, type Repo } from '@/db';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SyncProvider } from '@/sync/SyncContext';

SplashScreen.preventAutoHideAsync();

function Navigator() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerBackTitle: 'Back' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="cases" options={{ title: 'Cases' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings & sync' }} />
      <Stack.Screen name="login" options={{ title: 'Officer login', presentation: 'modal' }} />
      <Stack.Screen name="engines" options={{ title: 'Offline engines' }} />
      <Stack.Screen name="case/[id]/index" options={{ title: 'Case' }} />
      <Stack.Screen name="case/[id]/record/[section]" options={{ title: 'Record a section' }} />
      <Stack.Screen name="case/[id]/followup" options={{ title: 'Follow-up questions' }} />
      <Stack.Screen name="case/[id]/photos" options={{ title: 'Scene photos' }} />
      <Stack.Screen name="case/[id]/review" options={{ title: 'Officer review' }} />
      <Stack.Screen name="case/[id]/submit" options={{ title: 'Submit' }} />
    </Stack>
  );
}

/** Opens the phone database before any screen renders; everything is saved there first. */
function Bootstrap() {
  const { ready } = useAuth();
  const [repo, setRepo] = useState<Repo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openRepo().then(setRepo, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => {
    if (ready && (repo || error)) SplashScreen.hideAsync();
  }, [ready, repo, error]);

  if (error) {
    return (
      <Screen>
        <T variant="title">Could not open the phone database</T>
        <T>{error}</T>
        <T variant="small">VoiceDAR stores every case on the phone first. Run it on an Android phone (Expo Go or the development build).</T>
      </Screen>
    );
  }
  if (!repo || !ready) return null;
  return (
    <RepoProvider repo={repo}>
      <SyncProvider>
        <Navigator />
      </SyncProvider>
    </RepoProvider>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <StatusBar style="auto" />
        <Bootstrap />
      </AuthProvider>
    </ThemeProvider>
  );
}
