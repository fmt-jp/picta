import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HashRouter } from 'react-router-dom';
import App from '../App';

function renderApp() {
  window.location.hash = '#/';
  return render(
    <HashRouter>
      <App />
    </HashRouter>,
  );
}

describe('アプリシェル', () => {
  it('メニューを開くと全項目が表示され、閉じると消える', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.queryByRole('navigation', { name: 'メインメニュー' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'メニューを開く' }));
    const menu = screen.getByRole('navigation', { name: 'メインメニュー' });
    for (const label of ['撮影', '過去の記録', '検索', 'タグ', 'エクスポート', '設定']) {
      expect(within(menu).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'メニューを閉じる' }));
    expect(screen.queryByRole('navigation', { name: 'メインメニュー' })).toBeNull();
  });

  it('メニュー項目には線画アイコンが付く', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'メニューを開く' }));
    const menu = screen.getByRole('navigation', { name: 'メインメニュー' });

    const links = within(menu).getAllByRole('link');
    expect(links).toHaveLength(6);
    for (const link of links) {
      const icon = link.querySelector('svg.menu-icon');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      // 線画＋金のアクセントが1点ずつ入っている
      expect(icon!.querySelectorAll('.s').length).toBeGreaterThan(0);
      expect(icon!.querySelectorAll('.af, .as').length).toBeGreaterThan(0);
    }
  });
});
