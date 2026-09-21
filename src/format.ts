/** Japanese date/time formatting used across the record screens. */

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
});

/** 2026年9月21日 */
export function formatDate(ms: number): string {
  return dateFormatter.format(new Date(ms));
}

/** 12:31 */
export function formatTime(ms: number): string {
  return timeFormatter.format(new Date(ms));
}

/** 2026年9月21日 12:31 */
export function formatDateTime(ms: number): string {
  return `${formatDate(ms)} ${formatTime(ms)}`;
}

/** Local-day key used to group a list by 撮影日. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 1.2MB / 340KB — for the storage line in 設定. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
