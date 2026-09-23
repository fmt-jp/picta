import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './dbHelpers';
import { parseCapturedAt, parseCsv } from '../export/csvParse';
import { importExportZip, inspectExportZip } from '../export/importZip';
import { buildExportZip } from '../export/zip';
import { uniquePhotoFileNames } from '../export/csv';
import { createRecord, listRecords } from '../db/records';
import { loadPhotoBlob } from '../db/photoStore';
import { listTags } from '../db/tags';
import { parseExifBytes, withExif } from '../capture/exif';

const T = new Date(2026, 8, 21, 12, 31, 0).getTime();

/** A tiny but structurally valid JPEG, so the import path behaves normally. */
function jpeg() {
  return {
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x11, 0x22, 0xff, 0xd9])], {
      type: 'image/jpeg',
    }),
    mimeType: 'image/jpeg',
    width: 1440,
    height: 1440,
  };
}

beforeEach(async () => {
  await freshDb();
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
});

describe('CSVの読み取り', () => {
  it('引用符・カンマ・改行・二重引用符を含む値を復元する', () => {
    const rows = parseCsv('a,b\r\n"1,2","い""ろ""は\nに"\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1,2', 'い"ろ"は\nに'],
    ]);
  });

  it('BOMを取り除く', () => {
    expect(parseCsv('﻿id\r\n1\r\n')).toEqual([['id'], ['1']]);
  });

  it('オフセット付きで撮影日時を復元する', () => {
    expect(parseCapturedAt('2026-09-21T12:31:00', 540)).toBe(
      Date.parse('2026-09-21T12:31:00+09:00'),
    );
  });

  it('オフセットが無ければ端末のローカル時刻として読む', () => {
    expect(parseCapturedAt('2026-09-21T12:31:00')).toBe(T);
  });

  it('壊れた日時は undefined', () => {
    expect(parseCapturedAt('not a date')).toBeUndefined();
  });
});

async function exportCurrent(): Promise<Blob> {
  return buildExportZip(uniquePhotoFileNames(await listRecords()));
}

describe('ZIPのインポート', () => {
  async function seed() {
    await createRecord({
      photo: jpeg(),
      memo: 'この店また来たい',
      tags: ['旅行', 'グルメ'],
      capturedAt: T,
      location: { latitude: 35.681236, longitude: 139.767125, source: 'device' },
    });
    await createRecord({
      photo: jpeg(),
      memo: 'ここから見ると綺麗',
      tags: ['旅行'],
      capturedAt: T - 24 * 60 * 60 * 1000,
    });
  }

  it('書き出したZIPの中身を、変更せずに確認できる', async () => {
    await seed();
    const zip = await exportCurrent();

    const summary = await inspectExportZip(zip);

    expect(summary.format).toBe('torikoto-export');
    expect(summary.version).toBe(2);
    expect(summary.total).toBe(2);
    expect(summary.imported).toBe(0);
    expect(await listRecords()).toHaveLength(2); // 確認だけでは何も変えない
  });

  it('全消ししたあとZIPから復元できる', async () => {
    await seed();
    const zip = await exportCurrent();
    const before = await listRecords();

    await freshDb(); // 端末を初期化した状態
    expect(await listRecords()).toHaveLength(0);

    const summary = await importExportZip(zip);

    expect(summary.imported).toBe(2);
    expect(summary.failed).toBe(0);
    const after = await listRecords();
    expect(after.map((r) => r.memo)).toEqual(before.map((r) => r.memo));
    expect(after.map((r) => r.capturedAt)).toEqual(before.map((r) => r.capturedAt));
    expect(after[0].tags).toEqual(['旅行', 'グルメ']);
    expect(after[0].location?.latitude).toBeCloseTo(35.681236, 5);
    expect(after[0].location?.source).toBe('import');
  });

  it('写真はバイト列のまま復元され、EXIFも保たれる', async () => {
    // 実際の保存経路と同じく、刻印済みの写真で記録を作る
    const stamped = await withExif(jpeg().blob, { capturedAt: T, memo: 'この店また来たい' });
    await createRecord({
      photo: { blob: stamped, mimeType: 'image/jpeg', width: 1440, height: 1440 },
      memo: 'この店また来たい',
      tags: [],
      capturedAt: T,
    });
    const zip = await exportCurrent();
    await freshDb();

    await importExportZip(zip);

    const [record] = await listRecords();
    const blob = await loadPhotoBlob(record.photoId);
    expect(blob).not.toBeNull();
    const exif = parseExifBytes(new Uint8Array(await blob!.arrayBuffer()));
    expect(exif.caption).toBe('この店また来たい');
    expect(exif.capturedAt).toBe(T);
  });

  it('タグも登録済みタグに戻る', async () => {
    await createRecord({ photo: jpeg(), memo: '', tags: ['紅葉'], capturedAt: T });
    const zip = await exportCurrent();
    await freshDb();

    await importExportZip(zip);

    expect((await listTags()).map((t) => t.name)).toContain('紅葉');
  });

  it('同じZIPを二度読み込んでも増えない（既存はスキップ）', async () => {
    await seed();
    const zip = await exportCurrent();

    const summary = await importExportZip(zip);

    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(2);
    expect(await listRecords()).toHaveLength(2);
  });

  it('既存の記録を上書きしない', async () => {
    await seed();
    const zip = await exportCurrent();
    const [newest] = await listRecords();

    // 手元で書き換えてから読み込む
    const { updateRecord, getRecord } = await import('../db/records');
    await updateRecord(newest.id, { memo: '手元で書き換えたメモ' });
    await importExportZip(zip);

    expect((await getRecord(newest.id))?.memo).toBe('手元で書き換えたメモ');
  });

  it('記録が無いZIPは0件として扱う', async () => {
    const zip = await buildExportZip([]);
    const summary = await inspectExportZip(zip);
    expect(summary.total).toBe(0);
  });

  it('ZIPでないファイルでも例外にしない', async () => {
    const summary = await inspectExportZip(new Blob([new Uint8Array([1, 2, 3])]));
    expect(summary.total).toBe(0);
    expect(summary.notes.join()).toContain('records.csv');
  });
});
