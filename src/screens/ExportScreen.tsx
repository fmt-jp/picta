import { useCallback, useEffect, useState } from 'react';
import ScreenHeader from '../ui/ScreenHeader';
import { useMenu } from '../ui/menuContext';
import { listRecords } from '../db/records';
import { buildCsv, exportBaseName, uniquePhotoFileNames } from '../export/csv';
import { buildExportZip, type ZipProgress } from '../export/zip';
import { deliverFile } from '../export/deliver';
import { formatBytes } from '../format';

export default function ExportScreen() {
  const openMenu = useMenu();
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'csv' | 'zip' | null>(null);
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void listRecords().then((records) => {
      if (active) setCount(records.length);
    });
    return () => {
      active = false;
    };
  }, []);

  const report = useCallback((status: string, fileName: string, size: number) => {
    setNotice(
      status === 'shared'
        ? `${fileName} を共有しました（${formatBytes(size)}）`
        : `${fileName} を保存しました（${formatBytes(size)}）`,
    );
  }, []);

  const exportCsv = useCallback(async () => {
    setBusy('csv');
    setError('');
    setNotice('');
    try {
      const rows = uniquePhotoFileNames(await listRecords());
      const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const fileName = `${exportBaseName()}.csv`;
      const result = await deliverFile(blob, fileName);
      if (result.status === 'failed') setError(result.message || 'エクスポートに失敗しました');
      else report(result.status, fileName, blob.size);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エクスポートに失敗しました');
    } finally {
      setBusy(null);
    }
  }, [report]);

  const exportZip = useCallback(async () => {
    setBusy('zip');
    setError('');
    setNotice('');
    setProgress(null);
    try {
      const rows = uniquePhotoFileNames(await listRecords());
      const blob = await buildExportZip(rows, setProgress);
      const fileName = `${exportBaseName()}.zip`;
      const result = await deliverFile(blob, fileName);
      if (result.status === 'failed') setError(result.message || 'エクスポートに失敗しました');
      else report(result.status, fileName, blob.size);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エクスポートに失敗しました');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [report]);

  const empty = count === 0;

  return (
    <div className="screen">
      <ScreenHeader title="エクスポート" onMenu={openMenu} />
      <div className="screen-body">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="notice" role="status">
            {notice}
          </div>
        ) : null}

        <p className="hint" style={{ marginTop: 0, marginBottom: 20 }}>
          {count === null ? '集計中…' : `記録 ${count}件`}
        </p>

        <section className="section">
          <h2 className="field-label">CSV</h2>
          <div className="card">
            <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-dim)' }}>
              記録情報だけを表形式で書き出します。写真は含まれません。
            </p>
            <button
              className="button block"
              onClick={() => void exportCsv()}
              disabled={busy !== null || empty}
            >
              {busy === 'csv' ? '書き出し中…' : 'CSVを書き出す'}
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="field-label">写真付きZIP（バックアップ）</h2>
          <div className="card">
            <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-dim)' }}>
              写真・メモ・タグ・撮影日時をまとめて書き出します。
              将来のトリコトに読み込んで復元できる形式です。
            </p>
            <button
              className="button primary block"
              onClick={() => void exportZip()}
              disabled={busy !== null || empty}
            >
              {busy === 'zip'
                ? progress
                  ? `書き出し中… ${progress.done}/${progress.total}`
                  : '準備中…'
                : 'ZIPを書き出す'}
            </button>
          </div>
        </section>

        {empty ? <div className="empty">書き出す記録がありません</div> : null}
      </div>
    </div>
  );
}
