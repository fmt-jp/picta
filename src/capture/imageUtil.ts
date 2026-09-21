/**
 * Photo encoding helpers.
 *
 * Picta records are square (1:1). The viewfinder shows a square crop of the
 * camera stream and the saved photo is exactly that crop, so what you framed
 * is what you get.
 *
 * Photos are the bulk of Picta's storage, so captures are capped at a sane
 * long-edge size before they ever reach the database. 2048px keeps a photo
 * sharp on any phone screen and in a printed export while keeping a typical
 * capture in the 300KB–800KB range.
 */
export const MAX_EDGE = 2048;
export const JPEG_QUALITY = 0.9;
export const PHOTO_MIME = 'image/jpeg';

export interface EncodedPhoto {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
}

/** Scale so the long edge is at most MAX_EDGE; never upscales. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge || longEdge === 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Source rectangle to read out of a frame before scaling. */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The largest centred square inside a frame — the same crop the square
 * viewfinder shows with `object-fit: cover`.
 */
export function centeredSquareCrop(width: number, height: number): CropRect {
  const size = Math.min(width, height);
  return {
    sx: Math.round((width - size) / 2),
    sy: Math.round((height - size) / 2),
    sw: size,
    sh: size,
  };
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType = PHOTO_MIME,
  quality = JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像の生成に失敗しました'))),
      mimeType,
      quality,
    );
  });
}

export interface EncodeOptions {
  /** Flip horizontally so a front-camera photo matches the mirrored preview. */
  mirror?: boolean;
  /** Region of the source to keep. Defaults to the centred square. */
  crop?: CropRect;
}

/** Draw a source frame into a correctly sized JPEG. */
export async function encodeFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: EncodeOptions = {},
): Promise<EncodedPhoto> {
  const crop = options.crop ?? centeredSquareCrop(sourceWidth, sourceHeight);
  const { width, height } = fitWithin(crop.sw, crop.sh);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像の生成に失敗しました');
  if (options.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  const blob = await canvasToBlob(canvas);
  return { blob, mimeType: PHOTO_MIME, width, height };
}

/**
 * Re-encode a picked/imported image file the same way a capture is encoded, so
 * a photo taken through the file fallback is square like every other record.
 */
export async function encodeImageFile(file: Blob): Promise<EncodedPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('画像を読み込めませんでした'));
      el.src = url;
    });
    return await encodeFrame(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 20260921_123100 — the timestamp form used for exported photo file names. */
export function photoStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}
