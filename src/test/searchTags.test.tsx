import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { freshDb, samplePhoto } from './dbHelpers';
import SearchScreen from '../screens/SearchScreen';
import TagsScreen from '../screens/TagsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { createRecord, getRecord } from '../db/records';
import { listTags } from '../db/tags';

const DAY = 24 * 60 * 60 * 1000;
const T = new Date(2026, 8, 21, 12, 31, 0).getTime();

function renderScreen(element: React.ReactElement, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/tags/:name" element={<div>タグ絞り込み</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await freshDb();
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
  localStorage.clear();
});

async function seed() {
  await createRecord({
    photo: samplePhoto(),
    memo: 'ここから見る富士山は綺麗',
    tags: ['旅行', '景色'],
    capturedAt: T - 38 * DAY,
  });
  await createRecord({
    photo: samplePhoto(),
    memo: '富士山が少し見えた',
    tags: ['旅行'],
    capturedAt: T,
  });
  await createRecord({ photo: samplePhoto(), memo: 'ねじを買った', tags: ['DIY'], capturedAt: T - DAY });
}

describe('検索画面', () => {
  it('メモを検索し、件数と新しい順の結果を表示する', async () => {
    const user = userEvent.setup();
    await seed();
    renderScreen(<SearchScreen />);

    await user.type(screen.getByLabelText('検索語'), '富士山');

    expect(await screen.findByText('検索結果：2件')).toBeInTheDocument();
    const memos = screen.getAllByText(/富士山/);
    expect(memos.map((m) => m.textContent)).toEqual([
      '富士山が少し見えた',
      'ここから見る富士山は綺麗',
    ]);
  });

  it('タグでも検索できる', async () => {
    const user = userEvent.setup();
    await seed();
    renderScreen(<SearchScreen />);

    await user.type(screen.getByLabelText('検索語'), '景色');
    expect(await screen.findByText('検索結果：1件')).toBeInTheDocument();
  });

  it('該当が無ければ0件と表示する', async () => {
    const user = userEvent.setup();
    await seed();
    renderScreen(<SearchScreen />);

    await user.type(screen.getByLabelText('検索語'), 'みかん');
    expect(await screen.findByText('検索結果：0件')).toBeInTheDocument();
    expect(screen.getByText('見つかりませんでした')).toBeInTheDocument();
  });
});

describe('タグ一覧', () => {
  it('タグと件数を表示し、タップで絞り込みへ遷移する', async () => {
    const user = userEvent.setup();
    await seed();
    renderScreen(<TagsScreen />, '/tags');

    const row = await screen.findByRole('link', { name: /#旅行/ });
    expect(row).toHaveTextContent('2件');
    expect(screen.getByRole('link', { name: /#DIY/ })).toHaveTextContent('1件');

    await user.click(row);
    expect(await screen.findByText('タグ絞り込み')).toBeInTheDocument();
  });
});

describe('タグ設定', () => {
  it('タグを追加できる', async () => {
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />, '/settings');

    await user.type(await screen.findByLabelText('追加するタグ名'), '紅葉');
    await user.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(async () => expect((await listTags()).map((t) => t.name)).toContain('紅葉'));
  });

  it('タグ名を変更すると過去の記録も追従する', async () => {
    const user = userEvent.setup();
    const record = await createRecord({
      photo: samplePhoto(),
      memo: '',
      tags: ['旅行'],
      capturedAt: T,
    });
    renderScreen(<SettingsScreen />, '/settings');

    await user.click(await screen.findByRole('button', { name: '旅行 の名前を変更' }));
    const input = screen.getByLabelText('旅行 の新しい名前');
    await user.clear(input);
    await user.type(input, '旅');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(async () => expect((await getRecord(record.id))?.tags).toEqual(['旅']));
  });

  it('タグ削除は確認の上で行い、記録自体は残る', async () => {
    const user = userEvent.setup();
    const record = await createRecord({
      photo: samplePhoto(),
      memo: 'のこる',
      tags: ['旅行', 'グルメ'],
      capturedAt: T,
    });
    renderScreen(<SettingsScreen />, '/settings');

    await user.click(await screen.findByRole('button', { name: '旅行 を削除' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('1件の記録からこのタグが外れます。記録そのものは削除されません。'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '削除する' }));

    await waitFor(async () => {
      const stored = await getRecord(record.id);
      expect(stored?.memo).toBe('のこる');
      expect(stored?.tags).toEqual(['グルメ']);
    });
    expect((await listTags()).map((t) => t.name)).not.toContain('旅行');
  });

  it('端末への保存設定を切り替えられる', async () => {
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />, '/settings');

    const toggle = await screen.findByRole('checkbox', {
      name: '撮影した写真を端末にも保存する',
    });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem('picta.settings.v1')!).savePhotosToLibrary).toBe(false);
  });

  it('端末への保存をOFFにするとバックアップの注意を出す', async () => {
    const user = userEvent.setup();
    renderScreen(<SettingsScreen />, '/settings');

    expect(screen.queryByText(/バックアップは「エクスポート」の写真付きZIPだけ/)).toBeNull();

    await user.click(
      await screen.findByRole('checkbox', { name: '撮影した写真を端末にも保存する' }),
    );

    expect(
      screen.getByText(/OFFの間は端末にコピーが作られません/),
    ).toBeInTheDocument();
  });

  it('保存データの保護状態を表示し、要求できる', async () => {
    const persist = vi.fn(async () => true);
    let persisted = false;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: async () => persisted,
        persist: async () => {
          persisted = await persist();
          return persisted;
        },
      },
    });

    const user = userEvent.setup();
    renderScreen(<SettingsScreen />, '/settings');

    expect(await screen.findByText('保護されていません')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'データを保護する' }));

    expect(await screen.findByText('保護されています')).toBeInTheDocument();
    expect(persist).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'データを保護する' })).toBeNull();
    Reflect.deleteProperty(navigator, 'storage');
  });
});
