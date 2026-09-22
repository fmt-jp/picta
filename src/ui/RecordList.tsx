import { Link } from 'react-router-dom';
import type { Record } from '../types';
import { dayKey, formatDate, formatTime } from '../format';
import { usePhotoUrl } from '../db/usePhotoUrl';

function Thumb({ photoId }: { photoId: string }) {
  const url = usePhotoUrl(photoId);
  return (
    <div className="record-thumb">
      {url ? <img src={url} alt="" loading="lazy" /> : null}
    </div>
  );
}

interface Props {
  records: Record[];
  emptyMessage: string;
  /** Selection mode: rows toggle instead of opening the record. */
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
}

/**
 * Records grouped by 撮影日, newest day first and newest photo first inside
 * each day (spec §11). The same list is reused by 検索 and タグ絞り込み.
 */
export default function RecordList({
  records,
  emptyMessage,
  selectable = false,
  selectedIds,
  onToggle,
}: Props) {
  if (records.length === 0) {
    return <div className="empty">{emptyMessage}</div>;
  }

  const groups: { key: string; label: string; items: Record[] }[] = [];
  for (const record of records) {
    const key = dayKey(record.capturedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(record);
    else groups.push({ key, label: formatDate(record.capturedAt), items: [record] });
  }

  return (
    <>
      {groups.map((group) => (
        <section className="date-group" key={group.key}>
          <h2 className="date-heading">{group.label}</h2>
          {group.items.map((record) => {
            const selected = selectedIds?.has(record.id) ?? false;
            const body = (
              <>
                {selectable ? (
                  <span className={selected ? 'record-check on' : 'record-check'} aria-hidden="true">
                    {selected ? '✓' : ''}
                  </span>
                ) : null}
                <Thumb photoId={record.photoId} />
                <div className="record-body">
                  <p className={record.memo ? 'record-memo' : 'record-memo empty-memo'}>
                    {record.memo || 'メモなし'}
                  </p>
                  <div className="record-meta">
                    {record.tags.map((tag) => (
                      <span className="tag-inline" key={tag}>
                        #{tag}
                      </span>
                    ))}
                    {formatTime(record.capturedAt)}
                  </div>
                </div>
              </>
            );

            return selectable ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-label={record.memo || 'メモなし'}
                className={selected ? 'record-item selected' : 'record-item'}
                key={record.id}
                onClick={() => onToggle?.(record.id)}
              >
                {body}
              </button>
            ) : (
              <Link className="record-item" to={`/records/${record.id}`} key={record.id}>
                {body}
              </Link>
            );
          })}
        </section>
      ))}
    </>
  );
}
