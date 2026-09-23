import { NavLink } from 'react-router-dom';
import { useEffect } from 'react';
import MenuIcon, { type MenuIconName } from './MenuIcon';

const ITEMS: { to: string; icon: MenuIconName; label: string; end: boolean }[] = [
  { to: '/', icon: 'camera', label: '撮影', end: true },
  { to: '/records', icon: 'records', label: '過去の記録', end: false },
  { to: '/search', icon: 'search', label: '検索', end: false },
  { to: '/tags', icon: 'tags', label: 'タグ', end: false },
  { to: '/export', icon: 'export', label: 'エクスポート', end: false },
  { to: '/settings', icon: 'settings', label: '設定', end: false },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MenuDrawer({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button className="menu-backdrop" aria-label="メニューを閉じる" onClick={onClose} />
      <nav className="menu-panel" aria-label="メインメニュー">
        <div className="menu-title">トリコト</div>
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className="menu-item"
            onClick={onClose}
          >
            <MenuIcon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
        <div className="menu-footer">写真を撮ったついでに、一言残す。</div>
      </nav>
    </>
  );
}
