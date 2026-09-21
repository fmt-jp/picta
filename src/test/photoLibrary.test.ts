import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb, samplePhoto } from './dbHelpers';
import { canShareFiles, photoLibraryMode, savePhotoToLibrary } from '../platform/photoLibrary';
import { createRecord, deleteRecord } from '../db/records';
import { loadPhotoBlob } from '../db/photoStore';

const jpeg = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('端末への保存', () => {
  it('Webではダウンロードとして保存する', async () => {
    expect(photoLibraryMode()).toBe('download');
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });

    const result = await savePhotoToLibrary(jpeg(), '20260921_123100.jpg');

    expect(result.status).toBe('downloaded');
    expect(clicks).toEqual(['20260921_123100.jpg']);
  });

  it('共有シートが使える場合はファイルを共有する', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
      share,
      canShare: () => true,
    }));

    const result = await savePhotoToLibrary(jpeg(), 'photo.jpg', { viaShare: true });

    expect(result.status).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
  });

  it('共有が使えない場合はダウンロードにフォールバックする', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(canShareFiles(jpeg())).toBe(false);
    const result = await savePhotoToLibrary(jpeg(), 'photo.jpg', { viaShare: true });
    expect(result.status).toBe('downloaded');
  });

  it('共有をキャンセルしても記録には影響しない', async () => {
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
      share: vi.fn(async () => {
        throw new DOMException('Share canceled', 'AbortError');
      }),
      canShare: () => true,
    }));
    const result = await savePhotoToLibrary(jpeg(), 'photo.jpg', { viaShare: true });
    expect(result.status).toBe('failed');
    expect(result.message).toBe('保存を中止しました');
  });
});

describe('記録の削除と端末の写真', () => {
  beforeEach(freshDb);

  it('記録を削除してもフォトライブラリ側の保存処理には一切触れない', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: [],
      capturedAt: Date.now(),
    });

    await deleteRecord(record.id);

    // アプリ内の写真だけが消える。端末側のコピーは独立している。
    expect(await loadPhotoBlob(record.photoId)).toBeNull();
    expect(click).not.toHaveBeenCalled();
  });
});
