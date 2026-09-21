import { CSV_COLUMNS } from './csv';

/**
 * Written to the root of every ZIP export so a future Torikoto (or any other
 * tool) can tell what it is looking at and stay backward compatible (spec §24).
 */
export const EXPORT_FORMAT = 'torikoto-export';
/**
 * What versions 1 and 2 were written as, before the app was renamed. A future
 * importer must accept it — those archives are otherwise identical.
 */
export const LEGACY_EXPORT_FORMAT = 'picta-export';
/** 2 added the latitude/longitude columns to records.csv. */
export const EXPORT_VERSION = 2;

export interface ExportManifest {
  format: typeof EXPORT_FORMAT | typeof LEGACY_EXPORT_FORMAT;
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
    app: 'Torikoto 1.0',
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
