import { isNative } from './env';
import { loadSettings, saveSettings } from '../settings';

/**
 * Durability of the app's own storage.
 *
 * On the web the photos live in IndexedDB, which a browser is free to evict
 * when the device runs low on space. `navigator.storage.persist()` asks it not
 * to. Chromium decides from engagement heuristics (an installed PWA usually
 * qualifies), Safari grants it to home-screen apps, and Firefox asks the user —
 * which is why the automatic request happens after the first save rather than
 * at start-up, and never more than once.
 *
 * Native builds keep photos as files in the app's private directory, which the
 * OS does not evict, so there is nothing to request.
 */
export type PersistenceState = 'native' | 'unsupported' | 'persisted' | 'not-persisted';

export function supportsPersistence(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.persist === 'function' &&
    typeof navigator.storage?.persisted === 'function'
  );
}

export async function checkPersistence(): Promise<PersistenceState> {
  if (isNative()) return 'native';
  if (!supportsPersistence()) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

/** Asks the browser to keep this data. Safe to call when already granted. */
export async function requestPersistence(): Promise<PersistenceState> {
  if (isNative()) return 'native';
  if (!supportsPersistence()) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'persisted';
    return (await navigator.storage.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

/**
 * Requests persistence once, after the user has something worth keeping.
 * The flag is remembered so a browser that asks the user is not asked twice.
 */
export async function ensurePersistenceOnce(): Promise<void> {
  if (isNative() || !supportsPersistence()) return;
  try {
    if (await navigator.storage.persisted()) return;
    if (loadSettings().persistenceRequested) return;
    saveSettings({ persistenceRequested: true });
    await navigator.storage.persist();
  } catch {
    /* Never let this get in the way of saving a record. */
  }
}
