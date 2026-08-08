import { useState, useEffect, useCallback } from 'react';
import { getBoardAsset, AssetLoadError, type BoardAssetDoc } from '../services/storageService';

export interface UseBoardAssetResult {
  data: string | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Custom React hook to resolve and cache base64 asset data from the private Supabase Storage asset record
 * Never writes base64 back into element or state shards.
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

    if (!assetId) {
      setData(fallbackInlineData || null);
      setLoading(false);
      setError(null);
      return;
    }

    // Persisted media has only an assetId because inline src/audio data is
    // intentionally stripped before saving. A missing boardId therefore means
    // the caller forgot to forward board context; surface that as a real error
    // instead of silently rendering <img src=""> and only showing alt text.
    if (!boardId) {
      setData(fallbackInlineData || null);
      setLoading(false);
      setError(new Error(`Board context is required to load asset ${assetId}`));
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    getBoardAsset(boardId, assetId)
      .then((assetDoc: BoardAssetDoc | null) => {
        if (!isMounted) return;
        if (assetDoc && assetDoc.data) {
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
        const normalized = err instanceof Error ? err : new Error(String(err));
        if (normalized instanceof AssetLoadError) {
          console.warn(`[board-asset:${normalized.code}] ${normalized.message}`);
        }
        if (fallbackInlineData) {
          setData(fallbackInlineData);
          // A temporary inline source keeps the element usable while still
          // preserving diagnostics in the console.
          setError(null);
        } else {
          setData(null);
          setError(normalized);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [boardId, assetId, fallbackInlineData, reloadToken]);

  return { data, loading, error, retry };
}
