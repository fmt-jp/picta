import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import PictaMark from './PictaMark';

interface Props {
  title: string;
  /** Show a back arrow instead of the menu button. */
  back?: boolean;
  /** Called by the menu button; omit together with `back` for a bare header. */
  onMenu?: () => void;
  /**
   * Show the Picta lockup in place of the title, matching the camera screen.
   * `title` stays as the heading for screen readers.
   */
  brand?: boolean;
  actions?: ReactNode;
}

export default function ScreenHeader({ title, back, onMenu, brand, actions }: Props) {
  const navigate = useNavigate();

  const leading = back ? (
    <button className="icon-button" onClick={() => navigate(-1)} aria-label="戻る">
      ←
    </button>
  ) : onMenu ? (
    <button className="icon-button" onClick={onMenu} aria-label="メニューを開く">
      ☰
    </button>
  ) : brand ? (
    // Keeps the lockup centred when there is nothing to put on the left.
    <span className="icon-button" aria-hidden="true" />
  ) : null;

  return (
    <header className={brand ? 'header header-brand' : 'header'}>
      {leading}
      {brand ? (
        <>
          <h1 className="sr-only">{title}</h1>
          <span className="camera-wordmark" aria-hidden="true">
            <PictaMark />
            Picta
          </span>
        </>
      ) : (
        <h1>{title}</h1>
      )}
      {actions}
    </header>
  );
}
