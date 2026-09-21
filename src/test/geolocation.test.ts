import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  awaitLocation,
  formatCoordinates,
  hasGeolocation,
  mapUrl,
  requestLocation,
} from '../capture/geolocation';

function stubGeolocation(impl: Partial<Geolocation>) {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: impl });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
  vi.useRealTimers();
});

describe('位置情報の取得', () => {
  it('APIが無い環境では null を返す', async () => {
    expect(hasGeolocation()).toBe(false);
    expect(await requestLocation()).toBeNull();
  });

  it('取得できた座標を返す', async () => {
    stubGeolocation({
      getCurrentPosition: (success) =>
        (success as PositionCallback)({
          coords: { latitude: 35.681236, longitude: 139.767125, accuracy: 12.4 },
        } as GeolocationPosition),
    });

    const point = await requestLocation();
    expect(point).toEqual({
      latitude: 35.681236,
      longitude: 139.767125,
      accuracy: 12,
      source: 'device',
    });
  });

  it('拒否されても例外にせず null を返す', async () => {
    stubGeolocation({
      getCurrentPosition: (_success, error) =>
        (error as PositionErrorCallback)({ code: 1, message: 'denied' } as GeolocationPositionError),
    });
    expect(await requestLocation()).toBeNull();
  });

  it('期限内に取得できなければ null（保存を待たせない）', async () => {
    const never = new Promise<null>(() => {});
    expect(await awaitLocation(never, 10)).toBeNull();
  });

  it('期限内に取得できればその値を使う', async () => {
    const point = { latitude: 1, longitude: 2, source: 'device' as const };
    expect(await awaitLocation(Promise.resolve(point), 1000)).toEqual(point);
  });
});

describe('座標の表示', () => {
  it('小数6桁で表示する', () => {
    expect(formatCoordinates({ latitude: 35.681236, longitude: 139.767125, source: 'device' })).toBe(
      '35.681236, 139.767125',
    );
  });

  it('地図アプリに渡せるURLを作る', () => {
    expect(mapUrl({ latitude: 1.5, longitude: -2.25, source: 'exif' })).toBe(
      'https://www.google.com/maps?q=1.5,-2.25',
    );
  });
});
