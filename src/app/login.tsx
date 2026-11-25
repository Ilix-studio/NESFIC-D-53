import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { Button, Screen, T } from '@/components/ui';
import { TOUCH, useTheme } from '@/constants/theme';

export default function LoginScreen() {
  const t = useTheme();
  const { login } = useAuth();
  // Development only: the demo officer created by `npm run seed` in server/.
  const [badgeNo, setBadgeNo] = useState(__DEV__ ? 'IO-1001' : '');
  const [password, setPassword] = useState(__DEV__ ? 'demo1234' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(badgeNo.trim(), password);
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const input = [local.input, { borderColor: t.border, color: t.text, backgroundColor: t.background }];
  return (
    <Screen>
      <T variant="title">Officer login</T>
      <T variant="label">Badge number</T>
      <TextInput style={input} value={badgeNo} onChangeText={setBadgeNo} autoCapitalize="characters" autoCorrect={false} />
      <T variant="label">Password</T>
      <TextInput style={input} value={password} onChangeText={setPassword} secureTextEntry onSubmitEditing={submit} />
      {error && <T color={t.danger}>{error}</T>}
      <Button title="Log in" onPress={submit} loading={busy} disabled={!badgeNo || !password} />
    </Screen>
  );
}

const local = StyleSheet.create({
  input: { minHeight: TOUCH, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, fontSize: 18 },
});
