import type { GeoPoint } from '../types';

/**
 * Minimal EXIF support — read and write.
 *
 * Reading is for photos that arrive through the file fallback (the OS camera
 * or the photo library): those carry a real DateTimeOriginal and, often, GPS.
 *
 * Writing matters because a `canvas.toBlob()` capture has no metadata at all.
 * Without this, the copy Picta saves to the device photo library would show up
 * with the import time and no place, and an exported photo would lose both.
 * Only the handful of tags Picta actually knows are written.
 */

const TAG = {
  DateTime: 0x0132,
  ExifIfdPointer: 0x8769,
  GpsIfdPointer: 0x8825,
  ExifVersion: 0x9000,
  DateTimeOriginal: 0x9003,
  DateTimeDigitized: 0x9004,
  OffsetTimeOriginal: 0x9011,
  GpsVersionId: 0x0000,
  GpsLatitudeRef: 0x0001,
  GpsLatitude: 0x0002,
  GpsLongitudeRef: 0x0003,
  GpsLongitude: 0x0004,
} as const;

const TYPE = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7 } as const;
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

export interface ExifData {
  /** ms epoch, from DateTimeOriginal (or DateTime). */
  capturedAt?: number;
  location?: GeoPoint;
}

/* ------------------------------------------------------------------ reading */

/** Byte offset of the APP1/Exif payload, or -1. */
function findApp1(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return -1; // not a JPEG
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return -1;
    const marker = bytes[offset + 1];
    // SOS / EOI — no metadata beyond this point.
    if (marker === 0xda || marker === 0xd9) return -1;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2) return -1;
    if (marker === 0xe1) {
      const start = offset + 4;
      if (EXIF_HEADER.every((b, i) => bytes[start + i] === b)) return start + EXIF_HEADER.length;
    }
    offset += 2 + size;
  }
  return -1;
}

interface Reader {
  view: DataView;
  /** TIFF header start — every offset in the file is relative to this. */
  base: number;
  little: boolean;
}

function readValue(reader: Reader, entryOffset: number): number[] | string | null {
  const { view, base, little } = reader;
  const type = view.getUint16(entryOffset + 2, little);
  const count = view.getUint32(entryOffset + 4, little);
  const size = TYPE_SIZE[type];
  if (!size || count === 0 || count > 0x10000) return null;

  const total = size * count;
  const start = total <= 4 ? entryOffset + 8 : base + view.getUint32(entryOffset + 8, little);
  if (start < 0 || start + total > view.byteLength) return null;

  if (type === TYPE.ASCII) {
    let text = '';
    for (let i = 0; i < count; i++) {
      const code = view.getUint8(start + i);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  }

  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = start + i * size;
    if (type === TYPE.BYTE || type === TYPE.UNDEFINED) values.push(view.getUint8(at));
    else if (type === TYPE.SHORT) values.push(view.getUint16(at, little));
    else if (type === TYPE.LONG) values.push(view.getUint32(at, little));
    else if (type === TYPE.RATIONAL) {
      const denominator = view.getUint32(at + 4, little);
      values.push(denominator === 0 ? 0 : view.getUint32(at, little) / denominator);
    } else return null;
  }
  return values;
}

function readIfd(reader: Reader, ifdOffset: number): Map<number, number[] | string> {
  const out = new Map<number, number[] | string>();
  const { view, base, little } = reader;
  const at = base + ifdOffset;
  if (at + 2 > view.byteLength) return out;
  const count = view.getUint16(at, little);
  for (let i = 0; i < count; i++) {
    const entry = at + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const value = readValue(reader, entry);
    if (value !== null) out.set(view.getUint16(entry, little), value);
  }
  return out;
}

/** "2026:09:21 12:31:00" (+ optional "+09:00") → ms epoch. */
export function parseExifDateTime(text: string, offset?: string): number | undefined {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  const tz = offset && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : null;
  if (tz) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz}`;
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  // No offset recorded: EXIF times are local to wherever the shot was taken,
  // and the device's own zone is the best guess available.
  const ms = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function toDegrees(parts: number[] | string | undefined, ref: string | undefined): number | null {
  if (!Array.isArray(parts) || parts.length < 3 || typeof ref !== 'string') return null;
  const [deg, min, sec] = parts;
  const value = deg + min / 60 + sec / 3600;
  if (!Number.isFinite(value)) return null;
  const negative = ref.toUpperCase().startsWith('S') || ref.toUpperCase().startsWith('W');
  return negative ? -value : value;
}

/** Reads the tags Picta cares about. Returns {} for anything it cannot parse. */
export function parseExifBytes(bytes: Uint8Array): ExifData {
  try {
    const base = findApp1(bytes);
    if (base < 0) return {};
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = view.getUint16(base, false);
    if (order !== 0x4949 && order !== 0x4d4d) return {};
    const little = order === 0x4949;
    if (view.getUint16(base + 2, little) !== 42) return {};

    const reader: Reader = { view, base, little };
    const ifd0 = readIfd(reader, view.getUint32(base + 4, little));

    const exifPointer = ifd0.get(TAG.ExifIfdPointer);
    const exif = Array.isArray(exifPointer) ? readIfd(reader, exifPointer[0]) : new Map();
    const gpsPointer = ifd0.get(TAG.GpsIfdPointer);
    const gps = Array.isArray(gpsPointer) ? readIfd(reader, gpsPointer[0]) : new Map();

    const result: ExifData = {};

    const stamp = exif.get(TAG.DateTimeOriginal) ?? ifd0.get(TAG.DateTime);
    const offset = exif.get(TAG.OffsetTimeOriginal);
    if (typeof stamp === 'string') {
      result.capturedAt = parseExifDateTime(stamp, typeof offset === 'string' ? offset : undefined);
    }

    const latitude = toDegrees(gps.get(TAG.GpsLatitude), gps.get(TAG.GpsLatitudeRef) as string);
    const longitude = toDegrees(gps.get(TAG.GpsLongitude), gps.get(TAG.GpsLongitudeRef) as string);
    if (latitude !== null && longitude !== null && (latitude !== 0 || longitude !== 0)) {
      result.location = { latitude, longitude, source: 'exif' };
    }
    return result;
  } catch {
    return {};
  }
}

/** Only the head of the file is read: EXIF always sits near the start. */
export async function readExif(blob: Blob, headBytes = 256 * 1024): Promise<ExifData> {
  try {
    const head = blob.slice(0, Math.min(headBytes, blob.size));
    return parseExifBytes(new Uint8Array(await head.arrayBuffer()));
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ writing */

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Inline when ≤ 4 bytes, otherwise appended to the data area. */
  value: Uint8Array;
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length + 1); // NUL terminated
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f;
  return bytes;
}

function rationals(values: [number, number][]): Uint8Array {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach(([numerator, denominator], i) => {
    view.setUint32(i * 8, numerator, true);
    view.setUint32(i * 8 + 4, denominator, true);
  });
  return bytes;
}

function long(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function ifdByteLength(entries: Entry[]): number {
  return 2 + entries.length * 12 + 4;
}

/**
 * Serializes one IFD. Values longer than 4 bytes go to `data`, addressed by an
 * offset relative to the TIFF header.
 */
function writeIfd(
  entries: Entry[],
  dataOffset: number,
  data: number[],
): { ifd: Uint8Array; nextDataOffset: number } {
  const ifd = new Uint8Array(ifdByteLength(entries));
  const view = new DataView(ifd.buffer);
  view.setUint16(0, entries.length, true);

  let cursor = dataOffset;
  entries.forEach((entry, i) => {
    const at = 2 + i * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.count, true);
    if (entry.value.length <= 4) {
      ifd.set(entry.value, at + 8);
    } else {
      view.setUint32(at + 8, cursor, true);
      data.push(...entry.value);
      // Every value must start on an even offset.
      if (entry.value.length % 2 === 1) data.push(0);
      cursor += entry.value.length + (entry.value.length % 2);
    }
  });
  view.setUint32(2 + entries.length * 12, 0, true); // no next IFD
  return { ifd, nextDataOffset: cursor };
}

/** "2026:09:21 12:31:00" in local time, as EXIF expects. */
export function formatExifDateTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}:${p(date.getMonth() + 1)}:${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

/** "+09:00" — so the timestamp stays unambiguous outside this time zone. */
export function formatExifOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

/** Degrees → the degrees/minutes/seconds rationals EXIF stores. */
function degreesToRationals(value: number): [number, number][] {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = Math.floor((abs - degrees) * 60);
  // Thousandths of a second ≈ 3cm: far finer than any phone's fix.
  const seconds = Math.round((abs - degrees - minutes / 60) * 3600 * 1000);
  return [
    [degrees, 1],
    [minutes, 1],
    [seconds, 1000],
  ];
}

export interface ExifInput {
  capturedAt: number;
  location?: GeoPoint | null;
}

/** Builds the APP1 payload (TIFF header onwards). */
export function buildExifPayload(input: ExifInput): Uint8Array {
  const date = new Date(input.capturedAt);
  const stamp = ascii(formatExifDateTime(date));
  const offset = ascii(formatExifOffset(date));
  const point = input.location ?? null;

  const exifEntries: Entry[] = [
    { tag: TAG.ExifVersion, type: TYPE.UNDEFINED, count: 4, value: ascii('0232').slice(0, 4) },
    { tag: TAG.DateTimeOriginal, type: TYPE.ASCII, count: stamp.length, value: stamp },
    { tag: TAG.DateTimeDigitized, type: TYPE.ASCII, count: stamp.length, value: stamp },
    { tag: TAG.OffsetTimeOriginal, type: TYPE.ASCII, count: offset.length, value: offset },
  ];

  const gpsEntries: Entry[] = point
    ? [
        {
          tag: TAG.GpsVersionId,
          type: TYPE.BYTE,
          count: 4,
          value: new Uint8Array([2, 3, 0, 0]),
        },
        {
          tag: TAG.GpsLatitudeRef,
          type: TYPE.ASCII,
          count: 2,
          value: ascii(point.latitude < 0 ? 'S' : 'N'),
        },
        {
          tag: TAG.GpsLatitude,
          type: TYPE.RATIONAL,
          count: 3,
          value: rationals(degreesToRationals(point.latitude)),
        },
        {
          tag: TAG.GpsLongitudeRef,
          type: TYPE.ASCII,
          count: 2,
          value: ascii(point.longitude < 0 ? 'W' : 'E'),
        },
        {
          tag: TAG.GpsLongitude,
          type: TYPE.RATIONAL,
          count: 3,
          value: rationals(degreesToRationals(point.longitude)),
        },
      ]
    : [];

  // Lay the IFDs out back to back, then the shared data area, so every
  // pointer can be computed before anything is serialized.
  const ifd0Entries: Entry[] = [
    { tag: TAG.DateTime, type: TYPE.ASCII, count: stamp.length, value: stamp },
  ];
  const ifd0Offset = 8;
  // DateTime + the Exif pointer, plus the GPS pointer when there is a fix.
  const ifd0Size = 2 + (2 + (point ? 1 : 0)) * 12 + 4;
  const exifIfdOffset = ifd0Offset + ifd0Size;
  const gpsIfdOffset = exifIfdOffset + ifdByteLength(exifEntries);
  const dataOffset = gpsIfdOffset + (point ? ifdByteLength(gpsEntries) : 0);

  ifd0Entries.push({
    tag: TAG.ExifIfdPointer,
    type: TYPE.LONG,
    count: 1,
    value: long(exifIfdOffset),
  });
  if (point) {
    ifd0Entries.push({
      tag: TAG.GpsIfdPointer,
      type: TYPE.LONG,
      count: 1,
      value: long(gpsIfdOffset),
    });
  }

  const data: number[] = [];
  const ifd0 = writeIfd(ifd0Entries, dataOffset, data);
  const exifIfd = writeIfd(exifEntries, ifd0.nextDataOffset, data);
  const gpsIfd = point
    ? writeIfd(gpsEntries, exifIfd.nextDataOffset, data)
    : { ifd: new Uint8Array(0), nextDataOffset: exifIfd.nextDataOffset };

  const header = new Uint8Array(8);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, 0x4949, true); // "II" — little endian
  headerView.setUint16(2, 42, true);
  headerView.setUint32(4, ifd0Offset, true);

  const payload = new Uint8Array(
    header.length + ifd0.ifd.length + exifIfd.ifd.length + gpsIfd.ifd.length + data.length,
  );
  let cursor = 0;
  for (const part of [header, ifd0.ifd, exifIfd.ifd, gpsIfd.ifd, Uint8Array.from(data)]) {
    payload.set(part, cursor);
    cursor += part.length;
  }
  return payload;
}

/**
 * Returns a copy of `jpeg` with an EXIF APP1 segment holding the capture time
 * and, when known, the location. An existing APP1 is replaced. A non-JPEG is
 * returned untouched.
 */
export async function withExif(jpeg: Blob, input: ExifInput): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return jpeg;

    // Drop an APP1 that is already there (imported files) so we do not stack two.
    let rest = bytes.subarray(2);
    if (rest[0] === 0xff && rest[1] === 0xe1) {
      const size = (rest[2] << 8) | rest[3];
      if (size >= 2 && size + 2 <= rest.length) rest = rest.subarray(2 + size);
    }

    const payload = buildExifPayload(input);
    const length = payload.length + EXIF_HEADER.length + 2;
    if (length > 0xffff) return jpeg; // will not fit in one segment

    const out = new Uint8Array(2 + 2 + length + rest.length);
    out.set([0xff, 0xd8], 0);
    out.set([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff], 2);
    out.set(EXIF_HEADER, 6);
    out.set(payload, 6 + EXIF_HEADER.length);
    out.set(rest, 6 + EXIF_HEADER.length + payload.length);
    return new Blob([out], { type: jpeg.type || 'image/jpeg' });
  } catch {
    return jpeg;
  }
}
