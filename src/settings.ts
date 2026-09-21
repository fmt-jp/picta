/**
 * Small user preferences.
 *
 * localStorage is fine here — these are a few bytes of scalar settings, never
 * photos or records (those live in IndexedDB / the filesystem).
 */
const KEY = 'picta.settings.v1';

export interface Settings {
  /** Also save each capture to the device photo library (spec §9.2). */
  savePhotosToLibrary: boolean;
}

const DEFAULTS: Settings = {
  savePhotosToLibrary: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* Private mode / quota — the app still works with in-memory defaults. */
  }
  return merged;
}
