import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Tag } from '../types';
import ScreenHeader from '../ui/ScreenHeader';
import { useMenu } from '../ui/menuContext';
import { listTags } from '../db/tags';
import { tagCounts } from '../db/records';

/** 登録済みタグと件数の一覧。タップでそのタグの記録へ（仕様§16）。 */
export default function TagsScreen() {
  const openMenu = useMenu();
  const [rows, setRows] = useState<{ tag: Tag; count: number }[] | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [tags, counts] = await Promise.all([listTags(), tagCounts()]);
      if (!active) return;
      setRows(tags.map((tag) => ({ tag, count: counts.get(tag.name) ?? 0 })));
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="screen">
      <ScreenHeader
        title="タグ"
        onMenu={openMenu}
        actions={
          <Link className="icon-button" to="/settings">
            管理
          </Link>
        }
      />
      <div className="screen-body">
        {rows === null ? (
          <div className="spinner-line">読み込み中…</div>
        ) : rows.length === 0 ? (
          <div className="empty">タグがありません</div>
        ) : (
          <div className="row-list">
            {rows.map(({ tag, count }) => (
              <Link className="row" to={`/tags/${encodeURIComponent(tag.name)}`} key={tag.id}>
                <span className="row-main row-title">#{tag.name}</span>
                <span className="row-count">{count}件</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
