/**
 * RFC 4180 style CSV reader, for reading back what the export writes.
 *
 * Quoted fields may contain commas, newlines and doubled quotes — a memo can
 * hold all three — so splitting on commas is not enough.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Header row → column name → index, so a missing or reordered column is fine. */
export function csvColumns(header: string[]): Map<string, number> {
  const columns = new Map<string, number>();
  header.forEach((name, index) => columns.set(name.trim(), index));
  return columns;
}

/**
 * "2026-09-21T12:31:00" → ms epoch.
 * The CSV holds local time with no offset, so the exporter's own offset (from
 * manifest.json) is used when available; otherwise this device's zone is the
 * best guess, exactly as when reading EXIF.
 */
export function parseCapturedAt(text: string, offsetMinutes?: number): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!m) return undefined;

  if (typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)) {
    const sign = offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(offsetMinutes);
    const pad = (n: number) => String(n).padStart(2, '0');
    const parsed = Date.parse(
      `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}` +
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
    );
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? '0'),
  ).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}
