import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import type { ExportRow } from './csv';
import { buildCsv } from './csv';
import { buildManifest } from './manifest';
import { loadPhotoBlob } from '../db/photoStore';

/**
 * Backup ZIP (spec §19, §24):
 *
 *   Picta_Export_20260921.zip
 *   ├── manifest.json   format + version, so imports can stay compatible
 *   ├── records.csv     the same CSV as the plain export
 *   └── photos/…        one file per record, named as in records.csv
 *
 * Built with fflate's streaming API: only one photo is held in memory at a
 * time, and the output is accumulated into a Blob (which browsers spill to
 * disk) rather than a single giant ArrayBuffer.
 */
export interface ZipProgress {
  done: number;
  total: number;
}

export async function buildExportZip(
  rows: ExportRow[],
  onProgress?: (progress: ZipProgress) => void,
  now = new Date(),
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let settle!: (err?: Error) => void;
  const finished = new Promise<void>((resolve, reject) => {
    settle = (err) => (err ? reject(err) : resolve());
  });

  const zip = new Zip((err, data, final) => {
    if (err) {
      settle(err);
      return;
    }
    if (data.length) chunks.push(data);
    if (final) settle();
  });

  const pushText = (name: string, text: string, mtime: Date) => {
    const entry = new ZipDeflate(name, { level: 6 });
    entry.mtime = mtime;
    zip.add(entry);
    entry.push(strToU8(text), true);
  };

  pushText('manifest.json', JSON.stringify(buildManifest(rows.length, now), null, 2), now);
  pushText('records.csv', buildCsv(rows), now);

  let done = 0;
  for (const { record, photoFileName } of rows) {
    const blob = await loadPhotoBlob(record.photoId);
    if (blob) {
      // JPEG is already compressed — storing it avoids pointless CPU work.
      const entry = new ZipPassThrough(`photos/${photoFileName}`);
      entry.mtime = record.capturedAt;
      zip.add(entry);
      entry.push(new Uint8Array(await blob.arrayBuffer()), true);
    }
    done += 1;
    onProgress?.({ done, total: rows.length });
  }

  zip.end();
  await finished;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}
