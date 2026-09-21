/**
 * Small user preferences.
 *
 * localStorage is fine here — these are a few bytes of scalar settings, never
 * photos or records (those live in IndexedDB / the filesystem).
 */
/** Kept from the app's former name so existing settings are not orphaned. */
const KEY = 'picta.settings.v1';

export interface Settings {
  /** Also save each capture to the device photo library (spec §9.2). */
  savePhotosToLibrary: boolean;
  /** Attach the place a photo was taken, and write it into the JPEG's EXIF. */
  recordLocation: boolean;
}

const DEFAULTS: Settings = {
  savePhotosToLibrary: true,
  recordLocation: true,
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
