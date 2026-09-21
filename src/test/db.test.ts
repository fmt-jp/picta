import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, samplePhoto } from './dbHelpers';
import { DEFAULT_TAGS } from '../db/database';
import { deleteTag, ensureTag, listTags, renameTag } from '../db/tags';
import {
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  listRecordsByTag,
  matchesQuery,
  searchRecords,
  tagCounts,
  updateRecord,
} from '../db/records';
import { loadPhotoBlob } from '../db/photoStore';

const DAY = 24 * 60 * 60 * 1000;
const T = new Date(2026, 8, 21, 12, 31, 0).getTime();

beforeEach(freshDb);

describe('タグ', () => {
  it('初回起動時に登録済みタグが用意される', async () => {
    expect((await listTags()).map((t) => t.name)).toEqual(DEFAULT_TAGS);
  });

  it('同じ名前のタグは重複登録しない', async () => {
    const a = await ensureTag('旅行');
    const b = await ensureTag(' 旅行 ');
    expect(a.id).toBe(b.id);
    expect(await listTags()).toHaveLength(DEFAULT_TAGS.length);
  });

  it('新しいタグは登録済みタグに追加される', async () => {
    await ensureTag('紅葉');
    expect((await listTags()).map((t) => t.name)).toContain('紅葉');
  });

  it('空のタグ名は登録できない', async () => {
    await expect(ensureTag('   ')).rejects.toThrow();
  });
});

describe('記録の作成', () => {
  it('写真・メモ・タグ・撮影日時を保存する', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: 'この店また来たい',
      tags: ['旅行', 'グルメ'],
      capturedAt: T,
    });

    const stored = await getRecord(record.id);
    expect(stored?.memo).toBe('この店また来たい');
    expect(stored?.tags).toEqual(['旅行', 'グルメ']);
    expect(stored?.capturedAt).toBe(T);
    expect(stored?.photoFileName).toBe('20260921_123100.jpg');
    expect(await loadPhotoBlob(record.photoId)).toBeInstanceOf(Blob);
  });

  it('メモ空欄・タグ無しでも保存できる', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: [],
      capturedAt: T,
    });
    expect((await getRecord(record.id))?.memo).toBe('');
    expect((await getRecord(record.id))?.tags).toEqual([]);
  });

  it('長文メモも欠落せずに保存される', async () => {
    const memo = 'あ'.repeat(5000);
    const record = await createRecord({ photo: samplePhoto(), memo, tags: [], capturedAt: T });
    expect((await getRecord(record.id))?.memo).toHaveLength(5000);
  });

  it('その場で追加したタグが登録済みタグになる', async () => {
    await createRecord({ photo: samplePhoto(), memo: '', tags: ['紅葉'], capturedAt: T });
    expect((await listTags()).map((t) => t.name)).toContain('紅葉');
  });

  it('重複タグはまとめられる', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: ['旅行', ' 旅行', '旅行 '],
      capturedAt: T,
    });
    expect(record.tags).toEqual(['旅行']);
  });
});

describe('記録の一覧・編集・削除', () => {
  async function seed() {
    await createRecord({ photo: samplePhoto(), memo: '古い', tags: ['家'], capturedAt: T - DAY });
    await createRecord({ photo: samplePhoto(), memo: '新しい', tags: ['旅行'], capturedAt: T });
    await createRecord({
      photo: samplePhoto(),
      memo: '真ん中',
      tags: ['旅行', '家'],
      capturedAt: T - DAY / 2,
    });
  }

  it('撮影日時の新しい順に並ぶ', async () => {
    await seed();
    expect((await listRecords()).map((r) => r.memo)).toEqual(['新しい', '真ん中', '古い']);
  });

  it('メモとタグを編集できる', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '元のメモ',
      tags: ['旅行'],
      capturedAt: T,
    });
    const updated = await updateRecord(record.id, { memo: '書き換えた', tags: ['仕事'] });
    expect(updated.memo).toBe('書き換えた');
    expect(updated.tags).toEqual(['仕事']);
    expect(updated.capturedAt).toBe(T);
  });

  it('位置情報を保存し、あとから削除できる', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: [],
      capturedAt: T,
      location: { latitude: 35.681236, longitude: 139.767125, accuracy: 12, source: 'device' },
    });
    expect((await getRecord(record.id))?.location?.latitude).toBeCloseTo(35.681236, 6);

    // メモ編集だけでは位置情報は消えない
    await updateRecord(record.id, { memo: 'あとから一言' });
    expect((await getRecord(record.id))?.location).toBeDefined();

    await updateRecord(record.id, { location: null });
    expect((await getRecord(record.id))?.location).toBeUndefined();
  });

  it('位置情報なしでも保存できる', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: [],
      capturedAt: T,
    });
    expect((await getRecord(record.id))?.location).toBeUndefined();
  });

  it('メモだけを削除できる', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '消す',
      tags: ['旅行'],
      capturedAt: T,
    });
    expect((await updateRecord(record.id, { memo: '' })).memo).toBe('');
  });

  it('記録を削除するとアプリ内の写真も消える', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: [],
      capturedAt: T,
    });
    await deleteRecord(record.id);
    expect(await getRecord(record.id)).toBeUndefined();
    expect(await loadPhotoBlob(record.photoId)).toBeNull();
  });

  it('タグで絞り込むと新しい順に返る', async () => {
    await seed();
    expect((await listRecordsByTag('旅行')).map((r) => r.memo)).toEqual(['新しい', '真ん中']);
  });

  it('タグごとの件数を数える', async () => {
    await seed();
    const counts = await tagCounts();
    expect(counts.get('旅行')).toBe(2);
    expect(counts.get('家')).toBe(2);
  });
});

describe('検索', () => {
  beforeEach(async () => {
    await createRecord({
      photo: samplePhoto(),
      memo: '富士山が少し見えた',
      tags: ['旅行'],
      capturedAt: T,
    });
    await createRecord({
      photo: samplePhoto(),
      memo: 'ここから見る富士山は綺麗',
      tags: ['旅行', '景色'],
      capturedAt: T - DAY,
    });
    await createRecord({ photo: samplePhoto(), memo: 'ねじを買った', tags: ['DIY'], capturedAt: T - 2 * DAY });
  });

  it('メモを検索できる（新しい順）', async () => {
    const hits = await searchRecords('富士山');
    expect(hits.map((r) => r.memo)).toEqual(['富士山が少し見えた', 'ここから見る富士山は綺麗']);
  });

  it('タグを検索できる', async () => {
    expect(await searchRecords('景色')).toHaveLength(1);
  });

  it('該当が無ければ0件', async () => {
    expect(await searchRecords('存在しない語')).toHaveLength(0);
  });

  it('空の検索語では何も返さない', async () => {
    expect(await searchRecords('   ')).toHaveLength(0);
  });

  it('全角・半角と大文字小文字を区別しない', () => {
    const record = {
      id: 'x',
      photoId: 'p',
      photoFileName: 'a.jpg',
      memo: 'DIYでＢＯＸを作った',
      tags: [],
      capturedAt: T,
      createdAt: T,
      updatedAt: T,
    };
    expect(matchesQuery(record, 'diy')).toBe(true);
    expect(matchesQuery(record, 'box')).toBe(true);
  });
});

describe('タグ設定', () => {
  it('タグ名を変更すると過去の記録も追従する', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: ['旅行'],
      capturedAt: T,
    });
    const tag = (await listTags()).find((t) => t.name === '旅行')!;
    await renameTag(tag.id, '旅');
    expect((await getRecord(record.id))?.tags).toEqual(['旅']);
    expect((await listTags()).map((t) => t.name)).toContain('旅');
  });

  it('既存タグ名に変更すると統合される', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: ['旅行', 'グルメ'],
      capturedAt: T,
    });
    const tag = (await listTags()).find((t) => t.name === '旅行')!;
    await renameTag(tag.id, 'グルメ');
    expect((await getRecord(record.id))?.tags).toEqual(['グルメ']);
    expect((await listTags()).filter((t) => t.name === 'グルメ')).toHaveLength(1);
  });

  it('タグを削除しても記録は残り、そのタグだけが外れる', async () => {
    const record = await createRecord({
      photo: samplePhoto(),
      memo: 'のこる',
      tags: ['旅行', 'グルメ'],
      capturedAt: T,
    });
    const tag = (await listTags()).find((t) => t.name === '旅行')!;
    await deleteTag(tag.id);
    const stored = await getRecord(record.id);
    expect(stored?.memo).toBe('のこる');
    expect(stored?.tags).toEqual(['グルメ']);
    expect((await listTags()).map((t) => t.name)).not.toContain('旅行');
  });
});
