import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const SERVER_PORT = 8080;

/**
 * Where the VoiceDAR server is.
 * 1. EXPO_PUBLIC_API_URL in client/.env wins (use it for tunnels or a deployed server).
 * 2. In development on a phone/emulator, use the same computer that serves the JS bundle
 *    (Expo's hostUri, e.g. 192.168.1.5:8081) on port 8080.
 * 3. Otherwise (web) localhost.
 */
export function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (devHost && Platform.OS !== 'web') return `http://${devHost}:${SERVER_PORT}/api/v1`;
  return `http://localhost:${SERVER_PORT}/api/v1`;
}

export const API_URL = resolveApiUrl();
