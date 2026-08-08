import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAssetCache,
  getAssetCacheStats,
  MAX_ASSET_CACHE_BYTES,
  saveBoardAsset,
} from './storageService';

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl4sAAAAASUVORK5CYII=';

describe('storageService safe data-url cache', () => {
  beforeEach(() => {
    localStorage.setItem('WHITEBOARD_LOCAL_SANDBOX', '1');
    clearAssetCache();
  });

  afterEach(() => {
    clearAssetCache();
    localStorage.removeItem('WHITEBOARD_LOCAL_SANDBOX');
  });

  it('accounts cached data URLs against the bounded media budget', async () => {
    await saveBoardAsset('board-cache', undefined, ONE_PIXEL_PNG, 'image/png', 'user-1');
    const stats = getAssetCacheStats();

    expect(stats.entries).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.maxBytes).toBe(MAX_ASSET_CACHE_BYTES);
    expect(stats.bytes).toBeLessThanOrEqual(stats.maxBytes);
  });

  it('clears only the requested board cache', async () => {
    await saveBoardAsset('board-a', undefined, ONE_PIXEL_PNG, 'image/png', 'user-1');
    await saveBoardAsset('board-b', 'asset-b', ONE_PIXEL_PNG, 'image/png', 'user-1');
    expect(getAssetCacheStats().entries).toBe(2);

    clearAssetCache('board-a');
    expect(getAssetCacheStats().entries).toBe(1);
  });

  it('rejects media whose bytes do not match the declared MIME type', async () => {
    await expect(
      saveBoardAsset('board-cache', undefined, 'data:image/png;base64,SGVsbG8=', 'image/png', 'user-1'),
    ).rejects.toThrow(/do not match image\/png/i);
  });
});
