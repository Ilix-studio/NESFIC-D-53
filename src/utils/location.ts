import * as Location from 'expo-location';

import type { LatLng } from '@/schema';

const toLatLng = (pos: Location.LocationObject): LatLng => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  ...(pos.coords.accuracy != null ? { accuracy: Math.round(pos.coords.accuracy) } : {}),
});

/** Current GPS position, or the last known one if a fix takes too long. null if not allowed. */
export async function currentLocation(timeoutMs = 10_000): Promise<LatLng | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 }).catch(() => null);
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]).catch(() => null);
    const pos = fresh ?? last;
    return pos ? toLatLng(pos) : null;
  } catch {
    return null;
  }
}
