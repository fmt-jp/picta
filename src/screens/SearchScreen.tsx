import { useEffect, useState } from 'react';
import type { Record } from '../types';
import ScreenHeader from '../ui/ScreenHeader';
import RecordList from '../ui/RecordList';
import { useMenu } from '../ui/menuContext';
import { searchRecords } from '../db/records';

/** メモとタグを対象に検索する（仕様§15）。結果は撮影日時の新しい順。 */
export default function SearchScreen() {
  const openMenu = useMenu();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Record[] | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    let active = true;
    // Everything is local, but debouncing keeps typing smooth on long lists
    // and avoids re-rendering on every keystroke of a 変換中 Japanese input.
    const timer = window.setTimeout(() => {
      void searchRecords(trimmed).then((found) => {
        if (active) setResults(found);
      });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="screen">
      <ScreenHeader title="検索" onMenu={openMenu} />
      <div className="screen-body">
        <div className="section">
          <input
            className="text-input"
            type="search"
            value={query}
            aria-label="検索語"
            placeholder="メモ・タグを検索"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {results === null ? (
          <div className="empty">メモとタグから検索します</div>
        ) : (
          <>
            <p className="field-label">検索結果：{results.length}件</p>
            <RecordList records={results} emptyMessage="見つかりませんでした" />
          </>
        )}
      </div>
    </div>
  );
}
