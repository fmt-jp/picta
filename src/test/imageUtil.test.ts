import { describe, expect, it } from 'vitest';
import { MAX_EDGE, fitWithin, photoStamp } from '../capture/imageUtil';

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

describe('photoStamp', () => {
  it('YYYYMMDD_HHMMSS 形式を返す', () => {
    expect(photoStamp(new Date(2026, 8, 21, 12, 31, 0))).toBe('20260921_123100');
  });

  it('1桁の値を0埋めする', () => {
    expect(photoStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102_030405');
  });
});
