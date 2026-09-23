import { useCallback, useEffect, useRef, useState } from 'react';
import ScreenHeader from '../ui/ScreenHeader';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useMenu } from '../ui/menuContext';
import { listRecords } from '../db/records';
import { buildCsv, exportBaseName, uniquePhotoFileNames } from '../export/csv';
import { buildExportZip, type ZipProgress } from '../export/zip';
import { deliverFile } from '../export/deliver';
import { importExportZip, inspectExportZip, type ImportSummary } from '../export/importZip';
import { formatBytes } from '../format';

export default function ExportScreen() {
  const openMenu = useMenu();
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'csv' | 'zip' | null>(null);
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; summary: ImportSummary } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

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

  /** Read the archive first and show what it holds before touching anything. */
  const onPickZip = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    try {
      const summary = await inspectExportZip(file);
      if (summary.total === 0) {
        setError('読み込める記録が見つかりませんでした。写真付きZIPを選んでください。');
        return;
      }
      setPending({ file, summary });
    } catch {
      setError('ZIPを読み込めませんでした。');
    }
  }, []);

  const runImport = useCallback(async () => {
    if (!pending) return;
    const { file } = pending;
    setPending(null);
    setImporting(true);
    setImportProgress(null);
    try {
      const summary = await importExportZip(file, setImportProgress);
      const parts = [`${summary.imported}件を読み込みました`];
      if (summary.skipped > 0) parts.push(`${summary.skipped}件は既存のため飛ばしました`);
      if (summary.failed > 0) parts.push(`${summary.failed}件は読み込めませんでした`);
      setNotice(parts.join('／'));
      setCount(await listRecords().then((records) => records.length));
    } catch {
      setError('インポートに失敗しました。');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }, [pending]);

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

        <section className="section">
          <h2 className="field-label">インポート（復元）</h2>
          <div className="card">
            <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-dim)' }}>
              書き出した写真付きZIPを読み込みます。すでにある記録は上書きせず飛ばします。
            </p>
            <button
              className="button block"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== null || importing}
            >
              {importing
                ? importProgress
                  ? `読み込み中… ${importProgress.done}/${importProgress.total}`
                  : '読み込み中…'
                : 'ZIPを読み込む'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              aria-label="読み込むZIPファイル"
              onChange={(e) => void onPickZip(e)}
            />
          </div>
        </section>

        {empty ? <div className="empty">書き出す記録がありません</div> : null}
      </div>

      {pending ? (
        <ConfirmDialog
          title={`${pending.summary.total}件を読み込みますか？`}
          message={[
            `形式: ${pending.summary.format} (version ${pending.summary.version})`,
            'すでにある記録は上書きせず飛ばします。',
            ...pending.summary.notes,
          ].join(' ')}
          confirmLabel="読み込む"
          onConfirm={() => void runImport()}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
