import type { Record } from '../types';
import { photoStamp } from '../capture/imageUtil';
import { getDb } from './database';
import { newId } from './ids';
import { deletePhoto, savePhoto, type PhotoInput } from './photoStore';
import { ensureTag, normalizeTagName } from './tags';

export interface NewRecordInput {
  photo: PhotoInput;
  memo: string;
  tags: string[];
  capturedAt: number;
}

/** Newest first — the order every list in Picta uses. */
function byCapturedAtDesc(a: Record, b: Record): number {
  return b.capturedAt - a.capturedAt || b.createdAt - a.createdAt;
}

export function photoFileNameFor(capturedAt: number, mimeType: string): string {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  return `${photoStamp(new Date(capturedAt))}.${ext}`;
}

export async function createRecord(input: NewRecordInput): Promise<Record> {
  const tags = dedupeTags(input.tags);
  // Tags typed into "＋ 新しいタグ" become registered tags for next time.
  for (const name of tags) await ensureTag(name);

  const photoId = newId();
  await savePhoto(photoId, input.photo);

  const now = Date.now();
  const record: Record = {
    id: newId(),
    photoId,
    photoFileName: photoFileNameFor(input.capturedAt, input.photo.mimeType),
    memo: input.memo.trim(),
    tags,
    capturedAt: input.capturedAt,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  try {
    await db.put('records', record);
  } catch (err) {
    // Never leave an orphaned photo behind.
    await deletePhoto(photoId).catch(() => {});
    throw err;
  }
  return record;
}

export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const name = normalizeTagName(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export async function listRecords(): Promise<Record[]> {
  const db = await getDb();
  const all = await db.getAll('records');
  return all.sort(byCapturedAtDesc);
}

export async function getRecord(id: string): Promise<Record | undefined> {
  const db = await getDb();
  return db.get('records', id);
}

export async function updateRecord(
  id: string,
  patch: { memo?: string; tags?: string[] },
): Promise<Record> {
  const db = await getDb();
  const current = await db.get('records', id);
  if (!current) throw new Error('記録が見つかりません');

  const tags = patch.tags ? dedupeTags(patch.tags) : current.tags;
  if (patch.tags) for (const name of tags) await ensureTag(name);

  const next: Record = {
    ...current,
    memo: patch.memo !== undefined ? patch.memo.trim() : current.memo,
    tags,
    updatedAt: Date.now(),
  };
  await db.put('records', next);
  return next;
}

/**
 * Deletes the record and its in-app photo.
 * The copy in the device photo library is deliberately left untouched (spec §14).
 */
export async function deleteRecord(id: string): Promise<void> {
  const db = await getDb();
  const record = await db.get('records', id);
  if (!record) return;
  await db.delete('records', id);
  await deletePhoto(record.photoId);
}

/** NFKC + lower-case so 全角/半角 and letter case do not split a match. */
export function foldForSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

export function matchesQuery(record: Record, query: string): boolean {
  const needle = foldForSearch(query).trim();
  if (!needle) return false;
  if (foldForSearch(record.memo).includes(needle)) return true;
  return record.tags.some((tag) => foldForSearch(tag).includes(needle));
}

/** Memo OR tag match, newest first. */
export async function searchRecords(query: string): Promise<Record[]> {
  if (!query.trim()) return [];
  const all = await listRecords();
  return all.filter((r) => matchesQuery(r, query));
}

export async function listRecordsByTag(tagName: string): Promise<Record[]> {
  const name = normalizeTagName(tagName);
  const all = await listRecords();
  return all.filter((r) => r.tags.includes(name));
}

/** Tag name → number of records carrying it. */
export async function tagCounts(): Promise<Map<string, number>> {
  const all = await listRecords();
  const counts = new Map<string, number>();
  for (const record of all) {
    for (const tag of record.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}
