import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMenu } from '../ui/menuContext';
import { useCamera } from '../capture/useCamera';
import { encodeImageFile, type EncodedPhoto } from '../capture/imageUtil';
import { setPendingCapture } from '../capture/pendingCapture';
import { requestLocation } from '../capture/geolocation';
import { readExif } from '../capture/exif';
import { loadSettings } from '../settings';
import AppMark from '../ui/AppMark';
import type { GeoPoint } from '../types';

/**
 * Home screen. Launching Torikoto means the viewfinder is already live — there is
 * no dashboard in front of it.
 */
export default function CameraScreen() {
  const openMenu = useMenu();
  const navigate = useNavigate();
  const camera = useCamera();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [savedToast, setSavedToast] = useState('');
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Brief confirmation after returning from a save, then back to a clean
  // viewfinder — the toast must not survive a reload or a back navigation.
  useEffect(() => {
    const state = location.state as { saved?: boolean; toast?: string } | null;
    if (state?.saved !== true) return;
    setSavedToast(state.toast || '保存しました');
    navigate('/', { replace: true, state: null });
    const timer = window.setTimeout(() => setSavedToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [location.state, navigate]);

  const goToReview = useCallback(
    (photo: EncodedPhoto, capturedAt: number, locationFix?: Promise<GeoPoint | null>) => {
      setPendingCapture({
        blob: photo.blob,
        mimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        capturedAt,
        locationFix,
        previewUrl: URL.createObjectURL(photo.blob),
      });
      navigate('/review');
    },
    [navigate],
  );

  const onShutter = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setFlash(true);
    window.setTimeout(() => setFlash(false), 280);
    try {
      const capturedAt = Date.now();
      // Kick the fix off with the shutter and carry the promise to the review
      // screen: writing a memo usually takes longer than getting a position.
      const locationFix = loadSettings().recordLocation ? requestLocation() : undefined;
      goToReview(await camera.capture(), capturedAt, locationFix);
    } catch (err) {
      setError(err instanceof Error ? err.message : '撮影に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [busy, camera, goToReview]);

  const onPickFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setBusy(true);
      setError('');
      try {
        // A file from the OS camera or the library does carry EXIF — prefer its
        // own timestamp and position over the file's mtime and a fresh fix.
        const exif = await readExif(file);
        const fallback = file instanceof File && file.lastModified ? file.lastModified : Date.now();
        const capturedAt = exif.capturedAt ?? fallback;
        const locationFix = exif.location
          ? Promise.resolve(exif.location)
          : loadSettings().recordLocation
            ? requestLocation()
            : undefined;
        goToReview(await encodeImageFile(file), capturedAt, locationFix);
      } catch (err) {
        setError(err instanceof Error ? err.message : '画像を読み込めませんでした');
      } finally {
        setBusy(false);
      }
    },
    [goToReview],
  );

  const live = camera.status === 'ready' || camera.status === 'starting';
  const blocked = camera.status === 'denied' || camera.status === 'unavailable' || camera.status === 'error';

  return (
    <div className="screen camera-screen">
      <header className="camera-header">
        <button className="camera-round" onClick={openMenu} aria-label="メニューを開く">
          ☰
        </button>
        <span className="camera-wordmark">
          <AppMark />
          トリコト
        </span>
        {camera.canSwitch && camera.status === 'ready' ? (
          <button
            className="camera-round"
            onClick={camera.switchFacing}
            aria-label="カメラを切り替え"
          >
            ⇆
          </button>
        ) : (
          <span className="camera-round placeholder" aria-hidden="true" />
        )}
      </header>

      <div className="camera-stage">
        {/* Square viewfinder: the saved photo is exactly this 1:1 frame. */}
        <div className="camera-frame">
          <video
            ref={camera.videoRef}
            className={camera.facing === 'user' ? 'mirrored' : undefined}
            playsInline
            muted
            autoPlay
            aria-label="カメラ映像"
            style={{ display: camera.status === 'ready' ? 'block' : 'none' }}
          />

          {/* Rule-of-thirds guides, only over a live picture. */}
          {camera.status === 'ready' ? <div className="camera-grid" aria-hidden="true" /> : null}

          {flash ? <div className="flash" aria-hidden="true" /> : null}

          {camera.status === 'starting' ? (
            <div className="camera-message">
              <span>カメラを起動しています…</span>
            </div>
          ) : null}

          {blocked ? (
            <div className="camera-message">
              <strong>カメラを使えません</strong>
              <span>{camera.message}</span>
              <div className="button-row" style={{ width: '100%', maxWidth: 300 }}>
                <button className="button" onClick={camera.retry}>
                  再試行
                </button>
                <button className="button primary" onClick={() => fileInputRef.current?.click()}>
                  写真を選ぶ
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="camera-error" role="alert">
            {error}
          </p>
        ) : null}

        {savedToast ? (
          <div className="toast" role="status">
            {savedToast}
          </div>
        ) : null}
      </div>

      <div className="camera-bottom">
        {live ? (
          <button
            className="shutter"
            onClick={onShutter}
            aria-label="撮影"
            disabled={camera.status !== 'ready' || busy}
          />
        ) : null}
      </div>

      {/* Fallback for browsers without getUserMedia (some iOS PWA contexts)
          and for insecure origins: the OS camera / picker still works. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="写真を選ぶ"
        onChange={onPickFile}
      />
    </div>
  );
}
