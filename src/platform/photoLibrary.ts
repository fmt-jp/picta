import { hasNativePlugin, isIosSafari, isNative } from './env';
import { blobToBase64 } from './base64';

/**
 * Saving a copy of the capture to the *device* photo library.
 *
 * This copy is independent of the one Torikoto keeps: deleting a Torikoto record
 * never touches it, and deleting it from the photo library never affects the
 * record (spec §9.2, §14).
 *
 * What is actually possible differs per platform:
 *   iOS / Android (native) — written straight into the camera roll.
 *   Web / PWA              — a browser download. The OS decides where it lands
 *                            (Android: Downloads, usually picked up by the
 *                            gallery; iOS Safari: the Files app). Putting it in
 *                            the iOS Photos app requires the share sheet, which
 *                            needs its own tap, so it is offered as an explicit
 *                            action on the record instead.
 */
export type LibrarySaveStatus =
  | 'saved'
  | 'downloaded'
  | 'shared'
  | 'denied'
  | 'unsupported'
  | 'failed';

export interface LibrarySaveResult {
  status: LibrarySaveStatus;
  message?: string;
}

/** How a photo can reach the device on this platform. */
export function photoLibraryMode(): 'native' | 'download' | 'unsupported' {
  if (isNative() && hasNativePlugin('Media')) return 'native';
  if (typeof document !== 'undefined') return 'download';
  return 'unsupported';
}

export function canShareFiles(blob?: Blob): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  if (!blob) return true;
  try {
    return nav.canShare({ files: [new File([blob], 'photo.jpg', { type: blob.type })] });
  } catch {
    return false;
  }
}

/** iOS Safari cannot silently write to Photos; tell the user how to get there. */
export function photoLibraryHint(): string {
  switch (photoLibraryMode()) {
    case 'native':
      return '撮影した写真は端末のカメラロールにも保存されます。';
    case 'download':
      return isIosSafari()
        ? '撮影した写真は端末にダウンロードされます（ファイルApp）。写真Appに入れる場合は記録詳細の「端末に保存」から共有してください。'
        : '撮影した写真は端末にダウンロードされます。';
    default:
      return 'この環境では端末への保存を利用できません。';
  }
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Safari needs the URL to stay alive until the download has started.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Save `blob` to the device.
 * `viaShare` opens the OS share sheet instead — the only route into the iOS
 * Photos app from a web build. It must be called directly from a user gesture.
 */
export async function savePhotoToLibrary(
  blob: Blob,
  fileName: string,
  options: { viaShare?: boolean } = {},
): Promise<LibrarySaveResult> {
  try {
    if (options.viaShare) {
      const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
      if (!canShareFiles(blob)) {
        triggerDownload(blob, fileName);
        return { status: 'downloaded' };
      }
      await navigator.share({ files: [file], title: fileName });
      return { status: 'shared' };
    }

    if (photoLibraryMode() === 'native') {
      const { Media } = await import('@capacitor-community/media');
      const base64 = await blobToBase64(blob);
      await Media.savePhoto({
        path: `data:${blob.type || 'image/jpeg'};base64,${base64}`,
        // Android wants a name without the extension.
        fileName: fileName.replace(/\.[^.]+$/, ''),
      });
      return { status: 'saved' };
    }

    if (photoLibraryMode() === 'download') {
      triggerDownload(blob, fileName);
      return { status: 'downloaded' };
    }

    return { status: 'unsupported' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(message)) return { status: 'failed', message: '保存を中止しました' };
    if (/denied|permission|not allowed/i.test(message)) {
      return { status: 'denied', message: '写真ライブラリへの保存が許可されていません' };
    }
    return { status: 'failed', message };
  }
}
