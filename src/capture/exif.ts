import type { GeoPoint } from '../types';

/**
 * Minimal EXIF support — read and write.
 *
 * Reading is for photos that arrive through the file fallback (the OS camera
 * or the photo library): those carry a real DateTimeOriginal and, often, GPS.
 *
 * Writing matters because a `canvas.toBlob()` capture has no metadata at all.
 * Without this, the copy Torikoto saves to the device photo library would show up
 * with the import time and no place, and an exported photo would lose both.
 * Only the handful of tags Torikoto actually knows are written.
 */

const TAG = {
  ImageDescription: 0x010e,
  DateTime: 0x0132,
  ExifIfdPointer: 0x8769,
  GpsIfdPointer: 0x8825,
  ExifVersion: 0x9000,
  DateTimeOriginal: 0x9003,
  DateTimeDigitized: 0x9004,
  UserComment: 0x9286,
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
/** APP1 namespace that marks an XMP packet. */
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * UserComment is 8 bytes of character-code prefix followed by the text.
 * "UNICODE\0" means UTF-16 in the TIFF's byte order — the only prefix that
 * carries Japanese safely.
 */
const UNICODE_PREFIX = [0x55, 0x4e, 0x49, 0x43, 0x4f, 0x44, 0x45, 0x00];
const ASCII_PREFIX = [0x41, 0x53, 0x43, 0x49, 0x49, 0x00, 0x00, 0x00];

/**
 * How much of a memo is written into the JPEG. A whole record's memo can be
 * long, and an APP1 segment has 64KB to hold everything; 2000 characters is
 * far more than a "one-liner" and leaves the segment comfortably small.
 */
export const MAX_CAPTION_CHARS = 2000;

export interface ExifData {
  /** ms epoch, from DateTimeOriginal (or DateTime). */
  capturedAt?: number;
  location?: GeoPoint;
  /** The photo's caption: UserComment, or ImageDescription as a fallback. */
  caption?: string;
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

type TagValue = number[] | string | Uint8Array;

function readValue(reader: Reader, entryOffset: number): TagValue | null {
  const { view, base, little } = reader;
  const type = view.getUint16(entryOffset + 2, little);
  const count = view.getUint32(entryOffset + 4, little);
  const size = TYPE_SIZE[type];
  if (!size || count === 0 || count > 0x10000) return null;

  const total = size * count;
  const start = total <= 4 ? entryOffset + 8 : base + view.getUint32(entryOffset + 8, little);
  if (start < 0 || start + total > view.byteLength) return null;

  if (type === TYPE.ASCII) {
    // Nominally ASCII, but plenty of cameras and apps put UTF-8 in here, and
    // UTF-8 decodes plain ASCII unchanged.
    const raw = new Uint8Array(view.buffer, view.byteOffset + start, count);
    const end = raw.indexOf(0);
    return new TextDecoder('utf-8').decode(end === -1 ? raw : raw.subarray(0, end));
  }

  if (type === TYPE.UNDEFINED) {
    // Handed back raw: the meaning depends on the tag (see readUserComment).
    return new Uint8Array(view.buffer, view.byteOffset + start, count).slice();
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

function readIfd(reader: Reader, ifdOffset: number): Map<number, TagValue> {
  const out = new Map<number, TagValue>();
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

/** Decodes a UserComment payload according to its 8-byte character-code prefix. */
export function decodeUserComment(bytes: Uint8Array, little: boolean): string {
  if (bytes.length <= 8) return '';
  const prefix = bytes.subarray(0, 8);
  const body = bytes.subarray(8);
  const matches = (expected: number[]) => expected.every((b, i) => prefix[i] === b);

  if (matches(UNICODE_PREFIX)) {
    const text = new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(body);
    return text.replace(/\0+$/, '').trim();
  }
  if (matches(ASCII_PREFIX) || prefix.every((b) => b === 0)) {
    const end = body.indexOf(0);
    return new TextDecoder('utf-8')
      .decode(end === -1 ? body : body.subarray(0, end))
      .trim();
  }
  return ''; // JIS and other encodings are not something Torikoto writes.
}

function toDegrees(parts: TagValue | undefined, ref: string | undefined): number | null {
  if (!Array.isArray(parts) || parts.length < 3 || typeof ref !== 'string') return null;
  const [deg, min, sec] = parts;
  const value = deg + min / 60 + sec / 3600;
  if (!Number.isFinite(value)) return null;
  const negative = ref.toUpperCase().startsWith('S') || ref.toUpperCase().startsWith('W');
  return negative ? -value : value;
}

/** Reads the tags Torikoto cares about. Returns {} for anything it cannot parse. */
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

    const comment = exif.get(TAG.UserComment);
    const description = ifd0.get(TAG.ImageDescription);
    const caption =
      comment instanceof Uint8Array ? decodeUserComment(comment, little) : '';
    const fallback = typeof description === 'string' ? description.trim() : '';
    if (caption || fallback) result.caption = caption || fallback;

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

/**
 * ImageDescription has no way to declare an encoding, so readers assume ASCII
 * (Pillow, for one, decodes it as latin-1). Writing UTF-8 there turns a
 * Japanese memo into mojibake, which is worse than leaving the field out: the
 * caption still travels in UserComment and XMP, both of which are explicitly
 * Unicode. So it is written only when the memo is plain ASCII.
 */
function isAscii(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e\r\n\t]*$/.test(text);
}

/** "UNICODE\0" + UTF-16 in the TIFF byte order (little endian here). */
function userComment(text: string): Uint8Array {
  const bytes = new Uint8Array(8 + text.length * 2);
  bytes.set(UNICODE_PREFIX);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(8 + i * 2, text.charCodeAt(i), true);
  }
  return bytes;
}

/** Keeps a memo inside one APP1 segment without cutting a surrogate pair. */
export function clampCaption(memo: string): string {
  const text = memo.trim();
  if (text.length <= MAX_CAPTION_CHARS) return text;
  const cut = text.slice(0, MAX_CAPTION_CHARS);
  // Do not end on a lone high surrogate.
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
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
  /** The record's memo, written as the photo's caption. */
  memo?: string | null;
}

/** Builds the APP1 payload (TIFF header onwards). */
export function buildExifPayload(input: ExifInput): Uint8Array {
  const date = new Date(input.capturedAt);
  const stamp = ascii(formatExifDateTime(date));
  const offset = ascii(formatExifOffset(date));
  const point = input.location ?? null;
  const caption = clampCaption(input.memo ?? '');
  const description = caption && isAscii(caption) ? ascii(caption) : null;
  const comment = caption ? userComment(caption) : null;

  const exifEntries: Entry[] = [
    { tag: TAG.ExifVersion, type: TYPE.UNDEFINED, count: 4, value: ascii('0232').slice(0, 4) },
    { tag: TAG.DateTimeOriginal, type: TYPE.ASCII, count: stamp.length, value: stamp },
    { tag: TAG.DateTimeDigitized, type: TYPE.ASCII, count: stamp.length, value: stamp },
    { tag: TAG.OffsetTimeOriginal, type: TYPE.ASCII, count: offset.length, value: offset },
  ];
  if (comment) {
    exifEntries.push({
      tag: TAG.UserComment,
      type: TYPE.UNDEFINED,
      count: comment.length,
      value: comment,
    });
  }

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
  // IFD0 entries must be written in ascending tag order.
  const ifd0Entries: Entry[] = [];
  if (description) {
    ifd0Entries.push({
      tag: TAG.ImageDescription,
      type: TYPE.ASCII,
      count: description.length,
      value: description,
    });
  }
  ifd0Entries.push({ tag: TAG.DateTime, type: TYPE.ASCII, count: stamp.length, value: stamp });

  const ifd0Offset = 8;
  // The entries above, plus the Exif pointer and (with a fix) the GPS pointer.
  const ifd0Size = 2 + (ifd0Entries.length + 1 + (point ? 1 : 0)) * 12 + 4;
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
 * Returns a copy of `jpeg` carrying the capture time, the place and the memo.
 *
 * Two APP1 segments are written: the EXIF one (DateTimeOriginal, GPS,
 * ImageDescription, UserComment) and an XMP one holding `dc:description`.
 * The duplication is deliberate — which field a viewer shows as "caption"
 * differs by app, and only XMP and UserComment are reliably Unicode.
 * Segments Torikoto wrote before are replaced, never stacked. A non-JPEG is
 * returned untouched.
 */
export async function withExif(jpeg: Blob, input: ExifInput): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return jpeg;

    const rest = stripMetadataSegments(bytes);
    const segments: Uint8Array[] = [];

    const exifSegment = app1(EXIF_HEADER, buildExifPayload(input));
    if (!exifSegment) return jpeg; // would not fit — leave the photo alone
    segments.push(exifSegment);

    const caption = clampCaption(input.memo ?? '');
    if (caption) {
      const xmp = app1(
        Array.from(new TextEncoder().encode(XMP_HEADER)),
        new TextEncoder().encode(buildXmpPacket(caption)),
      );
      if (xmp) segments.push(xmp);
    }

    const total = 2 + segments.reduce((sum, seg) => sum + seg.length, 0) + rest.length;
    const out = new Uint8Array(total);
    out.set([0xff, 0xd8], 0);
    let cursor = 2;
    for (const segment of segments) {
      out.set(segment, cursor);
      cursor += segment.length;
    }
    out.set(rest, cursor);
    return new Blob([out], { type: jpeg.type || 'image/jpeg' });
  } catch {
    return jpeg;
  }
}

/** One APP1 segment: marker, length, namespace header, payload. */
function app1(header: number[], payload: Uint8Array): Uint8Array | null {
  const length = payload.length + header.length + 2;
  if (length > 0xffff) return null;
  const segment = new Uint8Array(2 + length);
  segment.set([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff], 0);
  segment.set(header, 4);
  segment.set(payload, 4 + header.length);
  return segment;
}

/**
 * Everything after SOI with the EXIF and XMP APP1 segments taken out, so a
 * re-stamped photo never accumulates stale copies.
 */
function stripMetadataSegments(bytes: Uint8Array): Uint8Array {
  const keep: Uint8Array[] = [];
  let offset = 2;
  const xmpHeader = new TextEncoder().encode(XMP_HEADER);

  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    // From SOS onwards it is entropy-coded image data, not segments.
    if (marker === 0xda || marker === 0xd9) break;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2 || offset + 2 + size > bytes.length) break;

    const start = offset + 4;
    const isExif = EXIF_HEADER.every((b, i) => bytes[start + i] === b);
    const isXmp = xmpHeader.every((b, i) => bytes[start + i] === b);
    if (!(marker === 0xe1 && (isExif || isXmp))) {
      keep.push(bytes.subarray(offset, offset + 2 + size));
    }
    offset += 2 + size;
  }

  const tail = bytes.subarray(offset);
  const out = new Uint8Array(keep.reduce((sum, part) => sum + part.length, 0) + tail.length);
  let cursor = 0;
  for (const part of keep) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(tail, cursor);
  return out;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The smallest XMP packet that carries a caption. `dc:description` is what
 * photo apps and desktop tools show as the description/caption field, and it
 * is UTF-8, so Japanese needs no special handling.
 */
export function buildXmpPacket(caption: string): string {
  return (
    `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Torikoto">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(caption)}</rdf:li>` +
    `</rdf:Alt></dc:description>` +
    `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
}
