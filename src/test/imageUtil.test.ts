import { describe, expect, it } from 'vitest';
import { MAX_EDGE, centeredSquareCrop, fitWithin, photoStamp } from '../capture/imageUtil';

describe('fitWithin', () => {
  it('小さい画像は拡大しない', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('長辺をMAX_EDGEに収め、アスペクト比を保つ', () => {
    const r = fitWithin(4000, 3000);
    expect(r.width).toBe(MAX_EDGE);
    expect(r.height).toBe(Math.round((3000 * MAX_EDGE) / 4000));
  });

  it('縦長でも長辺基準で縮小する', () => {
    const r = fitWithin(3000, 4000);
    expect(r.height).toBe(MAX_EDGE);
    expect(r.width).toBe(Math.round((3000 * MAX_EDGE) / 4000));
  });

  it('0サイズでも壊れない', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('centeredSquareCrop', () => {
  it('横長フレームから中央の正方形を切り出す', () => {
    expect(centeredSquareCrop(1920, 1080)).toEqual({ sx: 420, sy: 0, sw: 1080, sh: 1080 });
  });

  it('縦長フレームでも中央を切り出す', () => {
    expect(centeredSquareCrop(1080, 1920)).toEqual({ sx: 0, sy: 420, sw: 1080, sh: 1080 });
  });

  it('すでに正方形なら切り出さない', () => {
    expect(centeredSquareCrop(1440, 1440)).toEqual({ sx: 0, sy: 0, sw: 1440, sh: 1440 });
  });

  it('切り出した正方形は長辺上限までしか縮まない', () => {
    const crop = centeredSquareCrop(4032, 3024);
    const fitted = fitWithin(crop.sw, crop.sh);
    expect(fitted).toEqual({ width: MAX_EDGE, height: MAX_EDGE });
  });
});

describe('photoStamp', () => {
  it('YYYYMMDD_HHMMSS 形式を返す', () => {
    expect(photoStamp(new Date(2026, 8, 21, 12, 31, 0))).toBe('20260921_123100');
  });

  it('1桁の値を0埋めする', () => {
    expect(photoStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102_030405');
  });
});
