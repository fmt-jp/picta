import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  /** Show a back arrow instead of the menu button. */
  back?: boolean;
  /** Called by the menu button; omit together with `back` for a bare header. */
  onMenu?: () => void;
  actions?: ReactNode;
}

export default function ScreenHeader({ title, back, onMenu, actions }: Props) {
  const navigate = useNavigate();

  return (
    <header className="header">
      {back ? (
        <button className="icon-button" onClick={() => navigate(-1)} aria-label="戻る">
          ←
        </button>
      ) : onMenu ? (
        <button className="icon-button" onClick={onMenu} aria-label="メニューを開く">
          ☰
        </button>
      ) : null}
      <h1>{title}</h1>
      {actions}
    </header>
  );
}
