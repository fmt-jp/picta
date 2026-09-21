/** Core domain types shared across every screen and platform adapter. */

/** Where a photo was taken. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
  /** Metres, for device fixes only. */
  accuracy?: number;
  /** 'device' = the Geolocation API at shutter time, 'exif' = read from a file. */
  source: 'device' | 'exif';
}

/** A stored tag. `name` is unique (case-sensitive, trimmed). */
export interface Tag {
  id: string;
  name: string;
  /** ms epoch — used to keep the registered-tag list in a stable order. */
  createdAt: number;
}

/**
 * One Torikoto record: a photo plus the optional one-liner that was added to it.
 *
 * The photo bytes are NOT stored here. `photoId` points at the blob store so
 * that listing records never has to pull megabytes of image data into memory.
 */
export interface Record {
  id: string;
  photoId: string;
  /** Canonical file name used by the ZIP/CSV export, e.g. 20260921_123100.jpg */
  photoFileName: string;
  memo: string;
  /** Tag names (not ids) — records survive a tag being renamed or deleted. */
  tags: string[];
  /** ms epoch — when the shutter was pressed. */
  capturedAt: number;
  /** Where the photo was taken, when a fix was available and allowed. */
  location?: GeoPoint;
  /** ms epoch — when the record was written to storage. */
  createdAt: number;
  /** ms epoch — last edit of memo/tags. */
  updatedAt: number;
}

/** A photo blob together with the metadata needed to write it back out. */
export interface StoredPhoto {
  id: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
}

/** Draft held in memory between the camera screen and the review screen. */
export interface PendingCapture {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  capturedAt: number;
  /**
   * The location fix started when the shutter was pressed. It is awaited (with
   * a short deadline) at save time so waiting for GPS never blocks framing the
   * next shot. Null once resolved with no usable fix.
   */
  locationFix?: Promise<GeoPoint | null>;
  /** Object URL for the preview; revoked when the draft is discarded. */
  previewUrl: string;
}
