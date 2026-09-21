import { beforeEach, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { freshDb, samplePhoto } from './dbHelpers';
import {
  BOM,
  buildCsv,
  escapeCsvField,
  exportBaseName,
  formatCapturedAt,
  uniquePhotoFileNames,
} from '../export/csv';
import { buildExportZip } from '../export/zip';
import { buildManifest } from '../export/manifest';
import { createRecord, listRecords } from '../db/records';
import type { Record } from '../types';

const T = new Date(2026, 8, 21, 12, 31, 0).getTime();

function record(overrides: Partial<Record> = {}): Record {
  return {
    id: '001',
    photoId: 'p1',
    photoFileName: '20260921_123100.jpg',
    memo: 'この店また来たい',
    tags: ['旅行', 'グルメ'],
    capturedAt: T,
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

describe('CSV', () => {
  it('仕様どおりの列と書式で出力する', () => {
    const csv = buildCsv(uniquePhotoFileNames([record()]));
    const lines = csv.replace(BOM, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('id,capturedAt,memo,tags,photoFileName,latitude,longitude');
    expect(lines[1]).toBe(
      '001,2026-09-21T12:31:00,"この店また来たい","旅行|グルメ","20260921_123100.jpg",,',
    );
  });

  it('位置情報がある記録は緯度・経度を出力する', () => {
    const csv = buildCsv(
      uniquePhotoFileNames([
        record({
          location: { latitude: 35.681236, longitude: 139.767125, source: 'device' },
        }),
      ]),
    );
    expect(csv).toContain('"20260921_123100.jpg",35.681236,139.767125');
  });

  it('日本語が化けないようBOM付きUTF-8で出力する', () => {
    expect(buildCsv([]).startsWith(BOM)).toBe(true);
  });

  it('カンマ・引用符・改行を含むメモを壊さない', () => {
    const csv = buildCsv(
      uniquePhotoFileNames([record({ memo: 'a,b "c"\nd' })]),
    );
    expect(csv).toContain('"a,b ""c""\nd"');
  });

  it('引用符をエスケープする', () => {
    expect(escapeCsvField('い"ろ"は')).toBe('"い""ろ""は"');
  });

  it('タグ無しは空文字列になる', () => {
    const csv = buildCsv(uniquePhotoFileNames([record({ tags: [], memo: '' })]));
    expect(csv).toContain('001,2026-09-21T12:31:00,"","","20260921_123100.jpg",,');
  });

  it('同じ秒に撮影された写真のファイル名が衝突しない', () => {
    const rows = uniquePhotoFileNames([record({ id: 'a' }), record({ id: 'b' }), record({ id: 'c' })]);
    expect(rows.map((r) => r.photoFileName)).toEqual([
      '20260921_123100.jpg',
      '20260921_123100_2.jpg',
      '20260921_123100_3.jpg',
    ]);
  });

  it('撮影日時をローカル時刻で書式化する', () => {
    expect(formatCapturedAt(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026-01-02T03:04:05');
  });

  it('ファイル名は Torikoto_Export_YYYYMMDD 形式', () => {
    expect(exportBaseName(new Date(2026, 8, 21))).toBe('Torikoto_Export_20260921');
  });
});

describe('manifest', () => {
  it('形式とバージョンを持つ', () => {
    const manifest = buildManifest(3, new Date(T));
    expect(manifest.format).toBe('torikoto-export');
    expect(manifest.version).toBe(2);
    expect(manifest.recordCount).toBe(3);
    expect(manifest.csv.columns).toEqual([
      'id',
      'capturedAt',
      'memo',
      'tags',
      'photoFileName',
      'latitude',
      'longitude',
    ]);
  });
});

describe('ZIPエクスポート', () => {
  beforeEach(freshDb);

  async function seed() {
    await createRecord({
      photo: samplePhoto(64),
      memo: 'ここから見ると綺麗',
      tags: ['旅行'],
      capturedAt: T - 24 * 60 * 60 * 1000,
    });
    await createRecord({
      photo: samplePhoto(128),
      memo: 'この店また来たい',
      tags: ['旅行', 'グルメ'],
      capturedAt: T,
    });
  }

  it('manifest.json・records.csv・photos/ を含む', async () => {
    await seed();
    const rows = uniquePhotoFileNames(await listRecords());
    const blob = await buildExportZip(rows);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    expect(Object.keys(files).sort()).toEqual([
      'manifest.json',
      'photos/20260920_123100.jpg',
      'photos/20260921_123100.jpg',
      'records.csv',
    ]);
    expect(JSON.parse(strFromU8(files['manifest.json'])).format).toBe('torikoto-export');
  });

  it('CSVの photoFileName と photos/ の中身が対応する', async () => {
    await seed();
    const rows = uniquePhotoFileNames(await listRecords());
    const blob = await buildExportZip(rows);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const csv = strFromU8(files['records.csv']).replace(BOM, '');

    for (const { photoFileName } of rows) {
      expect(csv).toContain(`"${photoFileName}"`);
      expect(files[`photos/${photoFileName}`]).toBeDefined();
    }
    expect(files['photos/20260921_123100.jpg'].length).toBe(128);
  });

  it('日本語のメモとタグがZIP内でも化けない', async () => {
    await seed();
    const blob = await buildExportZip(uniquePhotoFileNames(await listRecords()));
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const bytes = files['records.csv'];
    // TextDecoder swallows the BOM, so check the raw bytes for EF BB BF.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = strFromU8(bytes);

    expect(csv).toContain('この店また来たい');
    expect(csv).toContain('"旅行|グルメ"');
  });

  it('進捗を通知する', async () => {
    await seed();
    const seen: number[] = [];
    await buildExportZip(uniquePhotoFileNames(await listRecords()), (p) => seen.push(p.done));
    expect(seen).toEqual([1, 2]);
  });

  it('記録が0件でもZIPを作れる', async () => {
    const blob = await buildExportZip([]);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'records.csv']);
  });
});
