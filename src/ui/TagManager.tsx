import { useCallback, useEffect, useState } from 'react';
import type { Tag } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { deleteTag, ensureTag, listTags, renameTag } from '../db/tags';
import { tagCounts } from '../db/records';

interface Row {
  tag: Tag;
  count: number;
}

/** タグの追加・名称変更・削除（仕様§17）。 */
export default function TagManager() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const [tags, counts] = await Promise.all([listTags(), tagCounts()]);
    setRows(tags.map((tag) => ({ tag, count: counts.get(tag.name) ?? 0 })));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError('');
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました');
    }
  };

  return (
    <div>
      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <div className="memo-row section">
        <input
          className="text-input"
          value={newName}
          aria-label="追加するタグ名"
          placeholder="新しいタグ"
          maxLength={30}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void run(async () => {
              await ensureTag(newName);
              setNewName('');
            });
          }}
        />
        <button
          className="button"
          disabled={!newName.trim()}
          onClick={() =>
            void run(async () => {
              await ensureTag(newName);
              setNewName('');
            })
          }
        >
          追加
        </button>
      </div>

      {rows === null ? (
        <div className="spinner-line">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="empty">タグがありません</div>
      ) : (
        <div className="row-list">
          {rows.map((row) =>
            editing?.id === row.tag.id ? (
              <div className="row" key={row.tag.id}>
                <input
                  className="text-input"
                  value={editing.name}
                  aria-label={`${row.tag.name} の新しい名前`}
                  maxLength={30}
                  autoFocus
                  onChange={(e) => setEditing({ id: row.tag.id, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null);
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    void run(async () => {
                      await renameTag(row.tag.id, editing.name);
                      setEditing(null);
                    });
                  }}
                />
                <button
                  className="icon-button"
                  onClick={() =>
                    void run(async () => {
                      await renameTag(row.tag.id, editing.name);
                      setEditing(null);
                    })
                  }
                >
                  保存
                </button>
                <button className="icon-button" onClick={() => setEditing(null)}>
                  取消
                </button>
              </div>
            ) : (
              <div className="row" key={row.tag.id}>
                <span className="row-main">
                  <span className="row-title">#{row.tag.name}</span>
                  <span className="row-sub">{row.count}件</span>
                </span>
                <button
                  className="icon-button"
                  aria-label={`${row.tag.name} の名前を変更`}
                  onClick={() => setEditing({ id: row.tag.id, name: row.tag.name })}
                >
                  変更
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`${row.tag.name} を削除`}
                  onClick={() => setPendingDelete(row)}
                >
                  削除
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          title={`#${pendingDelete.tag.name} を削除しますか？`}
          message={
            pendingDelete.count > 0
              ? `${pendingDelete.count}件の記録からこのタグが外れます。記録そのものは削除されません。`
              : '記録は削除されません。'
          }
          confirmLabel="削除する"
          danger
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void run(() => deleteTag(target.tag.id));
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
