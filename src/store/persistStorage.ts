// redux-persist storage in the phone's documents folder, using expo-file-system's File API.
// (redux-persist-expo-file-system-storage calls the SDK 51 functions, which throw in SDK 58.)
// The files are plain JSON, so only non-sensitive state is persisted: the login token and
// profile stay in expo-secure-store, and case data in SQLite.
import { Directory, File, Paths } from 'expo-file-system';
import type { Storage } from 'redux-persist';

const dir = new Directory(Paths.document, 'redux-persist');
const fileFor = (key: string) => new File(dir, `${encodeURIComponent(key)}.json`);

export const persistStorage: Storage = {
  async getItem(key: string) {
    const file = fileFor(key);
    return file.exists ? file.text() : null;
  },
  async setItem(key: string, value: string) {
    if (!dir.exists) dir.create({ intermediates: true });
    const file = fileFor(key);
    if (!file.exists) file.create();
    await file.write(value);
  },
  async removeItem(key: string) {
    const file = fileFor(key);
    if (file.exists) file.delete();
  },
};
