import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMenu } from '../ui/menuContext';
import { useCamera } from '../capture/useCamera';
import { encodeImageFile, type EncodedPhoto } from '../capture/imageUtil';
import { setPendingCapture } from '../capture/pendingCapture';

/**
 * Home screen. Launching Picta means the viewfinder is already live — there is
 * no dashboard in front of it.
 */
export default function CameraScreen() {
  const openMenu = useMenu();
  const navigate = useNavigate();
  const camera = useCamera();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Brief confirmation after returning from a save, then back to a clean
  // viewfinder — the toast must not survive a reload or a back navigation.
  useEffect(() => {
    if ((location.state as { saved?: boolean } | null)?.saved !== true) return;
    setSavedToast(true);
    navigate('/', { replace: true, state: null });
    const timer = window.setTimeout(() => setSavedToast(false), 2000);
    return () => window.clearTimeout(timer);
  }, [location.state, navigate]);

  const goToReview = useCallback(
    (photo: EncodedPhoto, capturedAt: number) => {
      setPendingCapture({
        blob: photo.blob,
        mimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        capturedAt,
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
      goToReview(await camera.capture(), capturedAt);
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
        const capturedAt = file instanceof File && file.lastModified ? file.lastModified : Date.now();
        goToReview(await encodeImageFile(file), capturedAt);
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
    <div className="screen">
      <div className="camera">
        <video
          ref={camera.videoRef}
          className={camera.facing === 'user' ? 'mirrored' : undefined}
          playsInline
          muted
          autoPlay
          aria-label="カメラ映像"
          style={{ display: camera.status === 'ready' ? 'block' : 'none' }}
        />

        {flash ? <div className="flash" aria-hidden="true" /> : null}

        <div className="camera-top">
          <button className="camera-round" onClick={openMenu} aria-label="メニューを開く">
            ☰
          </button>
          {camera.canSwitch && camera.status === 'ready' ? (
            <button
              className="camera-round"
              onClick={camera.switchFacing}
              aria-label="カメラを切り替え"
            >
              ⇆
            </button>
          ) : null}
        </div>

        {camera.status === 'starting' ? (
          <div className="camera-message">
            <span>カメラを起動しています…</span>
          </div>
        ) : null}

        {blocked ? (
          <div className="camera-message">
            <strong>カメラを使えません</strong>
            <span>{camera.message}</span>
            <div className="button-row" style={{ width: '100%', maxWidth: 320 }}>
              <button className="button" onClick={camera.retry}>
                再試行
              </button>
              <button className="button primary" onClick={() => fileInputRef.current?.click()}>
                写真を選ぶ
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="camera-message" role="alert" style={{ justifyContent: 'flex-start', paddingTop: 96 }}>
            <span>{error}</span>
          </div>
        ) : null}

        {savedToast ? (
          <div className="toast" role="status">
            保存しました
          </div>
        ) : null}

        {live ? (
          <div className="camera-bottom">
            <button
              className="shutter"
              onClick={onShutter}
              aria-label="撮影"
              disabled={camera.status !== 'ready' || busy}
            />
          </div>
        ) : null}

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
    </div>
  );
}
