import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import type { GeoPoint, Record } from '../types';
import { getDb } from '../db/database';
import { newId } from '../db/ids';
import { savePhoto } from '../db/photoStore';
import { ensureTag, normalizeTagName } from '../db/tags';
import { EXPORT_FORMAT, LEGACY_EXPORT_FORMAT } from './manifest';
import { csvColumns, parseCapturedAt, parseCsv } from './csvParse';
import { jpegSize } from '../capture/exif';

/**
 * Restores a backup written by the ZIP export.
 *
 * The archive is read twice as a stream rather than unpacked into memory: a
 * real backup is mostly photos, and holding a few hundred of them at once
 * would be enough to end a phone's tab. The first pass takes the two small
 * metadata files, the second writes the photos one at a time.
 *
 * Records whose id is already stored are skipped, so re-importing the same
 * archive changes nothing and can never overwrite what is on the device.
 */
export interface ImportSummary {
  format: string;
  version: number;
  /** Records described by records.csv. */
  total: number;
  imported: number;
  skipped: number;
  /** Rows that could not be restored (missing photo, unreadable row). */
  failed: number;
  notes: string[];
}

export interface ImportProgress {
  done: number;
  total: number;
}

interface Manifest {
  format?: string;
  version?: number;
  timezoneOffsetMinutes?: number;
}

interface PlannedRecord {
  id: string;
  capturedAt: number;
  memo: string;
  tags: string[];
  photoFileName: string;
  location?: GeoPoint;
}

const PHOTO_PREFIX = 'photos/';

/** Reads selected entries out of a ZIP stream without buffering the rest. */
async function streamZip(
  file: Blob,
  wanted: (name: string) => boolean,
  onEntry: (name: string, bytes: Uint8Array) => Promise<void> | void,
): Promise<void> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);

  const ready: { name: string; bytes: Uint8Array }[] = [];
  unzip.onfile = (entry) => {
    if (!wanted(entry.name)) return; // never started → its data is discarded
    const chunks: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (err, chunk, final) => {
      if (err) throw err;
      if (chunk?.length) {
        chunks.push(chunk);
        size += chunk.length;
      }
      if (final) {
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const part of chunks) {
          bytes.set(part, at);
          at += part.length;
        }
        ready.push({ name: entry.name, bytes });
      }
    };
    entry.start();
  };

  const drain = async () => {
    while (ready.length) {
      const entry = ready.shift()!;
      await onEntry(entry.name, entry.bytes);
    }
  };

  for await (const chunk of readChunks(file)) {
    unzip.push(chunk, false);
    // Between chunks, hand over whatever finished so it is not all held at once.
    await drain();
  }
  unzip.push(new Uint8Array(0), true);
  await drain();
}

/**
 * Chunks of a Blob. `Blob.stream()` is used where it exists; older iOS Safari
 * (and jsdom) lack it, so there slices are read one at a time — which still
 * avoids pulling a whole backup into memory.
 */
async function* readChunks(file: Blob, size = 1024 * 1024): AsyncGenerator<Uint8Array> {
  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value as Uint8Array;
    }
    return;
  }
  for (let at = 0; at < file.size; at += size) {
    yield new Uint8Array(await file.slice(at, at + size).arrayBuffer());
  }
}

/** First pass: manifest.json and records.csv. */
async function readMetadata(file: Blob): Promise<{ manifest: Manifest; csv: string }> {
  let manifest: Manifest = {};
  let csv = '';

  await streamZip(
    file,
    (name) => name === 'manifest.json' || name === 'records.csv',
    (name, bytes) => {
      if (name === 'manifest.json') {
        try {
          manifest = JSON.parse(strFromU8(bytes)) as Manifest;
        } catch {
          /* A malformed manifest is not fatal — the CSV is what matters. */
        }
      } else {
        csv = strFromU8(bytes);
      }
    },
  );

  return { manifest, csv };
}

function planRecords(csv: string, offsetMinutes?: number): { rows: PlannedRecord[]; failed: number } {
  const table = parseCsv(csv);
  if (table.length < 2) return { rows: [], failed: 0 };

  const columns = csvColumns(table[0]);
  const at = (row: string[], name: string) => {
    const index = columns.get(name);
    return index === undefined ? '' : (row[index] ?? '');
  };

  const rows: PlannedRecord[] = [];
  let failed = 0;

  for (const row of table.slice(1)) {
    if (row.length === 1 && row[0].trim() === '') continue; // blank line
    const photoFileName = at(row, 'photoFileName').trim();
    const capturedAt = parseCapturedAt(at(row, 'capturedAt'), offsetMinutes);
    if (!photoFileName || capturedAt === undefined) {
      failed += 1;
      continue;
    }

    const latitude = Number(at(row, 'latitude'));
    const longitude = Number(at(row, 'longitude'));
    const hasLocation =
      at(row, 'latitude').trim() !== '' &&
      at(row, 'longitude').trim() !== '' &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude);

    rows.push({
      id: at(row, 'id').trim() || newId(),
      capturedAt,
      memo: at(row, 'memo'),
      tags: at(row, 'tags')
        .split('|')
        .map(normalizeTagName)
        .filter(Boolean),
      photoFileName,
      location: hasLocation
        ? { latitude, longitude, source: 'import' }
        : undefined,
    });
  }

  return { rows, failed };
}

/** What the archive holds, without changing anything. */
export async function inspectExportZip(file: Blob): Promise<ImportSummary> {
  const { manifest, csv } = await readMetadata(file);
  const { rows, failed } = planRecords(csv, manifest.timezoneOffsetMinutes);
  const notes: string[] = [];

  const format = manifest.format ?? '';
  if (format && format !== EXPORT_FORMAT && format !== LEGACY_EXPORT_FORMAT) {
    notes.push(`見覚えのない形式です（${format}）。読み込めない可能性があります。`);
  }
  if (!csv) notes.push('records.csv が見つかりません。');
  if (failed > 0) notes.push(`${failed}件は日付か写真名が読めませんでした。`);

  return {
    format: format || '不明',
    version: manifest.version ?? 0,
    total: rows.length,
    imported: 0,
    skipped: 0,
    failed,
    notes,
  };
}

/**
 * Restores the archive. Existing ids are left alone, so importing the same
 * backup twice is harmless.
 */
export async function importExportZip(
  file: Blob,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportSummary> {
  const { manifest, csv } = await readMetadata(file);
  const { rows, failed } = planRecords(csv, manifest.timezoneOffsetMinutes);
  const summary: ImportSummary = {
    format: manifest.format ?? '不明',
    version: manifest.version ?? 0,
    total: rows.length,
    imported: 0,
    skipped: 0,
    failed,
    notes: [],
  };
  if (rows.length === 0) {
    if (!csv) summary.notes.push('records.csv が見つかりません。');
    return summary;
  }

  const db = await getDb();
  const byPhotoName = new Map<string, PlannedRecord>();
  for (const row of rows) {
    if (await db.get('records', row.id)) {
      summary.skipped += 1;
      continue;
    }
    byPhotoName.set(row.photoFileName, row);
  }

  // Second pass: write each photo as it arrives, then its record.
  await streamZip(
    file,
    (name) => name.startsWith(PHOTO_PREFIX) && byPhotoName.has(name.slice(PHOTO_PREFIX.length)),
    async (name, bytes) => {
      const planned = byPhotoName.get(name.slice(PHOTO_PREFIX.length));
      if (!planned) return;
      byPhotoName.delete(planned.photoFileName);

      try {
        const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
        // Read the size from the JPEG header rather than decoding the image:
        // instant, and it works wherever this runs.
        const size = jpegSize(bytes) ?? { width: 0, height: 0 };
        const photoId = newId();
        await savePhoto(photoId, {
          blob,
          mimeType: 'image/jpeg',
          width: size.width,
          height: size.height,
        });
        for (const tag of planned.tags) await ensureTag(tag);

        const now = Date.now();
        const record: Record = {
          id: planned.id,
          photoId,
          photoFileName: planned.photoFileName,
          memo: planned.memo.trim(),
          tags: planned.tags,
          capturedAt: planned.capturedAt,
          createdAt: now,
          updatedAt: now,
        };
        if (planned.location) record.location = planned.location;
        await db.put('records', record);
        summary.imported += 1;
      } catch {
        summary.failed += 1;
      }
      onProgress?.({ done: summary.imported + summary.failed, total: rows.length });
    },
  );

  // Rows whose photo was not in the archive.
  if (byPhotoName.size > 0) {
    summary.failed += byPhotoName.size;
    summary.notes.push(`${byPhotoName.size}件は写真がZIPに入っていませんでした。`);
  }
  if (summary.skipped > 0) {
    summary.notes.push(`${summary.skipped}件はすでにある記録なので飛ばしました。`);
  }
  return summary;
}
