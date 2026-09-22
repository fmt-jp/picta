import { useCallback, useEffect, useRef, useState } from 'react';
import { hasCameraApi } from '../platform/env';
import { encodeFrame, type EncodedPhoto } from './imageUtil';

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'unavailable' | 'error';
export type Facing = 'environment' | 'user';

export interface CameraController {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  /**
   * The stream exists but no frames are arriving (the OS interrupted the
   * camera, or the page was resumed). The last decoded frame is still painted
   * in the element, so the UI must not present it as a live view.
   */
  stalled: boolean;
  message: string;
  facing: Facing;
  canSwitch: boolean;
  switchFacing: () => void;
  retry: () => void;
  capture: () => Promise<EncodedPhoto>;
}

/**
 * Live viewfinder backed by getUserMedia.
 *
 * The camera permission is requested here — i.e. the first time the user
 * actually opens the camera — never in a start-up permission sweep.
 */
/** play() returns a promise in modern browsers, but not everywhere. */
function safePlay(video: HTMLVideoElement | null | undefined): void {
  try {
    const played = video?.play();
    if (played && typeof played.catch === 'function') played.catch(() => {});
  } catch {
    /* Autoplay can be rejected while backgrounded; the element still renders. */
  }
}

export function useCamera(): CameraController {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [message, setMessage] = useState('');
  const [canSwitch, setCanSwitch] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [stalled, setStalled] = useState(false);
  /** True while getUserMedia is in flight, so resume checks do not pile up. */
  const acquiringRef = useRef(false);
  const statusRef = useRef<CameraStatus>('starting');
  statusRef.current = status;
  const watchdogRef = useRef<number | null>(null);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  /** A track that has ended or gone silent is not showing anything live. */
  const isStreamLive = useCallback(() => {
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    return tracks.length > 0 && tracks.every((t) => t.readyState === 'live' && !t.muted);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!hasCameraApi()) {
      setStatus('unavailable');
      setMessage(
        window.isSecureContext
          ? 'この環境ではカメラを利用できません。'
          : 'カメラはHTTPS（またはlocalhost）でのみ利用できます。',
      );
      return;
    }

    let cancelled = false;
    setStatus('starting');
    setMessage('');
    acquiringRef.current = true;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            // Ask for the usual 4:3 sensor output rather than a square: the
            // square crop is taken from the short edge, and 4:3 leaves more
            // pixels there than 16:9 does.
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setStalled(false);

        // The OS can take the camera away at any time (a call, another app,
        // the screen locking). Without these the element would keep painting
        // its last frame and look like a working viewfinder.
        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', () => {
            setStalled(true);
            if (document.visibilityState === 'visible') restart();
          });
          track.addEventListener('mute', () => setStalled(true));
          track.addEventListener('unmute', () => {
            setStalled(false);
            safePlay(videoRef.current);
          });
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // iOS refuses to play an inline video without these attributes.
          video.setAttribute('playsinline', 'true');
          video.muted = true;
          safePlay(video);
        }
        setStatus('ready');

        // Only meaningful once permission has been granted: before that the
        // device list is anonymised and often empty.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) {
            setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
          }
        } catch {
          /* enumerateDevices is optional. */
        }
      } catch (err) {
        if (cancelled) return;
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied');
          setMessage('カメラの使用が許可されていません。端末の設定から許可してください。');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('unavailable');
          setMessage('利用できるカメラが見つかりませんでした。');
        } else {
          setStatus('error');
          setMessage('カメラを起動できませんでした。');
        }
      } finally {
        acquiringRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      acquiringRef.current = false;
      stop();
    };
  }, [facing, attempt, restart, stop]);

  /**
   * Bring the viewfinder back when the app is resumed.
   *
   * Reopening an installed PWA usually restores the existing page rather than
   * loading it again, and iOS/Android will have shut the capture session down
   * by then. Nothing re-requests it on its own, so the camera screen would sit
   * there showing the frame it last decoded.
   */
  useEffect(() => {
    const ensureLive = () => {
      if (document.visibilityState !== 'visible') return;
      if (acquiringRef.current) return;
      if (statusRef.current === 'denied' || statusRef.current === 'unavailable') return;

      if (!isStreamLive()) {
        setStalled(true);
        restart();
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      if (video.paused) safePlay(video);

      // Some platforms freeze the stream without ending or muting the track.
      // If the picture has not moved a moment later, take it as frozen.
      if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
      const before = video.currentTime;
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        const current = videoRef.current;
        if (!current || acquiringRef.current) return;
        if (document.visibilityState !== 'visible') return;
        if (current.currentTime === before) {
          setStalled(true);
          restart();
        }
      }, 800);
    };

    document.addEventListener('visibilitychange', ensureLive);
    // pageshow fires on a back/forward-cache restore, which is how an
    // installed PWA usually comes back.
    window.addEventListener('pageshow', ensureLive);
    window.addEventListener('focus', ensureLive);
    return () => {
      document.removeEventListener('visibilitychange', ensureLive);
      window.removeEventListener('pageshow', ensureLive);
      window.removeEventListener('focus', ensureLive);
      if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
    };
  }, [isStreamLive, restart]);

  const switchFacing = useCallback(() => {
    stop();
    setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
  }, [stop]);

  const retry = restart;

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      throw new Error('カメラの準備ができていません');
    }
    // Square, and mirrored for the front camera: exactly the frame the
    // viewfinder was showing.
    return encodeFrame(video, video.videoWidth, video.videoHeight, {
      mirror: facing === 'user',
    });
  }, [facing]);

  return { videoRef, status, stalled, message, facing, canSwitch, switchFacing, retry, capture };
}
