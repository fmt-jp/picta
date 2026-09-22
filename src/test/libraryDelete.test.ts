import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The record layer's side of "also delete the copy on the phone".
 * The platform adapter is mocked: whether a device can actually do it is a
 * platform question (see photoLibrary.ts), this is about the wiring.
 */
const deletePhotoFromLibrary = vi.fn();
vi.mock('../platform/photoLibrary', () => ({
  deletePhotoFromLibrary: (...args: unknown[]) => deletePhotoFromLibrary(...args),
}));

const { freshDb, samplePhoto } = await import('./dbHelpers');
const { createRecord, deleteRecord, deleteRecords, getRecord, setLibraryPhoto } = await import(
  '../db/records'
);
const { loadPhotoBlob } = await import('../db/photoStore');

const T = new Date(2026, 8, 21, 12, 31, 0).getTime();

beforeEach(async () => {
  await freshDb();
  deletePhotoFromLibrary.mockReset();
  deletePhotoFromLibrary.mockResolvedValue({ status: 'deleted' });
});

async function seedRecord(memo = 'あとで消す') {
  const record = await createRecord({
    photo: samplePhoto(),
    memo,
    tags: [],
    capturedAt: T,
  });
  await setLibraryPhoto(record.id, { platform: 'android', id: '/storage/emulated/0/a.jpg' });
  return (await getRecord(record.id))!;
}

describe('端末の写真も削除するかの選択', () => {
  it('既定では端末の写真に触れない', async () => {
    const record = await seedRecord();

    const outcome = await deleteRecord(record.id);

    expect(deletePhotoFromLibrary).not.toHaveBeenCalled();
    expect(outcome.removed).toBe(1);
    expect(await getRecord(record.id)).toBeUndefined();
    expect(await loadPhotoBlob(record.photoId)).toBeNull();
  });

  it('指定すると保存時に記録した参照で端末の写真も削除する', async () => {
    const record = await seedRecord();

    const outcome = await deleteRecord(record.id, { alsoFromLibrary: true });

    expect(deletePhotoFromLibrary).toHaveBeenCalledWith({
      platform: 'android',
      id: '/storage/emulated/0/a.jpg',
    });
    expect(outcome.libraryDeleted).toBe(1);
    expect(outcome.removed).toBe(1);
  });

  it('端末側の削除に失敗しても記録は削除する', async () => {
    deletePhotoFromLibrary.mockResolvedValue({ status: 'failed', message: 'no access' });
    const record = await seedRecord();

    const outcome = await deleteRecord(record.id, { alsoFromLibrary: true });

    expect(outcome.libraryFailed).toBe(1);
    expect(outcome.removed).toBe(1);
    expect(await getRecord(record.id)).toBeUndefined();
  });

  it('端末側の削除に対応していない環境でも記録は削除し、その旨を返す', async () => {
    deletePhotoFromLibrary.mockResolvedValue({ status: 'unsupported' });
    const record = await seedRecord();

    const outcome = await deleteRecord(record.id, { alsoFromLibrary: true });

    expect(outcome.libraryUnsupported).toBe(true);
    expect(outcome.libraryDeleted).toBe(0);
    expect(await getRecord(record.id)).toBeUndefined();
  });

  it('参照が無い記録（更新前に保存したもの）は端末側を消せないと返す', async () => {
    deletePhotoFromLibrary.mockImplementation(async (ref: unknown) =>
      ref ? { status: 'deleted' } : { status: 'unknown' },
    );
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: [],
      capturedAt: T,
    });

    const outcome = await deleteRecord(record.id, { alsoFromLibrary: true });

    expect(outcome.libraryFailed).toBe(1);
    expect(outcome.removed).toBe(1);
  });

  it('まとめて削除でも件数を集計する', async () => {
    const a = await seedRecord('あ');
    const b = await seedRecord('い');
    deletePhotoFromLibrary
      .mockResolvedValueOnce({ status: 'deleted' })
      .mockResolvedValueOnce({ status: 'failed' });

    const outcome = await deleteRecords([a.id, b.id], { alsoFromLibrary: true });

    expect(outcome.removed).toBe(2);
    expect(outcome.libraryDeleted).toBe(1);
    expect(outcome.libraryFailed).toBe(1);
  });
});
