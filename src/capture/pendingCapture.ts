import type { PendingCapture } from '../types';

/**
 * The single in-flight capture between the camera screen and the review screen.
 *
 * A module-level holder (rather than router state) keeps the Blob out of the
 * history stack and makes it easy to revoke the preview object URL exactly once.
 */
let pending: PendingCapture | null = null;

export function setPendingCapture(next: PendingCapture): void {
  clearPendingCapture();
  pending = next;
}

export function getPendingCapture(): PendingCapture | null {
  return pending;
}

export function clearPendingCapture(): void {
  if (pending) URL.revokeObjectURL(pending.previewUrl);
  pending = null;
}
