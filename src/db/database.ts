import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Record, Tag } from '../types';
import { newId } from './ids';

/**
 * Storage layout
 * --------------
 * `records` holds metadata only. Photo bytes live in `photos`, keyed by
 * `Record.photoId`, so listing or searching records never pulls image data
 * into memory. On native builds the `photos` row keeps only a file path and
 * the JPEG itself is written to the app's private Filesystem directory
 * (see photoStore.ts) — the DB / file-storage split the spec calls for.
 */
export interface PhotoRow {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  /**
   * Web builds: the JPEG bytes. Stored as an ArrayBuffer rather than a Blob —
   * older Safari versions lose Blob values kept in IndexedDB, and iOS Safari is
   * one of Picta's targets.
   */
  bytes?: ArrayBuffer;
  /** Native builds: path relative to the app data directory. */
  path?: string;
}

interface PictaSchema extends DBSchema {
  records: {
    key: string;
    value: Record;
    indexes: { capturedAt: number };
  };
  photos: {
    key: string;
    value: PhotoRow;
  };
  tags: {
    key: string;
    value: Tag;
    indexes: { name: string };
  };
}

export const DB_NAME = 'picta';
export const DB_VERSION = 1;

/** Shipped with the app so the very first capture already has tags to pick. */
export const DEFAULT_TAGS = [
  '旅行',
  'グルメ',
  '買い物',
  '仕事',
  '家',
  'DIY',
  '行きたい',
  '買いたい',
  '確認',
];

export type PictaDB = IDBPDatabase<PictaSchema>;

let dbPromise: Promise<PictaDB> | null = null;

export function getDb(): Promise<PictaDB> {
  if (!dbPromise) {
    dbPromise = openDB<PictaSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const records = db.createObjectStore('records', { keyPath: 'id' });
          records.createIndex('capturedAt', 'capturedAt');

          db.createObjectStore('photos', { keyPath: 'id' });

          const tags = db.createObjectStore('tags', { keyPath: 'id' });
          tags.createIndex('name', 'name', { unique: true });

          const now = Date.now();
          DEFAULT_TAGS.forEach((name, i) => {
            tx.objectStore('tags').put({ id: newId(), name, createdAt: now + i });
          });
        }
      },
      blocked() {
        console.warn('Picta: 別のタブがデータベースを使用中です。');
      },
    });
  }
  return dbPromise;
}

/** Closes the shared connection (used by tests and by データ全削除). */
export async function closeDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    /* Already closed. */
  }
}
