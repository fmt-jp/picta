import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Record } from '../types';
import ScreenHeader from '../ui/ScreenHeader';
import TagPicker from '../ui/TagPicker';
import { useSpeechInput } from '../capture/useSpeech';
import { getRecord, updateRecord } from '../db/records';
import { usePhotoUrl } from '../db/usePhotoUrl';
import { formatDateTime } from '../format';

/** メモとタグだけを編集する。写真そのものは編集しない（仕様§13）。 */
export default function RecordEditScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<Record | null | undefined>(undefined);
  const [memo, setMemo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const photoUrl = usePhotoUrl(record?.photoId);

  const appendSpeech = useCallback((text: string) => {
    setMemo((current) => (current ? `${current.replace(/\s+$/, '')} ${text}` : text));
  }, []);
  const speech = useSpeechInput(appendSpeech);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void getRecord(id).then((found) => {
      if (!active) return;
      setRecord(found ?? null);
      setMemo(found?.memo ?? '');
      setTags(found?.tags ?? []);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const save = async () => {
    if (!record || saving) return;
    setSaving(true);
    setError('');
    speech.stop();
    try {
      await updateRecord(record.id, { memo, tags });
      navigate(`/records/${record.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
      setSaving(false);
    }
  };

  if (record === undefined) {
    return (
      <div className="screen">
        <ScreenHeader title="編集" back />
        <div className="spinner-line">読み込み中…</div>
      </div>
    );
  }

  if (record === null) {
    return (
      <div className="screen">
        <ScreenHeader title="編集" back />
        <div className="empty">記録が見つかりません</div>
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHeader title="編集" back />

      <div className="screen-body">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <div className="photo-frame section">
          {photoUrl ? <img src={photoUrl} alt="" /> : null}
        </div>
        <p className="hint" style={{ marginTop: -14, marginBottom: 18 }}>
          {formatDateTime(record.capturedAt)}
        </p>

        <div className="section">
          <label className="field-label" htmlFor="memo">
            メモ
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
          {memo ? (
            <button
              type="button"
              className="button"
              style={{ marginTop: 10 }}
              onClick={() => setMemo('')}
            >
              メモを削除
            </button>
          ) : null}
        </div>

        <div className="section">
          <span className="field-label">タグ</span>
          <TagPicker selected={tags} onChange={setTags} />
        </div>
      </div>

      <div className="save-bar">
        <button className="button primary block" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
