import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tag } from '../types';
import { ensureTag, listTags, normalizeTagName } from '../db/tags';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Registered tags as tap targets, plus "＋ 新しいタグ" for one-off additions.
 * A new tag is registered immediately, so it is on the list next time.
 */
export default function TagPicker({ selected, onChange }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setTags(await listTags());
    } catch {
      setError('タグを読み込めませんでした');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name]);
  };

  const commitNewTag = async () => {
    const name = normalizeTagName(draft);
    if (!name) {
      setAdding(false);
      setDraft('');
      return;
    }
    try {
      await ensureTag(name);
      await reload();
      if (!selected.includes(name)) onChange([...selected, name]);
      setDraft('');
      setAdding(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグを追加できませんでした');
    }
  };

  // Tags already on the record but no longer registered stay selectable.
  const extra = selected.filter((name) => !tags.some((t) => t.name === name));

  return (
    <div>
      <div className="tag-list">
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={selected.includes(tag.name) ? 'tag-chip selected' : 'tag-chip'}
            aria-pressed={selected.includes(tag.name)}
            onClick={() => toggle(tag.name)}
          >
            {tag.name}
          </button>
        ))}
        {extra.map((name) => (
          <button
            key={`extra-${name}`}
            type="button"
            className="tag-chip selected"
            aria-pressed
            onClick={() => toggle(name)}
          >
            {name}
          </button>
        ))}
        {!adding ? (
          <button type="button" className="tag-chip add" onClick={() => setAdding(true)}>
            ＋ 新しいタグ
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="memo-row" style={{ marginTop: 10 }}>
          <input
            ref={inputRef}
            className="text-input"
            value={draft}
            aria-label="新しいタグ名"
            placeholder="タグ名"
            maxLength={30}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitNewTag();
              } else if (e.key === 'Escape') {
                setAdding(false);
                setDraft('');
              }
            }}
          />
          <button type="button" className="button" onClick={() => void commitNewTag()}>
            追加
          </button>
        </div>
      ) : null}

      {error ? <p className="hint">{error}</p> : null}
    </div>
  );
}
