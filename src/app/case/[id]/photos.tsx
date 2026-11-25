// Wireframe 4: Scene photo checklist. Each photo is copied into app storage, stamped with
// time + GPS, saved in SQLite and queued for upload (one file per request after sync).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, View } from 'react-native';

import type { Photo, PhotoChecklistItem } from '@/case/types';
import { Button, Card, Screen, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useRepo, useRepoData } from '@/db';
import { formatDateTime } from '@/utils/format';
import { currentLocation } from '@/utils/location';
import { uuidv7 } from '@/utils/uuid';

const CHECKLIST: { id: PhotoChecklistItem; label: string; hint?: string }[] = [
  { id: 'road_surface', label: 'Road surface' },
  { id: 'vehicle_positions', label: 'Vehicle positions' },
  { id: 'skid_marks', label: 'Skid marks' },
  { id: 'lighting', label: 'Lighting at spot' },
  { id: 'signs', label: 'Road signs' },
  { id: 'number_plates', label: 'Number plates', hint: 'Plate reading (ML Kit) needs the development build' },
];

/** Moves the camera file out of the cache into app storage, so it is kept as evidence. */
function keepFile(uri: string, clientId: string): string {
  if (Platform.OS === 'web') return uri;
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, `${clientId}.jpg`);
  new File(uri).copySync(target);
  return target.uri;
}

export default function PhotosScreen() {
  const t = useTheme();
  const repo = useRepo();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useRepoData(`case:${id}`, (r) => r.loadCase(id));
  const photos = useRepoData(`photos:${id}`, (r) => r.listPhotos(id)) ?? [];
  const [busy, setBusy] = useState<PhotoChecklistItem | null>(null);
  const locked = doc?.status === 'signed';

  const take = async (item: PhotoChecklistItem) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera not allowed', 'Allow the camera to take scene photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false });
    if (result.canceled || !result.assets[0]) return;
    setBusy(item);
    try {
      const clientId = uuidv7();
      const takenAt = new Date().toISOString();
      const location = await currentLocation(5_000);
      const photo: Photo = {
        clientId,
        caseId: id,
        checklistItem: item,
        uri: keepFile(result.assets[0].uri, clientId),
        mimeType: 'image/jpeg',
        takenAt,
        ...(location ? { location } : {}),
      };
      await repo.addPhoto(photo, { id: uuidv7(), caseId: id, type: 'photo_added', at: takenAt, meta: { photoId: clientId, checklistItem: item, gps: Boolean(location) } });
    } catch (err) {
      Alert.alert('Photo not saved', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const done = new Set(photos.map((p) => p.checklistItem));

  return (
    <Screen
      footer={
        <>
          <T variant="heading">
            {done.size} of {CHECKLIST.length} taken
          </T>
          <Button title="Review report" onPress={() => router.push({ pathname: '/case/[id]/review', params: { id } })} />
        </>
      }>
      <T variant="title">Scene photos</T>
      <T variant="small">Capture details that disappear once the scene is cleared. Each photo is stamped with time and GPS and kept on the phone.</T>
      <View style={local.grid}>
        {CHECKLIST.map((item) => {
          const latest = [...photos].reverse().find((p) => p.checklistItem === item.id);
          return (
            <Card key={item.id} tone={latest ? 'default' : 'dashed'} style={local.tile} onPress={locked || busy ? undefined : () => take(item.id)}>
              {busy === item.id ? (
                <ActivityIndicator />
              ) : latest ? (
                <Image source={{ uri: latest.uri }} style={local.thumb} contentFit="cover" />
              ) : (
                <MaterialCommunityIcons name="camera-outline" size={30} color={t.muted} />
              )}
              <T variant="heading" style={local.center}>
                {item.label}
              </T>
              <T variant="small" style={local.center}>
                {latest ? `${formatDateTime(new Date(latest.takenAt))}${latest.location ? ' · GPS' : ' · no GPS'}` : (item.hint ?? 'Tap to take')}
              </T>
            </Card>
          );
        })}
      </View>
      {locked && <T variant="small">This case is signed. Photos taken before signing still upload.</T>}
    </Screen>
  );
}

const local = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47%', minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: 90, borderRadius: 8 },
  center: { textAlign: 'center' },
});
