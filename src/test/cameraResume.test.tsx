import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CameraScreen from '../screens/CameraScreen';

/**
 * Regression tests for the viewfinder freezing after the app is resumed:
 * the OS shuts the capture session down while the page stays alive, so the
 * <video> element keeps painting the frame it last decoded.
 */
class FakeTrack extends EventTarget {
  kind = 'video';
  readyState: 'live' | 'ended' = 'live';
  muted = false;

  stop() {
    this.readyState = 'ended';
  }

  /** The OS took the camera away. */
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.dispatchEvent(new Event(muted ? 'mute' : 'unmute'));
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks;
  }
}

let tracks: FakeTrack[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  tracks = [];
  getUserMedia = vi.fn(async () => {
    const track = new FakeTrack();
    tracks.push(track);
    return new FakeStream([track]) as unknown as MediaStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices: async () => [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

function renderCamera() {
  return render(
    <MemoryRouter>
      <CameraScreen />
    </MemoryRouter>,
  );
}

async function waitForLiveCamera() {
  await waitFor(() => expect(screen.getByRole('button', { name: '撮影' })).toBeEnabled());
}

const latestTrack = () => tracks[tracks.length - 1];

describe('カメラの復帰', () => {
  it('カメラが取り上げられたら止まったことを示し、取り直す', async () => {
    renderCamera();
    await waitForLiveCamera();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // 取り直しの完了を保留させ、途中の表示を観察できるようにする
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    getUserMedia.mockImplementationOnce(async () => {
      await pending;
      const track = new FakeTrack();
      tracks.push(track);
      return new FakeStream([track]) as unknown as MediaStream;
    });

    await act(async () => {
      latestTrack().end();
    });

    // 止まった映像をそのまま見せない
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/カメラを(再開|起動)しています…/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撮影' })).toBeDisabled();
    expect(document.querySelector('video')).toHaveStyle({ display: 'none' });

    await act(async () => {
      release();
      await pending;
    });
    await waitForLiveCamera();
  });

  it('復帰（pageshow）時にストリームが死んでいれば取り直す', async () => {
    renderCamera();
    await waitForLiveCamera();

    // バックグラウンドでOSがカメラを閉じた状態を作る（イベントは飛ばない）
    latestTrack().readyState = 'ended';

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
    });

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await waitForLiveCamera();
  });

  it('復帰時にストリームが生きていれば取り直さない', async () => {
    renderCamera();
    await waitForLiveCamera();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('カメラを再開しています…')).toBeNull();
  });

  it('映像が途切れている間はシャッターを押せない', async () => {
    renderCamera();
    await waitForLiveCamera();

    await act(async () => {
      latestTrack().setMuted(true);
    });

    expect(screen.getByRole('button', { name: '撮影' })).toBeDisabled();
    expect(screen.getByText('カメラを再開しています…')).toBeInTheDocument();

    await act(async () => {
      latestTrack().setMuted(false);
    });

    await waitForLiveCamera();
    // 途切れが直っただけなので取り直しはしない
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('権限拒否のあとは勝手に要求し直さない', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    renderCamera();
    await screen.findByText('カメラの使用が許可されていません。端末の設定から許可してください。');

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
