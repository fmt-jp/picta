import { describe, expect, it } from 'vitest';
import {
  MAX_CAPTION_CHARS,
  buildExifPayload,
  buildXmpPacket,
  clampCaption,
  formatExifDateTime,
  formatExifOffset,
  parseExifBytes,
  parseExifDateTime,
  withExif,
} from '../capture/exif';

const T = new Date(2026, 8, 21, 12, 31, 0).getTime();

/** The smallest thing that parses as a JPEG: SOI + a quantisation table + EOI. */
function fakeJpeg(): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x11, 0x22, 0xff, 0xd9])], {
    type: 'image/jpeg',
  });
}

async function roundTrip(input: Parameters<typeof withExif>[1]) {
  const blob = await withExif(fakeJpeg(), input);
  return parseExifBytes(new Uint8Array(await blob.arrayBuffer()));
}

describe('EXIF 日時', () => {
  it('EXIF形式で書式化する', () => {
    expect(formatExifDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026:01:02 03:04:05');
  });

  it('オフセットを ±HH:MM で書式化する', () => {
    expect(formatExifOffset(new Date(T))).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it('EXIFの日時文字列を解釈する', () => {
    expect(parseExifDateTime('2026:09:21 12:31:00')).toBe(T);
  });

  it('オフセット付きの日時を解釈する', () => {
    expect(parseExifDateTime('2026:09:21 12:31:00', '+09:00')).toBe(
      Date.parse('2026-09-21T12:31:00+09:00'),
    );
  });

  it('壊れた日時は undefined', () => {
    expect(parseExifDateTime('not a date')).toBeUndefined();
  });
});

describe('EXIF の書き込みと読み戻し', () => {
  it('撮影日時を往復できる', async () => {
    const exif = await roundTrip({ capturedAt: T });
    expect(exif.capturedAt).toBe(T);
    expect(exif.location).toBeUndefined();
  });

  it('位置情報を往復できる', async () => {
    const exif = await roundTrip({
      capturedAt: T,
      location: { latitude: 35.681236, longitude: 139.767125, source: 'device' },
    });
    expect(exif.location?.latitude).toBeCloseTo(35.681236, 5);
    expect(exif.location?.longitude).toBeCloseTo(139.767125, 5);
    expect(exif.location?.source).toBe('exif');
  });

  it('南緯・西経を符号付きで往復できる', async () => {
    const exif = await roundTrip({
      capturedAt: T,
      location: { latitude: -33.8688, longitude: -70.6693, source: 'device' },
    });
    expect(exif.location?.latitude).toBeCloseTo(-33.8688, 5);
    expect(exif.location?.longitude).toBeCloseTo(-70.6693, 5);
  });

  it('JPEGとして壊れない（SOI直後にAPP1、元データは後ろに残る）', async () => {
    const blob = await withExif(fakeJpeg(), { capturedAt: T });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect([bytes[2], bytes[3]]).toEqual([0xff, 0xe1]);
    expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9]);
    expect(blob.type).toBe('image/jpeg');
  });

  it('APP1を二重に付けない', async () => {
    const once = await withExif(fakeJpeg(), { capturedAt: T });
    const twice = await withExif(once, { capturedAt: T + 1000 });
    const bytes = new Uint8Array(await twice.arrayBuffer());
    let app1 = 0;
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff && bytes[offset + 1] !== 0xd9) {
      if (bytes[offset + 1] === 0xe1) app1 += 1;
      offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
    }
    expect(app1).toBe(1);
    expect(parseExifBytes(bytes).capturedAt).toBe(T + 1000);
  });

  it('JPEGでなければそのまま返す', async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    expect(await withExif(png, { capturedAt: T })).toBe(png);
  });

  it('EXIFの無いJPEGからは何も読めない', () => {
    expect(parseExifBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({});
  });

  it('壊れたバイト列でも例外を投げない', () => {
    expect(parseExifBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x45]))).toEqual({});
  });
});

describe('EXIFペイロード', () => {
  it('位置情報が無いときはGPS IFDを作らない', () => {
    const withoutGps = buildExifPayload({ capturedAt: T });
    const withGps = buildExifPayload({
      capturedAt: T,
      location: { latitude: 1, longitude: 2, source: 'device' },
    });
    expect(withGps.length).toBeGreaterThan(withoutGps.length);
  });
});

describe('メモをキャプションとして書き込む', () => {
  it('日本語のメモを往復できる', async () => {
    const exif = await roundTrip({ capturedAt: T, memo: 'この店また来たい' });
    expect(exif.caption).toBe('この店また来たい');
  });

  it('絵文字（サロゲートペア）も壊れない', async () => {
    const exif = await roundTrip({ capturedAt: T, memo: '紅葉が綺麗🍁' });
    expect(exif.caption).toBe('紅葉が綺麗🍁');
  });

  it('ASCIIのメモは ImageDescription にも入る', async () => {
    const blob = await withExif(fakeJpeg(), { capturedAt: T, memo: 'nice cafe' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(parseExifBytes(bytes).caption).toBe('nice cafe');
    // 0x010e = ImageDescription
    const view = new DataView(bytes.buffer);
    let found = false;
    for (let i = 0; i + 1 < bytes.length; i++) {
      if (view.getUint16(i, true) === 0x010e) found = true;
    }
    expect(found).toBe(true);
  });

  it('日本語のメモは ImageDescription には書かない（文字化け回避）', async () => {
    const blob = await withExif(fakeJpeg(), { capturedAt: T, memo: '日本語のメモ' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // UserComment からは読める
    expect(parseExifBytes(bytes).caption).toBe('日本語のメモ');
    // ImageDescription(0x010e) のエントリは作られない
    const view = new DataView(bytes.buffer);
    const app1Length = view.getUint16(4, false);
    let descriptionEntries = 0;
    for (let i = 6; i < 4 + app1Length - 1; i++) {
      if (view.getUint16(i, true) === 0x010e) descriptionEntries += 1;
    }
    expect(descriptionEntries).toBe(0);
  });

  it('メモが無ければキャプションを書かない', async () => {
    const exif = await roundTrip({ capturedAt: T, memo: '' });
    expect(exif.caption).toBeUndefined();
  });

  it('XMPのdc:descriptionにも同じ文字列が入る', async () => {
    const blob = await withExif(fakeJpeg(), { capturedAt: T, memo: 'ここから見ると綺麗' });
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('http://ns.adobe.com/xap/1.0/');
    expect(text).toContain('<dc:description>');
    expect(text).toContain('ここから見ると綺麗');
  });

  it('XMPのXMLをエスケープする', () => {
    expect(buildXmpPacket('a & b <c> "d"')).toContain('a &amp; b &lt;c&gt; &quot;d&quot;');
  });

  it('長すぎるメモは切り詰める（サロゲートペアを割らない）', () => {
    expect(clampCaption('あ'.repeat(5000))).toHaveLength(MAX_CAPTION_CHARS);
    const emoji = '🍁'.repeat(MAX_CAPTION_CHARS);
    expect(clampCaption(emoji).length).toBeLessThanOrEqual(MAX_CAPTION_CHARS);
    // 末尾が孤立した上位サロゲートで終わっていないこと
    const last = clampCaption(emoji).charCodeAt(clampCaption(emoji).length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it('長いメモでも撮影日時と位置は失われない', async () => {
    const exif = await roundTrip({
      capturedAt: T,
      memo: 'あ'.repeat(5000),
      location: { latitude: 35.681236, longitude: 139.767125, source: 'device' },
    });
    expect(exif.capturedAt).toBe(T);
    expect(exif.location?.latitude).toBeCloseTo(35.681236, 5);
    expect(exif.caption).toHaveLength(MAX_CAPTION_CHARS);
  });

  it('書き直してもEXIFとXMPが二重にならない', async () => {
    const once = await withExif(fakeJpeg(), { capturedAt: T, memo: '最初のメモ' });
    const twice = await withExif(once, { capturedAt: T, memo: '書き換えたメモ' });
    const bytes = new Uint8Array(await twice.arrayBuffer());

    let app1 = 0;
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff && bytes[offset + 1] !== 0xd9) {
      if (bytes[offset + 1] === 0xe1) app1 += 1;
      offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
    }
    expect(app1).toBe(2); // Exif と XMP でちょうど2つ

    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('書き換えたメモ');
    expect(text).not.toContain('最初のメモ');
    expect(parseExifBytes(bytes).caption).toBe('書き換えたメモ');
  });

  it('メモを空にするとキャプションも消える', async () => {
    const once = await withExif(fakeJpeg(), { capturedAt: T, memo: 'あとで消す' });
    const cleared = await withExif(once, { capturedAt: T, memo: '' });
    const bytes = new Uint8Array(await cleared.arrayBuffer());
    expect(parseExifBytes(bytes).caption).toBeUndefined();
    expect(new TextDecoder().decode(bytes)).not.toContain('あとで消す');
  });
});
