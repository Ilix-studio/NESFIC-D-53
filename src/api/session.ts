// Login token + cached officer profile. Native: expo-secure-store (encrypted).
// Web has no secure store, so development builds for web fall back to localStorage.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Officer } from './types';
import { packVoiceprint, unpackVoiceprint } from './voiceprint';

const TOKEN_KEY = 'voicedar.token';
const OFFICER_KEY = 'voicedar.officer';
// The voiceprint is kept under its own key, packed, so neither value passes SecureStore's 2 KB.
const VOICEPRINT_KEY = 'voicedar.voiceprint';

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
  if (!json) return null;
  const officer = JSON.parse(json) as Officer;
  if (officer.voice) {
    const packed = await read(VOICEPRINT_KEY);
    if (packed) officer.voice = { ...officer.voice, embedding: unpackVoiceprint(packed) };
    else delete officer.voice;
  }
  return officer;
}

export async function saveSession(token: string, officer: Officer): Promise<void> {
  const { voice, ...profile } = officer;
  await write(TOKEN_KEY, token);
  await write(VOICEPRINT_KEY, voice ? packVoiceprint(voice.embedding) : null);
  await write(OFFICER_KEY, JSON.stringify(voice ? { ...profile, voice: { ...voice, embedding: [] } } : profile));
}

export async function clearSession(): Promise<void> {
  await write(TOKEN_KEY, null);
  await write(OFFICER_KEY, null);
  await write(VOICEPRINT_KEY, null);
}
