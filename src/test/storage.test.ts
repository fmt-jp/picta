import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkPersistence,
  ensurePersistenceOnce,
  requestPersistence,
  supportsPersistence,
} from '../platform/storage';
import { loadSettings } from '../settings';

function stubStorage(impl: { persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> }) {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: impl });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

describe('保存データの保護', () => {
  it('APIが無い環境では unsupported', async () => {
    expect(supportsPersistence()).toBe(false);
    expect(await checkPersistence()).toBe('unsupported');
    expect(await requestPersistence()).toBe('unsupported');
  });

  it('すでに保護されていれば persisted', async () => {
    stubStorage({ persisted: async () => true, persist: async () => true });
    expect(await checkPersistence()).toBe('persisted');
  });

  it('保護されていなければ not-persisted', async () => {
    stubStorage({ persisted: async () => false, persist: async () => false });
    expect(await checkPersistence()).toBe('not-persisted');
  });

  it('要求が通れば persisted を返す', async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => false, persist });
    expect(await requestPersistence()).toBe('persisted');
    expect(persist).toHaveBeenCalledOnce();
  });

  it('要求が断られても例外にしない', async () => {
    stubStorage({ persisted: async () => false, persist: async () => false });
    expect(await requestPersistence()).toBe('not-persisted');
  });

  it('APIが例外を投げても unsupported として扱う', async () => {
    stubStorage({
      persisted: async () => {
        throw new Error('nope');
      },
    });
    expect(await checkPersistence()).toBe('unsupported');
  });
});

describe('自動要求は一度だけ', () => {
  it('初回の保存で要求し、二度目以降は要求しない', async () => {
    const persist = vi.fn(async () => false);
    stubStorage({ persisted: async () => false, persist });

    await ensurePersistenceOnce();
    expect(persist).toHaveBeenCalledOnce();
    expect(loadSettings().persistenceRequested).toBe(true);

    await ensurePersistenceOnce();
    expect(persist).toHaveBeenCalledOnce();
  });

  it('すでに保護されていれば何もしない', async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => true, persist });

    await ensurePersistenceOnce();

    expect(persist).not.toHaveBeenCalled();
    expect(loadSettings().persistenceRequested).toBe(false);
  });
});
