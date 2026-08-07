import { useState, useEffect, useCallback } from 'react';
import {
  getBoardAsset,
  invalidateBoardAsset,
  releaseBoardAsset,
  retainBoardAsset,
  type BoardAssetDoc,
} from '../services/storageService';

export interface UseBoardAssetResult {
  data: string | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Resolves a private Storage asset into a bounded, revocable object-URL cache.
 * Asset bytes are never written back into element or board-state shards.
 */
export function useBoardAsset(
  boardId?: string,
  assetId?: string,
  fallbackInlineData?: string
): UseBoardAssetResult {
  // blob: and previously signed remote URLs are session-scoped fallbacks. If a
  // durable assetId exists, only a self-contained data: URL is safe to use as
  // a fallback after a reload. This prevents stale blob URLs from masking a
  // real Storage error and rendering only the <img> alt text.
  const safeFallback = assetId
    ? (fallbackInlineData?.startsWith('data:') ? fallbackInlineData : undefined)
    : fallbackInlineData;

  const [data, setData] = useState<string | null>(safeFallback || null);
  const [loading, setLoading] = useState<boolean>(Boolean(boardId && assetId && !safeFallback));
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const retry = useCallback(() => {
    if (boardId && assetId) invalidateBoardAsset(boardId, assetId);
    setReloadToken((prev) => prev + 1);
  }, [boardId, assetId]);

  useEffect(() => {
    // Use temporary inline data only while a Storage asset has not been created yet.
    if (safeFallback && !assetId) {
      setData(safeFallback);
      setLoading(false);
      setError(null);
      return;
    }

    if (!boardId || !assetId) {
      setData(safeFallback || null);
      setLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;
    let retained = false;
    // Never leave a previously resolved private asset visible while a different
    // board/account asset is loading. The old retained URL is released by the
    // previous effect cleanup before this effect runs.
    setData(safeFallback || null);
    setLoading(true);
    setError(null);

    getBoardAsset(boardId, assetId)
      .then((assetDoc: BoardAssetDoc | null) => {
        if (!isMounted) return;
        if (assetDoc && assetDoc.data) {
          retainBoardAsset(boardId, assetId);
          retained = true;
          setData(assetDoc.data);
          setError(null);
        } else if (safeFallback) {
          setData(safeFallback);
          setError(null);
        } else {
          setError(new Error(`Asset ${assetId} not found`));
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        if (safeFallback) {
          setData(safeFallback);
          setError(null);
        } else {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      if (retained) releaseBoardAsset(boardId, assetId);
    };
  }, [boardId, assetId, safeFallback, reloadToken]);

  return { data, loading, error, retry };
}
