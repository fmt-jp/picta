import type { GeoPoint } from '../types';

/**
 * Where the photo was taken.
 *
 * A canvas capture carries no EXIF at all, so the coordinates have to come
 * from the Geolocation API. The permission is requested the first time a photo
 * is taken with location recording on — never at start-up — and a refusal is
 * remembered by the browser, so Torikoto does not ask again by itself.
 */
const TIMEOUT_MS = 10_000;
/** A fix from the last minute is close enough for "where was this taken". */
const MAX_AGE_MS = 60_000;

export function hasGeolocation(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Starts a fix. Never rejects: a denied permission, a timeout or an
 * unavailable sensor all resolve to null, because a photo is always worth more
 * than its coordinates.
 */
export function requestLocation(): Promise<GeoPoint | null> {
  if (!hasGeolocation()) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy:
            typeof position.coords.accuracy === 'number'
              ? Math.round(position.coords.accuracy)
              : undefined,
          source: 'device',
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
  });
}

/** Resolves with whatever the fix has produced by `ms`, otherwise null. */
export function awaitLocation(
  fix: Promise<GeoPoint | null> | undefined,
  ms: number,
): Promise<GeoPoint | null> {
  if (!fix) return Promise.resolve(null);
  return Promise.race([
    fix,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
  ]);
}

/** 35.681236, 139.767125 — the form shown on the record detail screen. */
export function formatCoordinates(point: GeoPoint): string {
  return `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
}

/** A link the OS can hand to a map app. */
export function mapUrl(point: GeoPoint): string {
  return `https://www.google.com/maps?q=${point.latitude},${point.longitude}`;
}
