import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Record } from '../types';
import ScreenHeader from '../ui/ScreenHeader';
import ChoiceDialog from '../ui/ChoiceDialog';
import { formatDateTime } from '../format';
import { deleteRecord, getRecord } from '../db/records';
import { loadPhotoBlob } from '../db/photoStore';
import { invalidatePhotoUrl, usePhotoUrl } from '../db/usePhotoUrl';
import {
  canDeleteFromLibrary,
  libraryDeleteLimitation,
  photoLibraryMode,
  savePhotoToLibrary,
} from '../platform/photoLibrary';
import { formatCoordinates, mapUrl } from '../capture/geolocation';

export default function RecordDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<Record | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState('');
  const photoUrl = usePhotoUrl(record?.photoId);
  // Kept in state so the share sheet can be opened straight from the tap —
  // iOS drops the user activation if a file has to be read first.
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void getRecord(id).then((found) => {
      if (active) setRecord(found ?? null);
    });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!record) return;
    let active = true;
    void loadPhotoBlob(record.photoId).then((blob) => {
      if (active) setPhotoBlob(blob);
    });
    return () => {
      active = false;
    };
  }, [record]);

  const onDelete = useCallback(
    async (alsoFromLibrary: boolean) => {
      if (!record) return;
      const outcome = await deleteRecord(record.id, { alsoFromLibrary });
      invalidatePhotoUrl(record.photoId);
      navigate('/records', {
        replace: true,
        state: alsoFromLibrary && outcome.libraryFailed > 0 ? { libraryFailed: true } : null,
      });
    },
    [navigate, record],
  );

  const onSaveToDevice = useCallback(async () => {
    if (!record || !photoBlob) return;
    const result = await savePhotoToLibrary(photoBlob, record.photoFileName, {
      viaShare: photoLibraryMode() !== 'native',
    });
    const messages: { [K in typeof result.status]: string } = {
      saved: '端末に保存しました',
      shared: '共有しました',
      downloaded: '端末にダウンロードしました',
      denied: '保存が許可されていません',
      unsupported: 'この環境では保存できません',
      failed: result.message || '保存に失敗しました',
    };
    setNotice(messages[result.status]);
  }, [photoBlob, record]);

  if (record === undefined) {
    return (
      <div className="screen">
        <ScreenHeader title="記録" back />
        <div className="spinner-line">読み込み中…</div>
      </div>
    );
  }

  if (record === null) {
    return (
      <div className="screen">
        <ScreenHeader title="記録" back />
        <div className="empty">記録が見つかりません</div>
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="記録"
        back
        actions={
          <Link className="icon-button" to={`/records/${record.id}/edit`}>
            編集
          </Link>
        }
      />

      <div className="screen-body">
        {notice ? <div className="notice">{notice}</div> : null}

        <div className="photo-frame section">
          {photoUrl ? <img src={photoUrl} alt={record.memo || '記録した写真'} /> : null}
        </div>

        <dl className="dl section">
          <dt>撮影日時</dt>
          <dd>{formatDateTime(record.capturedAt)}</dd>

          <dt>場所</dt>
          <dd>
            {record.location ? (
              <>
                {formatCoordinates(record.location)}
                {record.location.accuracy ? `（誤差 約${record.location.accuracy}m）` : ''}
                {' '}
                <a
                  className="geo-link"
                  href={mapUrl(record.location)}
                  target="_blank"
                  rel="noreferrer"
                >
                  地図で開く
                </a>
              </>
            ) : (
              <span style={{ color: 'var(--text-faint)' }}>記録なし</span>
            )}
          </dd>

          <dt>メモ</dt>
          <dd style={record.memo ? undefined : { color: 'var(--text-faint)' }}>
            {record.memo || 'メモなし'}
          </dd>

          <dt>タグ</dt>
          <dd>
            {record.tags.length ? (
              <div className="tag-list" style={{ marginTop: 6 }}>
                {record.tags.map((tag) => (
                  <Link className="tag-chip" to={`/tags/${encodeURIComponent(tag)}`} key={tag}>
                    #{tag}
                  </Link>
                ))}
              </div>
            ) : (
              <span style={{ color: 'var(--text-faint)' }}>タグなし</span>
            )}
          </dd>
        </dl>

        <div className="section">
          <button
            className="button block"
            onClick={() => void onSaveToDevice()}
            disabled={!photoBlob}
          >
            端末に保存
          </button>
        </div>

        <button className="button danger block" onClick={() => setConfirmDelete(true)}>
          この記録を削除
        </button>
      </div>

      {confirmDelete ? (
        <ChoiceDialog
          title="この記録を削除しますか？"
          choices={[
            {
              label: 'アプリ内から削除',
              description: '端末に保存した写真はそのまま残ります',
              danger: true,
              onSelect: () => void onDelete(false),
            },
            {
              label: 'アプリ内と端末の写真を削除',
              description:
                libraryDeleteLimitation() ??
                '端末のフォトライブラリに保存した写真も削除します。元に戻せません',
              danger: true,
              disabled: !canDeleteFromLibrary(),
              onSelect: () => void onDelete(true),
            },
          ]}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
