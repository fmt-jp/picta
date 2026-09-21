import { isNative } from '../platform/env';
import { base64ToBlob, blobToBase64 } from '../platform/base64';
import { getDb, type PhotoRow } from './database';

/**
 * Where photo bytes live.
 *
 * Web / PWA  : inside IndexedDB, in a `photos` store separate from the record
 *              metadata, so record queries never deserialize image data. The
 *              bytes are kept as ArrayBuffers, which every engine — including
 *              older iOS Safari — stores reliably.
 * iOS/Android: as real .jpg files under the app's private data directory, with
 *              only the relative path kept in the DB. SQLite-backed IndexedDB on
 *              mobile is a poor place for hundreds of megabytes of photos.
 */
const PHOTO_DIR = 'photos';

export interface PhotoInput {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
}

function fileNameFor(id: string, mimeType: string): string {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  return `${PHOTO_DIR}/${id}.${ext}`;
}

async function filesystem() {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  return { Filesystem, Directory, Encoding };
}

export async function savePhoto(id: string, input: PhotoInput): Promise<PhotoRow> {
  const row: PhotoRow = {
    id,
    mimeType: input.mimeType,
    width: input.width,
    height: input.height,
    byteSize: input.blob.size,
  };

  if (isNative()) {
    const { Filesystem, Directory } = await filesystem();
    const path = fileNameFor(id, input.mimeType);
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      data: await blobToBase64(input.blob),
      recursive: true,
    });
    row.path = path;
  } else {
    row.bytes = await input.blob.arrayBuffer();
  }

  const db = await getDb();
  await db.put('photos', row);
  return row;
}

export async function getPhotoRow(id: string): Promise<PhotoRow | undefined> {
  const db = await getDb();
  return db.get('photos', id);
}

export async function loadPhotoBlob(id: string): Promise<Blob | null> {
  const row = await getPhotoRow(id);
  if (!row) return null;
  if (row.bytes) return new Blob([row.bytes], { type: row.mimeType });
  if (!row.path) return null;

  const { Filesystem, Directory } = await filesystem();
  try {
    const file = await Filesystem.readFile({ path: row.path, directory: Directory.Data });
    const data = typeof file.data === 'string' ? file.data : await blobToBase64(file.data);
    return base64ToBlob(data, row.mimeType);
  } catch {
    return null;
  }
}

export async function deletePhoto(id: string): Promise<void> {
  const row = await getPhotoRow(id);
  if (row?.path) {
    const { Filesystem, Directory } = await filesystem();
    await Filesystem.deleteFile({ path: row.path, directory: Directory.Data }).catch(() => {
      /* Already gone — deleting the metadata row is what matters. */
    });
  }
  const db = await getDb();
  await db.delete('photos', id);
}

/** Rough on-device usage, shown in 設定 so the user can see photos adding up. */
export async function photoUsage(): Promise<{ count: number; bytes: number }> {
  const db = await getDb();
  const rows = await db.getAll('photos');
  return {
    count: rows.length,
    bytes: rows.reduce((sum, r) => sum + (r.byteSize || 0), 0),
  };
}
