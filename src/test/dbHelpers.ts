import 'fake-indexeddb/auto';
import { DB_NAME, closeDb } from '../db/database';

/** Give every test a pristine database. */
export async function freshDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export function samplePhoto(bytes = 32) {
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    width: 1200,
    height: 900,
  };
}
