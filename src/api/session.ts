// Login token + cached officer profile. Native: expo-secure-store (encrypted).
// Web has no secure store, so development builds for web fall back to localStorage.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Officer } from './types';

const TOKEN_KEY = 'voicedar.token';
const OFFICER_KEY = 'voicedar.officer';

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

export const getToken = () => read(TOKEN_KEY);

export async function getCachedOfficer(): Promise<Officer | null> {
  const json = await read(OFFICER_KEY);
  return json ? (JSON.parse(json) as Officer) : null;
}

export async function saveSession(token: string, officer: Officer): Promise<void> {
  await write(TOKEN_KEY, token);
  await write(OFFICER_KEY, JSON.stringify(officer));
}

export async function clearSession(): Promise<void> {
  await write(TOKEN_KEY, null);
  await write(OFFICER_KEY, null);
}
