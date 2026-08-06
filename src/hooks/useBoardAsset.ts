import { useState, useEffect, useCallback } from 'react';
import {
  getBoardAsset,
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
  const [data, setData] = useState<string | null>(fallbackInlineData || null);
  const [loading, setLoading] = useState<boolean>(Boolean(boardId && assetId && !fallbackInlineData));
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const retry = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    // Use temporary inline data only while a Storage asset has not been created yet.
    if (fallbackInlineData && !assetId) {
      setData(fallbackInlineData);
      setLoading(false);
      setError(null);
      return;
    }

    if (!boardId || !assetId) {
      setData(fallbackInlineData || null);
      setLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;
    let retained = false;
    // Never leave a previously resolved private asset visible while a different
    // board/account asset is loading. The old retained URL is released by the
    // previous effect cleanup before this effect runs.
    setData(fallbackInlineData || null);
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
        } else if (fallbackInlineData) {
          setData(fallbackInlineData);
          setError(null);
        } else {
          setError(new Error(`Asset ${assetId} not found`));
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        if (fallbackInlineData) {
          setData(fallbackInlineData);
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
  }, [boardId, assetId, fallbackInlineData, reloadToken]);

  return { data, loading, error, retry };
}
