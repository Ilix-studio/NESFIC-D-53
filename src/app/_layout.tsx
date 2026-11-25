import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';

import { SessionRestorer, useAuth } from '@/auth/AuthContext';
import { Screen, T } from '@/components/ui';
import { openRepo, RepoProvider, type Repo } from '@/db';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { persistor, store } from '@/store';
import { SyncRunner } from '@/sync/SyncContext';

SplashScreen.preventAutoHideAsync();

function Navigator() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerBackTitle: 'Back' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="cases" options={{ title: 'Cases' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings & sync' }} />
      <Stack.Screen name="login" options={{ title: 'Officer login', presentation: 'modal' }} />
      <Stack.Screen name="voice" options={{ title: 'Your voiceprint' }} />
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
      <SyncRunner />
      <Navigator />
    </RepoProvider>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <Provider store={store}>
      <PersistGate persistor={persistor} loading={null}>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <SessionRestorer />
          <StatusBar style="auto" />
          <Bootstrap />
        </ThemeProvider>
      </PersistGate>
    </Provider>
  );
}
