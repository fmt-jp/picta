import type { Tag } from '../types';
import { getDb } from './database';
import { newId } from './ids';

/** Tags are compared after trimming; empty names are rejected. */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  const tags = await db.getAll('tags');
  return tags.sort((a, b) => a.createdAt - b.createdAt);
}

export async function findTagByName(name: string): Promise<Tag | undefined> {
  const db = await getDb();
  return db.getFromIndex('tags', 'name', normalizeTagName(name));
}

/**
 * Registers a tag if it is new and returns it either way, so that "＋ 新しいタグ"
 * on the review screen both tags the record and grows the registered list.
 */
export async function ensureTag(rawName: string): Promise<Tag> {
  const name = normalizeTagName(rawName);
  if (!name) throw new Error('タグ名を入力してください');
  const existing = await findTagByName(name);
  if (existing) return existing;

  const tag: Tag = { id: newId(), name, createdAt: Date.now() };
  const db = await getDb();
  try {
    await db.add('tags', tag);
  } catch (err) {
    // Lost a race against another tab — the other write wins.
    const again = await findTagByName(name);
    if (again) return again;
    throw err;
  }
  return tag;
}

/**
 * Renames a registered tag and rewrites it on every record that carries it.
 * Merging into an existing tag name is allowed and de-duplicates the records.
 */
export async function renameTag(id: string, rawName: string): Promise<void> {
  const name = normalizeTagName(rawName);
  if (!name) throw new Error('タグ名を入力してください');

  const db = await getDb();
  const tag = await db.get('tags', id);
  if (!tag) throw new Error('タグが見つかりません');
  if (tag.name === name) return;

  const clash = await findTagByName(name);
  const tx = db.transaction(['tags', 'records'], 'readwrite');
  if (clash && clash.id !== id) {
    // Merge: drop the renamed row, keep the existing one.
    await tx.objectStore('tags').delete(id);
  } else {
    await tx.objectStore('tags').put({ ...tag, name });
  }

  let cursor = await tx.objectStore('records').openCursor();
  while (cursor) {
    const record = cursor.value;
    if (record.tags.includes(tag.name)) {
      const tags = Array.from(new Set(record.tags.map((t) => (t === tag.name ? name : t))));
      await cursor.update({ ...record, tags, updatedAt: Date.now() });
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

/**
 * Deletes a registered tag. Records keep existing — only the tag is stripped
 * from them (spec §17).
 */
export async function deleteTag(id: string): Promise<void> {
  const db = await getDb();
  const tag = await db.get('tags', id);
  if (!tag) return;

  const tx = db.transaction(['tags', 'records'], 'readwrite');
  await tx.objectStore('tags').delete(id);

  let cursor = await tx.objectStore('records').openCursor();
  while (cursor) {
    const record = cursor.value;
    if (record.tags.includes(tag.name)) {
      await cursor.update({
        ...record,
        tags: record.tags.filter((t) => t !== tag.name),
        updatedAt: Date.now(),
      });
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}
