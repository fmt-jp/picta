import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { freshDb, samplePhoto } from './dbHelpers';
import RecordsScreen from '../screens/RecordsScreen';
import RecordDetailScreen from '../screens/RecordDetailScreen';
import RecordEditScreen from '../screens/RecordEditScreen';
import { createRecord, getRecord, listRecords } from '../db/records';
import { loadPhotoBlob } from '../db/photoStore';

const T = new Date(2026, 8, 21, 12, 31, 0).getTime();

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/records" element={<RecordsScreen />} />
        <Route path="/records/:id" element={<RecordDetailScreen />} />
        <Route path="/records/:id/edit" element={<RecordEditScreen />} />
        <Route path="/tags/:name" element={<RecordsScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function seed() {
  await createRecord({
    photo: samplePhoto(),
    memo: 'ここから見ると綺麗',
    tags: ['旅行'],
    capturedAt: new Date(2026, 8, 20, 18, 30).getTime(),
  });
  await createRecord({
    photo: samplePhoto(),
    memo: '思ったより大きい',
    tags: ['買い物'],
    capturedAt: T - 60 * 60 * 1000,
  });
  return createRecord({
    photo: samplePhoto(),
    memo: 'この店また来たい',
    tags: ['旅行', 'グルメ'],
    capturedAt: T,
  });
}

beforeEach(async () => {
  await freshDb();
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
});

describe('過去の記録', () => {
  it('日付でグループ化し、撮影日時の新しい順に並べる', async () => {
    await seed();
    renderAt('/records');

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['2026年9月21日', '2026年9月20日']);

    const memos = screen.getAllByText(/この店また来たい|思ったより大きい|ここから見ると綺麗/);
    expect(memos.map((m) => m.textContent)).toEqual([
      'この店また来たい',
      '思ったより大きい',
      'ここから見ると綺麗',
    ]);
  });

  it('記録が無ければ空の案内を出す', async () => {
    renderAt('/records');
    expect(await screen.findByText('まだ記録がありません')).toBeInTheDocument();
  });

  it('メモが無い記録は「メモなし」と表示する', async () => {
    await createRecord({ photo: samplePhoto(), memo: '', tags: [], capturedAt: T });
    renderAt('/records');
    expect(await screen.findByText('メモなし')).toBeInTheDocument();
  });

  it('タグ指定ではそのタグの記録だけを新しい順に表示する', async () => {
    await seed();
    renderAt('/tags/旅行');

    await screen.findByText('この店また来たい');
    expect(screen.getByText('ここから見ると綺麗')).toBeInTheDocument();
    expect(screen.queryByText('思ったより大きい')).toBeNull();
  });
});

describe('記録詳細', () => {
  it('写真・撮影日時・メモ・タグを表示する', async () => {
    const record = await seed();
    renderAt(`/records/${record.id}`);

    expect(await screen.findByText('2026年9月21日 12:31')).toBeInTheDocument();
    expect(screen.getByText('この店また来たい')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#旅行' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#グルメ' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'この店また来たい' })).toHaveAttribute(
      'src',
      'blob:photo',
    );
  });

  it('削除は確認してから実行し、フォトライブラリには触れないと明示する', async () => {
    const user = userEvent.setup();
    const record = await seed();
    renderAt(`/records/${record.id}`);

    await user.click(await screen.findByRole('button', { name: 'この記録を削除' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('端末のフォトライブラリに保存した写真は削除されません。'),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '削除する' }));
    await waitFor(async () => expect(await getRecord(record.id)).toBeUndefined());
    expect(await listRecords()).toHaveLength(2);
  });

  it('削除をキャンセルすると記録は残る', async () => {
    const user = userEvent.setup();
    const record = await seed();
    renderAt(`/records/${record.id}`);

    await user.click(await screen.findByRole('button', { name: 'この記録を削除' }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await getRecord(record.id)).toBeDefined();
  });
});

describe('記録の編集', () => {
  it('メモとタグを変更できる（撮影日時は変わらない）', async () => {
    const user = userEvent.setup();
    const record = await seed();
    renderAt(`/records/${record.id}/edit`);

    const memo = await screen.findByLabelText('メモ');
    await user.clear(memo);
    await user.type(memo, '書き換えたメモ');
    await user.click(await screen.findByRole('button', { name: 'グルメ' })); // 解除
    await user.click(screen.getByRole('button', { name: '仕事' })); // 追加
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(async () => {
      const stored = await getRecord(record.id);
      expect(stored?.memo).toBe('書き換えたメモ');
      expect(stored?.tags).toEqual(['旅行', '仕事']);
      expect(stored?.capturedAt).toBe(T);
    });
  });

  it('メモだけを削除できる', async () => {
    const user = userEvent.setup();
    const record = await seed();
    renderAt(`/records/${record.id}/edit`);

    await user.click(await screen.findByRole('button', { name: 'メモを削除' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(async () => expect((await getRecord(record.id))?.memo).toBe(''));
  });

  it('編集画面から新しいタグを追加できる', async () => {
    const user = userEvent.setup();
    const record = await seed();
    renderAt(`/records/${record.id}/edit`);

    await user.click(await screen.findByRole('button', { name: '＋ 新しいタグ' }));
    await user.type(screen.getByLabelText('新しいタグ名'), '再訪');
    await user.click(screen.getByRole('button', { name: '追加' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(async () => expect((await getRecord(record.id))?.tags).toContain('再訪'));
  });
});

describe('複数選択して削除', () => {
  async function enterSelection(user: ReturnType<typeof userEvent.setup>) {
    renderAt('/records');
    await screen.findByText('この店また来たい');
    await user.click(screen.getByRole('button', { name: '選択' }));
  }

  it('選択モードに入ると各記録がチェックできる', async () => {
    const user = userEvent.setup();
    await seed();
    await enterSelection(user);

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toHaveAttribute('aria-checked', 'false');

    await user.click(boxes[0]);
    expect(boxes[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: '1件を選択' })).toBeInTheDocument();

    await user.click(boxes[0]);
    expect(boxes[0]).toHaveAttribute('aria-checked', 'false');
  });

  it('未選択では削除ボタンを押せない', async () => {
    const user = userEvent.setup();
    await seed();
    await enterSelection(user);
    expect(screen.getByRole('button', { name: '削除する記録を選んでください' })).toBeDisabled();
  });

  it('削除前に確認画面で2つの選択肢を出す', async () => {
    const user = userEvent.setup();
    await seed();
    await enterSelection(user);

    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await user.click(screen.getByRole('button', { name: '2件を削除' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '2件をどう削除しますか？' })).toBeInTheDocument();
    expect(
      within(dialog).getByText('端末のフォトライブラリに保存した写真は削除されません。'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /メモだけ削除/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /メモと写真を削除/ })).toBeInTheDocument();
  });

  it('「メモだけ削除」は写真とタグを残してメモだけ消す', async () => {
    const user = userEvent.setup();
    const newest = await seed();
    await enterSelection(user);

    await user.click(screen.getAllByRole('checkbox')[0]); // この店また来たい
    await user.click(screen.getByRole('button', { name: '1件を削除' }));
    await user.click(screen.getByRole('button', { name: /メモだけ削除/ }));

    await waitFor(async () => expect((await getRecord(newest.id))?.memo).toBe(''));
    const kept = await getRecord(newest.id);
    expect(kept?.tags).toEqual(['旅行', 'グルメ']);
    expect(await loadPhotoBlob(newest.photoId)).not.toBeNull();
    expect(await listRecords()).toHaveLength(3);
  });

  it('「メモと写真を削除」は記録ごと消す', async () => {
    const user = userEvent.setup();
    const newest = await seed();
    await enterSelection(user);

    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getAllByRole('checkbox')[1]);
    await user.click(screen.getByRole('button', { name: '2件を削除' }));
    await user.click(screen.getByRole('button', { name: /メモと写真を削除/ }));

    await waitFor(async () => expect(await listRecords()).toHaveLength(1));
    expect(await getRecord(newest.id)).toBeUndefined();
    expect(await loadPhotoBlob(newest.photoId)).toBeNull();
    expect((await listRecords())[0].memo).toBe('ここから見ると綺麗');
  });

  it('確認をキャンセルすると何も消えない', async () => {
    const user = userEvent.setup();
    await seed();
    await enterSelection(user);

    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: '1件を削除' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await listRecords()).toHaveLength(3);
  });

  it('選択モードを抜けると通常の一覧に戻る', async () => {
    const user = userEvent.setup();
    await seed();
    await enterSelection(user);

    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: 'やめる' }));

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('heading', { name: '過去の記録' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });
});
