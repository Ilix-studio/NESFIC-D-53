// Downloads, checks and deletes on-device models. Wi-Fi only, free-storage check first, and a
// SHA-256 check after download (a file that fails it is deleted). Files live in app storage.
import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';

import type { CaseLang } from '@/lang';
import { MODEL_MANIFEST, type ModelEntry } from './manifest';

export type ModelState = { state: 'installed'; sizeBytes: number } | { state: 'not_installed' } | { state: 'not_published' };

const modelsDir = () => new Directory(Paths.document, 'models');
/** What a download needs: speech models (ModelEntry) and the speaker model both fit. */
export type PinnedModel = Pick<ModelEntry, 'id' | 'url' | 'sizeBytes' | 'sha256'>;

export const modelFile = (entry: PinnedModel) => new File(modelsDir(), `${entry.id}.onnx`);

export const modelFor = (lang: CaseLang) => MODEL_MANIFEST.find((m) => m.lang === lang);

export async function modelStatus(lang: CaseLang): Promise<ModelState> {
  const entry = modelFor(lang);
  if (!entry) return { state: 'not_published' };
  try {
    const file = modelFile(entry);
    if (file.exists) return { state: 'installed', sizeBytes: file.size ?? 0 };
  } catch {
    // no file system (web) or not readable: treat as not installed
  }
  return { state: 'not_installed' };
}

export function freeStorageBytes(): number | null {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return null;
  }
}

/** Why a download cannot start now, or null if it can. */
export async function downloadBlocker(entry: PinnedModel): Promise<string | null> {
  const net = await NetInfo.fetch();
  if (net.type !== 'wifi') return 'Connect to station Wi-Fi to download models.';
  const free = freeStorageBytes();
  if (free !== null && free < entry.sizeBytes * 1.2) return 'Not enough free storage on this phone.';
  return null;
}

export async function downloadModel(entry: PinnedModel, onProgress?: (fraction: number) => void): Promise<void> {
  const blocker = await downloadBlocker(entry);
  if (blocker) throw new Error(blocker);
  const dir = modelsDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const partial = new File(dir, `${entry.id}.part`);
  if (partial.exists) partial.delete();
  await File.downloadFileAsync(entry.url, partial, {
    idempotent: true,
    onProgress: ({ bytesWritten }) => onProgress?.(Math.min(1, bytesWritten / entry.sizeBytes)),
  });
  const digest = (await partial.digest('SHA-256')).toLowerCase();
  if (digest !== entry.sha256.toLowerCase()) {
    partial.delete();
    throw new Error('The downloaded model failed its SHA-256 check and was deleted.');
  }
  const target = modelFile(entry);
  if (target.exists) target.delete();
  partial.move(target);
}

export function deleteModel(entry: PinnedModel): void {
  const file = modelFile(entry);
  if (file.exists) file.delete();
}
