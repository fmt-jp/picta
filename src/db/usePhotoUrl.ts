import { useEffect, useState } from 'react';
import { loadPhotoBlob } from './photoStore';

/**
 * Object URLs for stored photos, shared and reference-counted.
 *
 * A record list can show the same photo in several places (list → detail →
 * edit) and scrolling should not re-read the blob every time. The URL is
 * revoked once the last subscriber unmounts.
 */
interface Entry {
  url: string;
  refs: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();

async function acquire(photoId: string): Promise<string | null> {
  const cached = cache.get(photoId);
  if (cached) {
    cached.refs += 1;
    return cached.url;
  }
  let pending = inflight.get(photoId);
  if (!pending) {
    pending = (async () => {
      const blob = await loadPhotoBlob(photoId);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      cache.set(photoId, { url, refs: 0 });
      return url;
    })().finally(() => inflight.delete(photoId));
    inflight.set(photoId, pending);
  }
  const url = await pending;
  if (!url) return null;
  const entry = cache.get(photoId);
  if (entry) entry.refs += 1;
  return url;
}

function release(photoId: string): void {
  const entry = cache.get(photoId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    URL.revokeObjectURL(entry.url);
    cache.delete(photoId);
  }
}

/** Forget a photo's URL — call after the underlying photo is deleted. */
export function invalidatePhotoUrl(photoId: string): void {
  const entry = cache.get(photoId);
  if (!entry) return;
  URL.revokeObjectURL(entry.url);
  cache.delete(photoId);
}

export function usePhotoUrl(photoId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photoId) {
      setUrl(null);
      return;
    }
    let active = true;
    let acquired = false;
    acquire(photoId).then((next) => {
      if (!active) {
        if (next) release(photoId);
        return;
      }
      acquired = next !== null;
      setUrl(next);
    });
    return () => {
      active = false;
      if (acquired) release(photoId);
    };
  }, [photoId]);

  return url;
}
