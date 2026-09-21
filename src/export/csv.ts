import type { Record } from '../types';

/**
 * CSV shape:
 *   id,capturedAt,memo,tags,photoFileName,latitude,longitude
 *
 * The first five columns are the format from spec §18.1; the coordinates were
 * appended (export version 2) once places were recorded, so a reader that only
 * knows the original five still lines up. They are empty when a record has no
 * place. Photos are never embedded in the CSV — the ZIP export pairs this file
 * with a photos/ directory using the same `photoFileName` values.
 */
export const CSV_COLUMNS = [
  'id',
  'capturedAt',
  'memo',
  'tags',
  'photoFileName',
  'latitude',
  'longitude',
] as const;

/** Excel on Japanese Windows reads UTF-8 as Shift_JIS without this marker. */
export const BOM = '﻿';

/** 2026-09-21T12:31:00 in the device's local time. */
export function formatCapturedAt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export interface ExportRow {
  record: Record;
  /** Unique within one export — see uniquePhotoFileNames. */
  photoFileName: string;
}

/**
 * Two photos taken in the same second would collide, so later duplicates get
 * a `_2`, `_3` … suffix. The CSV and the ZIP always agree on the result.
 */
export function uniquePhotoFileNames(records: Record[]): ExportRow[] {
  const used = new Map<string, number>();
  return records.map((record) => {
    const base = record.photoFileName;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    if (seen === 0) return { record, photoFileName: base };

    const dot = base.lastIndexOf('.');
    const stem = dot === -1 ? base : base.slice(0, dot);
    const ext = dot === -1 ? '' : base.slice(dot);
    return { record, photoFileName: `${stem}_${seen + 1}${ext}` };
  });
}

/** Tags are joined with `|` so a comma inside the CSV stays unambiguous. */
export function buildCsv(rows: ExportRow[], withBom = true): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const { record, photoFileName } of rows) {
    lines.push(
      [
        record.id,
        formatCapturedAt(record.capturedAt),
        escapeCsvField(record.memo),
        escapeCsvField(record.tags.join('|')),
        escapeCsvField(photoFileName),
        record.location ? record.location.latitude.toFixed(6) : '',
        record.location ? record.location.longitude.toFixed(6) : '',
      ].join(','),
    );
  }
  // CRLF keeps Excel happy with embedded newlines in a memo.
  return (withBom ? BOM : '') + lines.join('\r\n') + '\r\n';
}

/** Torikoto_Export_20260921 */
export function exportBaseName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Torikoto_Export_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}
