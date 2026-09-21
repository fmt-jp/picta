/**
 * Runtime capability detection.
 *
 * Torikoto ships one web build that also runs inside the Capacitor WebView on iOS
 * and Android, so every platform-specific decision is made here at runtime
 * instead of at build time.
 */

export type PlatformName = 'web' | 'ios' | 'android';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
}

function cap(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return cap()?.isNativePlatform?.() === true;
}

export function platformName(): PlatformName {
  const name = cap()?.getPlatform?.();
  if (name === 'ios' || name === 'android') return name;
  return 'web';
}

/** True when a Capacitor plugin is actually installed in the native shell. */
export function hasNativePlugin(name: string): boolean {
  return cap()?.isPluginAvailable?.(name) === true;
}

/** getUserMedia needs a secure context (https, localhost, or the native WebView). */
export function hasCameraApi(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    (window.isSecureContext || isNative())
  );
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return iOS && !isNative();
}
