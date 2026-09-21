/** Blob ⇄ base64 helpers (the Capacitor Filesystem API speaks base64). */

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.onload = () => {
      const result = String(reader.result);
      // strip the "data:*/*;base64," prefix
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
