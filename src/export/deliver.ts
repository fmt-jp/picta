import { isNative } from '../platform/env';
import { blobToBase64 } from '../platform/base64';
import { canShareFiles } from '../platform/photoLibrary';

export type DeliverStatus = 'downloaded' | 'shared' | 'failed';

export interface DeliverResult {
  status: DeliverStatus;
  message?: string;
}

/**
 * Hands a finished export to the user.
 *
 * Web  — a normal download.
 * iOS / Android — written to the app cache and passed to the OS share sheet,
 * which is the only way to get a file into Files / Drive / a mail draft.
 */
export async function deliverFile(blob: Blob, fileName: string): Promise<DeliverResult> {
  try {
    if (isNative()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      await Filesystem.writeFile({
        path: fileName,
        directory: Directory.Cache,
        data: await blobToBase64(blob),
        recursive: true,
      });
      const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      await Share.share({ title: fileName, url: uri });
      return { status: 'shared' };
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { status: 'downloaded' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/abort|cancel/i.test(message)) return { status: 'failed', message: '共有を中止しました' };
    return { status: 'failed', message };
  }
}

/** Whether the "共有" affordance is worth showing next to a download. */
export function canShareExports(): boolean {
  return isNative() || canShareFiles();
}
