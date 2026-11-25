// The worker's network side: the typed API client, with errors turned into NetworkError
// (try again later) or HttpError (the server answered with an error).
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { api, ApiError } from '@/api';
import type { Clip, Photo } from '@/case/types';
import { HttpError, NetworkError, type SyncTransport } from './types';

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw err.status === 0 ? new NetworkError(err.message) : new HttpError(err.status, err.message);
    throw err;
  }
}

function assertFileExists(uri: string) {
  if (Platform.OS === 'web') return;
  if (!new File(uri).exists) throw new HttpError(410, 'The file is no longer on this phone');
}

const extension = (uri: string, fallback: string) => /\.([a-z0-9]+)(?:\?|$)/i.exec(uri)?.[1] ?? fallback;

export const httpTransport: SyncTransport = {
  push: (ops) => call(() => api.pushOps(ops)),
  pull: (since) => call(() => api.pull(since)),
  async uploadClip(caseId: string, clip: Clip) {
    assertFileExists(clip.uri);
    await call(() =>
      api.uploadClipEvidence(caseId, {
        file: { uri: clip.uri, name: `${clip.clientId}.${extension(clip.uri, 'm4a')}`, type: clip.mimeType },
        section: clip.section,
        clientId: clip.clientId,
        recordedAt: clip.recordedAt,
        durationMs: clip.durationMs,
        ...(clip.transcriptText
          ? { transcript: { text: clip.transcriptText, lang: clip.transcriptLang ?? 'as', engine: clip.transcriptEngine ?? 'unknown' } }
          : {}),
      }),
    );
  },
  async uploadPhoto(caseId: string, photo: Photo) {
    assertFileExists(photo.uri);
    await call(() =>
      api.uploadPhotoEvidence(caseId, {
        file: { uri: photo.uri, name: `${photo.clientId}.${extension(photo.uri, 'jpg')}`, type: photo.mimeType },
        checklistItem: photo.checklistItem,
        takenAt: photo.takenAt,
        clientId: photo.clientId,
        lat: photo.location?.lat,
        lng: photo.location?.lng,
        accuracy: photo.location?.accuracy,
        note: photo.note,
      }),
    );
  },
};
