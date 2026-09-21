import { useCallback, useEffect, useRef, useState } from 'react';
import { hasCameraApi } from '../platform/env';
import { encodeFrame, type EncodedPhoto } from './imageUtil';

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'unavailable' | 'error';
export type Facing = 'environment' | 'user';

export interface CameraController {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
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
export function useCamera(): CameraController {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [message, setMessage] = useState('');
  const [canSwitch, setCanSwitch] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // iOS refuses to play an inline video without these attributes.
          video.setAttribute('playsinline', 'true');
          video.muted = true;
          try {
            await video.play();
          } catch {
            /* Autoplay can be rejected while backgrounded; the element still renders. */
          }
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
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, attempt, stop]);

  const switchFacing = useCallback(() => {
    stop();
    setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
  }, [stop]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

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

  return { videoRef, status, message, facing, canSwitch, switchFacing, retry, capture };
}
