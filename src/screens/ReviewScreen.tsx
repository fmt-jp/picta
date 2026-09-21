import { useCallback, useEffect, useState } from 'react';
import type { GeoPoint } from '../types';
import { useNavigate } from 'react-router-dom';
import ScreenHeader from '../ui/ScreenHeader';
import ConfirmDialog from '../ui/ConfirmDialog';
import TagPicker from '../ui/TagPicker';
import { formatDateTime } from '../format';
import { useSpeechInput } from '../capture/useSpeech';
import { clearPendingCapture, getPendingCapture } from '../capture/pendingCapture';
import { createRecord } from '../db/records';
import { awaitLocation, formatCoordinates } from '../capture/geolocation';
import { withExif } from '../capture/exif';
import { savePhotoToLibrary } from '../platform/photoLibrary';
import { loadSettings } from '../settings';

/**
 * 撮影 → 一言 → 保存.
 * Memo and tags are both optional: the save button is always enabled.
 */
export default function ReviewScreen() {
  const navigate = useNavigate();
  const [capture] = useState(() => getPendingCapture());
  const [memo, setMemo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(() => !!capture?.locationFix);
  const [attachLocation, setAttachLocation] = useState(true);

  const appendSpeech = useCallback((text: string) => {
    setMemo((current) => (current ? `${current.replace(/\s+$/, '')} ${text}` : text));
  }, []);
  const speech = useSpeechInput(appendSpeech);

  // The fix was started with the shutter; show it as soon as it lands.
  useEffect(() => {
    const fix = capture?.locationFix;
    if (!fix) return;
    let active = true;
    void fix.then((point) => {
      if (!active) return;
      setLocation(point);
      setLocating(false);
    });
    return () => {
      active = false;
    };
  }, [capture]);

  // A reload drops the in-memory draft — go back to the viewfinder.
  useEffect(() => {
    if (!capture) navigate('/', { replace: true });
  }, [capture, navigate]);

  if (!capture) return null;

  const dirty = memo.trim().length > 0 || tags.length > 0;

  const discard = () => {
    speech.stop();
    clearPendingCapture();
    navigate('/', { replace: true });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    speech.stop();
    try {
      // Give a fix that is still in flight a moment to land, but never hold up
      // the save for it.
      const point = attachLocation
        ? (location ?? (await awaitLocation(capture.locationFix, 2000)))
        : null;

      // A canvas capture carries no metadata, so the date and place are written
      // into the JPEG here — that is what the photo library copy and every
      // exported photo will carry.
      const blob = await withExif(capture.blob, {
        capturedAt: capture.capturedAt,
        location: point,
      });

      const record = await createRecord({
        photo: {
          blob,
          mimeType: capture.mimeType,
          width: capture.width,
          height: capture.height,
        },
        memo,
        tags,
        capturedAt: capture.capturedAt,
        location: point,
      });

      // The device copy is a bonus, never a reason to lose the record: the
      // record is already stored by the time this runs, and a failure here is
      // reported but not thrown.
      let toast = '保存しました';
      if (loadSettings().savePhotosToLibrary) {
        const result = await savePhotoToLibrary(blob, record.photoFileName);
        if (result.status === 'denied' || result.status === 'failed') {
          toast = '保存しました（端末への保存は失敗）';
        }
      }

      clearPendingCapture();
      navigate('/', { replace: true, state: { saved: true, toast } });
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <ScreenHeader
        title="記録する"
        actions={
          <button
            className="icon-button"
            onClick={() => (dirty ? setConfirmDiscard(true) : discard())}
          >
            破棄
          </button>
        }
      />

      <div className="screen-body">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <div className="photo-frame">
          <img src={capture.previewUrl} alt="撮影した写真" />
        </div>

        <div className="meta-row section">
          <span className="meta-item">🕘 {formatDateTime(capture.capturedAt)}</span>
          {locating ? (
            <span className="meta-item">📍 位置情報を取得中…</span>
          ) : location ? (
            <button
              type="button"
              className={attachLocation ? 'meta-toggle on' : 'meta-toggle'}
              aria-pressed={attachLocation}
              onClick={() => setAttachLocation((on) => !on)}
              title={formatCoordinates(location)}
            >
              📍 {attachLocation ? '位置情報を記録' : '位置情報を記録しない'}
            </button>
          ) : null}
        </div>

        <div className="section">
          <label className="field-label" htmlFor="memo">
            メモ（任意）
          </label>
          <div className="memo-row">
            <textarea
              id="memo"
              className="textarea"
              value={speech.interim ? `${memo}${memo ? ' ' : ''}${speech.interim}` : memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="一言残す"
              readOnly={speech.listening}
            />
            {speech.supported ? (
              <button
                type="button"
                className={speech.listening ? 'mic-button recording' : 'mic-button'}
                onClick={speech.toggle}
                aria-label={speech.listening ? '音声入力を停止' : '音声入力を開始'}
                aria-pressed={speech.listening}
              >
                🎤
              </button>
            ) : null}
          </div>
          {speech.listening ? <p className="hint">聞き取り中…</p> : null}
          {speech.error ? <p className="hint">{speech.error}</p> : null}
          {!speech.supported ? (
            <p className="hint">この環境では音声入力を利用できません。</p>
          ) : null}
        </div>

        <div className="section">
          <span className="field-label">タグ（任意）</span>
          <TagPicker selected={tags} onChange={setTags} />
        </div>
      </div>

      <div className="save-bar">
        <button className="button primary block" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {confirmDiscard ? (
        <ConfirmDialog
          title="この写真を破棄しますか？"
          message="メモとタグは保存されません。"
          confirmLabel="破棄する"
          danger
          onConfirm={discard}
          onCancel={() => setConfirmDiscard(false)}
        />
      ) : null}
    </div>
  );
}
