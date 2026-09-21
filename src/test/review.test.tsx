import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { freshDb } from './dbHelpers';
import ReviewScreen from '../screens/ReviewScreen';
import { setPendingCapture } from '../capture/pendingCapture';
import { listRecords } from '../db/records';
import { listTags } from '../db/tags';
import type { SpeechRecognitionLike } from '../capture/speechTypes';

const T = new Date(2026, 8, 21, 12, 31, 0).getTime();

function stubObjectUrl() {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
}

function primeCapture() {
  setPendingCapture({
    blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    width: 1200,
    height: 900,
    capturedAt: T,
    previewUrl: 'blob:preview',
  });
}

function renderReview() {
  return render(
    <MemoryRouter initialEntries={['/review']}>
      <Routes>
        <Route path="/review" element={<ReviewScreen />} />
        <Route path="/" element={<div>カメラ</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await freshDb();
  stubObjectUrl();
  primeCapture();
});

describe('撮影後画面', () => {
  it('メモ空欄・タグ無しでも保存できる', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(async () => expect(await listRecords()).toHaveLength(1));
    const [record] = await listRecords();
    expect(record.memo).toBe('');
    expect(record.tags).toEqual([]);
    expect(record.capturedAt).toBe(T);
  });

  it('日本語メモと登録済みタグを保存できる', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.type(screen.getByLabelText('メモ（任意）'), 'この店また来たい');
    await user.click(await screen.findByRole('button', { name: '旅行' }));
    await user.click(screen.getByRole('button', { name: 'グルメ' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(async () => expect(await listRecords()).toHaveLength(1));
    const [record] = await listRecords();
    expect(record.memo).toBe('この店また来たい');
    expect(record.tags).toEqual(['旅行', 'グルメ']);
  });

  it('タグを選び直すと解除できる', async () => {
    const user = userEvent.setup();
    renderReview();

    const tag = await screen.findByRole('button', { name: '旅行' });
    await user.click(tag);
    expect(tag).toHaveAttribute('aria-pressed', 'true');
    await user.click(tag);
    expect(tag).toHaveAttribute('aria-pressed', 'false');
  });

  it('新しいタグをその場で追加でき、登録済みタグにも入る', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(await screen.findByRole('button', { name: '＋ 新しいタグ' }));
    await user.type(screen.getByLabelText('新しいタグ名'), '紅葉');
    await user.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '紅葉' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect((await listTags()).map((t) => t.name)).toContain('紅葉');

    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(async () => expect((await listRecords())[0]?.tags).toEqual(['紅葉']));
  });

  it('音声入力が使えない環境では案内を表示する', async () => {
    renderReview();
    expect(screen.getByText('この環境では音声入力を利用できません。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '音声入力を開始' })).toBeNull();
  });

  it('音声認識の結果がメモ欄に入る', async () => {
    let instance: SpeechRecognitionLike | undefined;
    class FakeRecognition implements SpeechRecognitionLike {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: SpeechRecognitionLike['onresult'] = null;
      onerror: SpeechRecognitionLike['onerror'] = null;
      onend: SpeechRecognitionLike['onend'] = null;
      onstart: SpeechRecognitionLike['onstart'] = null;
      start() {
        instance = this;
        this.onstart?.();
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    vi.stubGlobal('SpeechRecognition', FakeRecognition);

    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole('button', { name: '音声入力を開始' }));

    instance!.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { length: 1, isFinal: true, 0: { transcript: 'ここから見ると綺麗' } } },
    });
    instance!.onend?.();

    await waitFor(() =>
      expect(screen.getByLabelText('メモ（任意）')).toHaveValue('ここから見ると綺麗'),
    );

    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(async () => expect((await listRecords())[0]?.memo).toBe('ここから見ると綺麗'));
    vi.unstubAllGlobals();
  });
});
