import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Record } from '../types';
import ScreenHeader from '../ui/ScreenHeader';
import RecordList from '../ui/RecordList';
import { useMenu } from '../ui/menuContext';
import { listRecords, listRecordsByTag } from '../db/records';

/** 過去の記録。`/tags/:name` からはそのタグの記録だけを表示する。 */
export default function RecordsScreen() {
  const openMenu = useMenu();
  const { name } = useParams();
  const [records, setRecords] = useState<Record[] | null>(null);
  const [error, setError] = useState('');

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

  return (
    <div className="screen">
      <ScreenHeader title={name ? `#${name}` : '過去の記録'} back={!!name} onMenu={openMenu} />
      <div className="screen-body">
        {error ? <div className="error-banner">{error}</div> : null}
        {records === null ? (
          <div className="spinner-line">読み込み中…</div>
        ) : (
          <RecordList
            records={records}
            emptyMessage={name ? 'このタグの記録はまだありません' : 'まだ記録がありません'}
          />
        )}
      </div>
    </div>
  );
}
