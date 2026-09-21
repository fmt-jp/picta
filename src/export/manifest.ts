import { CSV_COLUMNS } from './csv';

/**
 * Written to the root of every ZIP export so a future Picta (or any other
 * tool) can tell what it is looking at and stay backward compatible (spec §24).
 */
export const EXPORT_FORMAT = 'picta-export';
export const EXPORT_VERSION = 1;

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  version: number;
  app: string;
  exportedAt: string;
  recordCount: number;
  /** Minutes to add to UTC to get the local times written in the CSV. */
  timezoneOffsetMinutes: number;
  csv: {
    file: string;
    encoding: 'utf-8-bom';
    columns: readonly string[];
    tagSeparator: '|';
  };
  photoDir: string;
}

export function buildManifest(recordCount: number, now = new Date()): ExportManifest {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    app: 'Picta 1.0',
    exportedAt: now.toISOString(),
    recordCount,
    timezoneOffsetMinutes: -now.getTimezoneOffset(),
    csv: {
      file: 'records.csv',
      encoding: 'utf-8-bom',
      columns: CSV_COLUMNS,
      tagSeparator: '|',
    },
    photoDir: 'photos/',
  };
}
