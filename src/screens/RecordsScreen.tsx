import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Record } from '../types';
import ScreenHeader from '../ui/ScreenHeader';
import RecordList from '../ui/RecordList';
import ChoiceDialog from '../ui/ChoiceDialog';
import { useMenu } from '../ui/menuContext';
import { clearMemos, deleteRecords, listRecords, listRecordsByTag } from '../db/records';
import { invalidatePhotoUrl } from '../db/usePhotoUrl';

/** 過去の記録。`/tags/:name` からはそのタグの記録だけを表示する。 */
export default function RecordsScreen() {
  const openMenu = useMenu();
  const { name } = useParams();
  const [records, setRecords] = useState<Record[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRecords(name ? await listRecordsByTag(name) : await listRecords());
    } catch {
      setError('記録を読み込めませんでした');
      setRecords([]);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setConfirming(false);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedRecords = useMemo(
    () => (records ?? []).filter((record) => selected.has(record.id)),
    [records, selected],
  );

  /** Deleting the memo only leaves records that never had one untouched. */
  const withMemo = selectedRecords.filter((record) => record.memo).length;

  const run = useCallback(
    async (action: 'memo' | 'record') => {
      if (busy) return;
      setBusy(true);
      setError('');
      const ids = selectedRecords.map((record) => record.id);
      try {
        if (action === 'record') {
          // Drop the cached object URLs first: those photos are about to go.
          for (const record of selectedRecords) invalidatePhotoUrl(record.photoId);
          const removed = await deleteRecords(ids);
          setNotice(`${removed}件の記録を削除しました`);
        } else {
          const cleared = await clearMemos(ids);
          setNotice(`${cleared}件のメモを削除しました`);
        }
        exitSelection();
        await load();
      } catch {
        setError('削除に失敗しました');
        setConfirming(false);
      } finally {
        setBusy(false);
      }
    },
    [busy, exitSelection, load, selectedRecords],
  );

  const count = selected.size;
  const title = selecting ? `${count}件を選択` : name ? `#${name}` : '過去の記録';

  return (
    <div className="screen">
      <ScreenHeader
        title={title}
        back={!!name && !selecting}
        onMenu={selecting ? undefined : openMenu}
        actions={
          records && records.length > 0 ? (
            <button className="icon-button" onClick={selecting ? exitSelection : () => setSelecting(true)}>
              {selecting ? 'やめる' : '選択'}
            </button>
          ) : null
        }
      />

      <div className="screen-body">
        {error ? <div className="error-banner">{error}</div> : null}
        {notice && !selecting ? (
          <div className="notice" role="status">
            {notice}
          </div>
        ) : null}

        {records === null ? (
          <div className="spinner-line">読み込み中…</div>
        ) : (
          <RecordList
            records={records}
            emptyMessage={name ? 'このタグの記録はまだありません' : 'まだ記録がありません'}
            selectable={selecting}
            selectedIds={selected}
            onToggle={toggle}
          />
        )}
      </div>

      {selecting ? (
        <div className="save-bar">
          <button
            className="button danger block"
            disabled={count === 0 || busy}
            onClick={() => setConfirming(true)}
          >
            {count === 0 ? '削除する記録を選んでください' : `${count}件を削除`}
          </button>
        </div>
      ) : null}

      {confirming ? (
        <ChoiceDialog
          title={`${count}件をどう削除しますか？`}
          message="端末のフォトライブラリに保存した写真は削除されません。"
          choices={[
            {
              label: 'メモだけ削除',
              description:
                withMemo === 0
                  ? '選んだ記録にメモはありません'
                  : `写真とタグは残ります（メモがあるのは${withMemo}件）`,
              onSelect: () => void run('memo'),
            },
            {
              label: 'メモと写真を削除',
              description: '記録ごと削除します。元に戻せません',
              danger: true,
              onSelect: () => void run('record'),
            },
          ]}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
