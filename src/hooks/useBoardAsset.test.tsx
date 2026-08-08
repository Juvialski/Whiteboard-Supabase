import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBoardAssetMock = vi.fn();

vi.mock('../services/storageService', () => ({
  getBoardAsset: (...args: unknown[]) => getBoardAssetMock(...args),
  AssetLoadError: class AssetLoadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { useBoardAsset } from './useBoardAsset';

describe('useBoardAsset board context', () => {
  beforeEach(() => {
    getBoardAssetMock.mockReset();
  });

  it('reports a missing board context instead of silently rendering an empty asset', async () => {
    const { result } = renderHook(() => useBoardAsset(undefined, 'asset-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error?.message).toMatch(/board context is required/i);
    expect(getBoardAssetMock).not.toHaveBeenCalled();
  });

  it('loads a persisted asset with the exact board and asset IDs', async () => {
    getBoardAssetMock.mockResolvedValue({
      assetId: 'asset-1',
      encoding: 'base64',
      mimeType: 'image/png',
      data: 'data:image/png;base64,AAAA',
      encodedByteSize: 4,
      contentHash: 'hash',
      createdAt: 1,
    });

    const { result } = renderHook(() => useBoardAsset('board-1', 'asset-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getBoardAssetMock).toHaveBeenCalledWith('board-1', 'asset-1');
    expect(result.current.data).toBe('data:image/png;base64,AAAA');
    expect(result.current.error).toBeNull();
  });
});
