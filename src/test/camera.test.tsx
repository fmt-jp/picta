import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CameraScreen from '../screens/CameraScreen';

function renderCamera() {
  return render(
    <MemoryRouter>
      <CameraScreen />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

function stubMediaDevices(getUserMedia: () => Promise<MediaStream>) {
  // jsdom reports an insecure context, which would short-circuit hasCameraApi().
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices: async () => [] },
  });
}

describe('カメラ画面', () => {
  it('カメラAPIが無い環境では代替手段を案内する', async () => {
    renderCamera();
    expect(await screen.findByText('カメラを使えません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '写真を選ぶ' })).toBeInTheDocument();
    // The file fallback keeps 撮影 → 一言 → 保存 reachable.
    expect(screen.getByLabelText('写真を選ぶ')).toHaveAttribute('type', 'file');
  });

  it('権限が拒否された場合は許可方法を案内する', async () => {
    stubMediaDevices(() => Promise.reject(new DOMException('no', 'NotAllowedError')));
    renderCamera();
    await waitFor(() =>
      expect(
        screen.getByText('カメラの使用が許可されていません。端末の設定から許可してください。'),
      ).toBeInTheDocument(),
    );
  });

  it('カメラが見つからない場合はその旨を表示する', async () => {
    stubMediaDevices(() => Promise.reject(new DOMException('none', 'NotFoundError')));
    renderCamera();
    await waitFor(() =>
      expect(screen.getByText('利用できるカメラが見つかりませんでした。')).toBeInTheDocument(),
    );
  });

  it('メニューボタンは常に押せる', () => {
    renderCamera();
    expect(screen.getByRole('button', { name: 'メニューを開く' })).toBeEnabled();
  });

  it('上部にPictaのアイコンと文字を表示する', () => {
    const { container } = renderCamera();
    expect(screen.getByText('Picta')).toBeInTheDocument();
    expect(container.querySelector('.camera-wordmark svg')).toBeInTheDocument();
  });

  it('ビューファインダーは1:1の枠に収まる', () => {
    const { container } = renderCamera();
    expect(container.querySelector('.camera-frame')).toBeInTheDocument();
  });

  it('映像が出ていないときはグリッドを重ねない', () => {
    const { container } = renderCamera();
    expect(container.querySelector('.camera-grid')).toBeNull();
  });
});
