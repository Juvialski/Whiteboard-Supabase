import { auth, supabase } from '../supabase';
import { isSandboxEnvironment } from '../utils/sandboxGuard';
import { trackOperation } from '../utils/databaseInstrumentation';

export interface BoardAssetDoc {
  assetId: string;
  encoding: 'base64';
  mimeType: string;
  data: string;
  encodedByteSize: number;
  originalByteSize?: number;
  width?: number;
  height?: number;
  contentHash: string;
  createdAt: number;
  createdBy?: string;
  objectPath?: string;
}

export interface SavedAssetMeta {
  assetId: string;
  mimeType: string;
  encodedByteSize: number;
  width?: number;
  height?: number;
}

const BUCKET = 'board-assets';
const assetCacheMap = new Map<string, BoardAssetDoc>();
const hashToAssetIdMap = new Map<string, string>();
const inFlightAssetRequests = new Map<string, Promise<BoardAssetDoc | null>>();

export const MAX_ASSET_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_SAFE_ASSET_BYTES = MAX_ASSET_DOCUMENT_BYTES;

const ALLOWED_ASSET_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
]);

export async function computeSHA256Hash(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Use deterministic fallback below.
    }
  }
  return computeContentHash(data);
}

export function computeContentHash(data: string): string {
  let hash = 0;
  for (let index = 0; index < data.length; index += 1) {
    hash = (Math.imul(31, hash) + data.charCodeAt(index)) | 0;
  }
  return `hash_${Math.abs(hash).toString(16)}_${data.length}`;
}

export async function compressImageBase64(
  base64DataUrl: string,
  maxWidth: number = 1600,
  maxHeight: number = 1600,
  quality: number = 0.78
): Promise<string> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return base64DataUrl;
  if (base64DataUrl.length < 150_000) return base64DataUrl;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      let width = image.width;
      let height = image.height;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(base64DataUrl);
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      const outputType = base64DataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const compressed = canvas.toDataURL(outputType, quality);
      resolve(compressed.length < base64DataUrl.length ? compressed : base64DataUrl);
    };
    image.onerror = () => resolve(base64DataUrl);
    image.src = base64DataUrl;
  });
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('pdf')) return 'pdf';
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('webm')) return 'webm';
  return 'bin';
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  // Do not use fetch(dataUrl) here. Production CSP intentionally limits
  // connect-src, and browsers treat fetching a data: URL as a connection.
  // Decode it locally instead so uploads work without weakening the CSP.
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('The selected media file is not a valid data URL.');
  }

  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 5) {
    throw new Error('The selected media file has an invalid data URL.');
  }

  const header = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const headerParts = header.split(';').filter(Boolean);
  const mimeType = (headerParts[0] || 'application/octet-stream').toLowerCase();
  const isBase64 = headerParts.some((part) => part.toLowerCase() === 'base64');

  try {
    if (isBase64) {
      const normalizedPayload = payload.replace(/\s/g, '');
      const binary = atob(normalizedPayload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: mimeType });
    }

    const decoded = decodeURIComponent(payload);
    return new Blob([decoded], { type: mimeType });
  } catch {
    throw new Error('Unable to decode the selected media file.');
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read downloaded asset.'));
    reader.readAsDataURL(blob);
  });
}

function metadataToAssetDoc(row: any, data: string): BoardAssetDoc {
  return {
    assetId: row.asset_id,
    encoding: 'base64',
    mimeType: row.mime_type,
    data,
    encodedByteSize: Number(row.encoded_byte_size || data.length),
    originalByteSize: row.original_byte_size == null ? undefined : Number(row.original_byte_size),
    width: row.width == null ? undefined : Number(row.width),
    height: row.height == null ? undefined : Number(row.height),
    contentHash: row.content_hash,
    createdAt: Number(row.created_at || 0),
    createdBy: row.created_by || undefined,
    objectPath: row.object_path,
  };
}

export async function saveBoardAsset(
  boardId: string,
  providedAssetId: string | undefined,
  base64DataUrl: string,
  contentType: string = 'image/png',
  userId?: string
): Promise<SavedAssetMeta> {
  let finalData = base64DataUrl;
  if (contentType.startsWith('image/') && contentType !== 'image/gif') {
    finalData = await compressImageBase64(base64DataUrl);
  }

  const blob = await dataUrlToBlob(finalData);
  const effectiveContentType = (blob.type || contentType || '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_ASSET_MIME_TYPES.has(effectiveContentType)) {
    throw new Error(`Unsupported asset type: ${effectiveContentType || 'unknown'}.`);
  }
  if (blob.size > MAX_SAFE_ASSET_BYTES) {
    throw new Error(`File is ${Math.ceil(blob.size / 1024 / 1024)} MB. The maximum asset size is 20 MB.`);
  }

  const contentHash = await computeSHA256Hash(finalData);
  const hashKey = `${boardId}:${contentHash}`;
  const cachedId = hashToAssetIdMap.get(hashKey);
  if (cachedId) {
    const cached = assetCacheMap.get(`${boardId}:${cachedId}`);
    if (cached) {
      return {
        assetId: cached.assetId,
        mimeType: cached.mimeType,
        encodedByteSize: cached.encodedByteSize,
        width: cached.width,
        height: cached.height,
      };
    }
  }

  const assetId = providedAssetId || `asset_${contentHash.slice(0, 32)}`;
  const objectPath = `boards/${boardId}/${assetId}.${extensionForMime(effectiveContentType)}`;
  const createdAt = Date.now();
  const createdBy = userId || auth.currentUser?.uid;

  const assetDoc: BoardAssetDoc = {
    assetId,
    encoding: 'base64',
    mimeType: effectiveContentType,
    data: finalData,
    encodedByteSize: finalData.length,
    originalByteSize: blob.size,
    contentHash,
    createdAt,
    createdBy,
    objectPath,
  };

  const cacheKey = `${boardId}:${assetId}`;

  if (isSandboxEnvironment()) {
    assetCacheMap.set(cacheKey, assetDoc);
    hashToAssetIdMap.set(hashKey, assetId);
    return { assetId, mimeType: effectiveContentType, encodedByteSize: finalData.length };
  }

  try {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, blob, {
        contentType: effectiveContentType,
        cacheControl: '31536000',
        upsert: false,
      });

    const isDuplicateUpload = Boolean(uploadError && /already exists|duplicate|resource.*exists/i.test(uploadError.message));
    if (uploadError && !isDuplicateUpload) throw uploadError;

    if (isDuplicateUpload) {
      const { data: existing, error: existingError } = await supabase
        .from('board_assets')
        .select('asset_id,mime_type,encoded_byte_size,width,height')
        .eq('board_id', boardId)
        .eq('content_hash', contentHash)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        hashToAssetIdMap.set(hashKey, existing.asset_id);
        trackOperation('read', 'supabase-asset-dedup-hit', 1);
        return {
          assetId: existing.asset_id,
          mimeType: existing.mime_type,
          encodedByteSize: Number(existing.encoded_byte_size || 0),
          width: existing.width || undefined,
          height: existing.height || undefined,
        };
      }
    }

    const metadataRow = {
      board_id: boardId,
      asset_id: assetId,
      mime_type: effectiveContentType,
      object_path: objectPath,
      encoded_byte_size: finalData.length,
      original_byte_size: blob.size,
      width: null,
      height: null,
      content_hash: contentHash,
      created_at: createdAt,
      created_by: createdBy || null,
    };
    const { error: metadataError } = await supabase.from('board_assets').insert(metadataRow);
    if (metadataError) {
      const { data: existing } = await supabase
        .from('board_assets')
        .select('asset_id,mime_type,encoded_byte_size,width,height')
        .eq('board_id', boardId)
        .eq('content_hash', contentHash)
        .maybeSingle();
      if (existing) {
        hashToAssetIdMap.set(hashKey, existing.asset_id);
        return {
          assetId: existing.asset_id,
          mimeType: existing.mime_type,
          encodedByteSize: Number(existing.encoded_byte_size || 0),
          width: existing.width || undefined,
          height: existing.height || undefined,
        };
      }
      if (!isDuplicateUpload) await supabase.storage.from(BUCKET).remove([objectPath]);
      throw metadataError;
    }

    trackOperation('write', 'supabase-storage-upload', 1);
    trackOperation('write', 'supabase-asset-metadata', 1);
    assetCacheMap.set(cacheKey, assetDoc);
    hashToAssetIdMap.set(hashKey, assetId);
    return { assetId, mimeType: effectiveContentType, encodedByteSize: finalData.length };
  } catch (error) {
    assetCacheMap.delete(cacheKey);
    hashToAssetIdMap.delete(hashKey);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save asset: ${message}`);
  }
}

export async function getBoardAsset(boardId: string, assetId: string): Promise<BoardAssetDoc | null> {
  const cacheKey = `${boardId}:${assetId}`;
  const cached = assetCacheMap.get(cacheKey);
  if (cached) return cached;
  const inFlight = inFlightAssetRequests.get(cacheKey);
  if (inFlight) return inFlight;
  if (isSandboxEnvironment()) return null;

  const request = (async () => {
    try {
      const { data: metadata, error: metadataError } = await supabase
        .from('board_assets')
        .select('*')
        .eq('board_id', boardId)
        .eq('asset_id', assetId)
        .maybeSingle();
      if (metadataError) throw metadataError;
      if (!metadata) return null;

      const { data: blob, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(metadata.object_path);
      if (downloadError) throw downloadError;

      const dataUrl = await blobToDataUrl(blob);
      const document = metadataToAssetDoc(metadata, dataUrl);
      assetCacheMap.set(cacheKey, document);
      hashToAssetIdMap.set(`${boardId}:${document.contentHash}`, assetId);
      trackOperation('read', 'supabase-asset-metadata-read', 1);
      trackOperation('read', 'supabase-storage-download', 1);
      return document;
    } catch (error) {
      console.error(`Error loading asset ${assetId}:`, error);
      return null;
    } finally {
      inFlightAssetRequests.delete(cacheKey);
    }
  })();

  inFlightAssetRequests.set(cacheKey, request);
  return request;
}

export async function deleteAssetFromStorage(
  boardId: string,
  assetId: string,
  activeElementAssetIds?: Set<string>
): Promise<void> {
  if (!assetId || isSandboxEnvironment()) return;
  if (activeElementAssetIds?.has(assetId)) return;

  const cacheKey = `${boardId}:${assetId}`;
  const cached = assetCacheMap.get(cacheKey);
  if (cached?.contentHash) hashToAssetIdMap.delete(`${boardId}:${cached.contentHash}`);
  assetCacheMap.delete(cacheKey);

  const { data: metadata, error: metadataError } = await supabase
    .from('board_assets')
    .select('object_path,content_hash')
    .eq('board_id', boardId)
    .eq('asset_id', assetId)
    .maybeSingle();
  if (metadataError) throw new Error(metadataError.message);

  if (metadata?.object_path) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([metadata.object_path]);
    if (removeError) throw new Error(removeError.message);
  }

  const { error: deleteError } = await supabase
    .from('board_assets')
    .delete()
    .eq('board_id', boardId)
    .eq('asset_id', assetId);
  if (deleteError) throw new Error(deleteError.message);
  trackOperation('delete', 'supabase-asset-delete', 1);
}

export async function deleteAllBoardAssets(boardId: string): Promise<void> {
  if (isSandboxEnvironment()) return;
  const { data, error } = await supabase
    .from('board_assets')
    .select('object_path')
    .eq('board_id', boardId);
  if (error) throw new Error(error.message);
  const paths = (data || []).map((row) => row.object_path).filter(Boolean);
  for (let index = 0; index < paths.length; index += 100) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths.slice(index, index + 100));
    if (removeError) throw new Error(removeError.message);
  }
  clearAssetCache(boardId);
}

export function clearAssetCache(boardId?: string): void {
  if (!boardId) {
    assetCacheMap.clear();
    hashToAssetIdMap.clear();
    inFlightAssetRequests.clear();
    return;
  }

  for (const key of Array.from(assetCacheMap.keys())) {
    if (key.startsWith(`${boardId}:`)) assetCacheMap.delete(key);
  }
  for (const key of Array.from(hashToAssetIdMap.keys())) {
    if (key.startsWith(`${boardId}:`)) hashToAssetIdMap.delete(key);
  }
  for (const key of Array.from(inFlightAssetRequests.keys())) {
    if (key.startsWith(`${boardId}:`)) inFlightAssetRequests.delete(key);
  }
}
