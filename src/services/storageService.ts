import { auth, supabase } from '../supabase';
import { isSandboxEnvironment } from '../utils/sandboxGuard';
import { trackOperation } from '../utils/databaseInstrumentation';

export interface BoardAssetDoc {
  assetId: string;
  encoding: 'url' | 'base64';
  mimeType: string;
  /** Self-contained data URL. Binary media is never written back into board shards. */
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

export type AssetLoadErrorCode =
  | 'invalid_metadata'
  | 'metadata_query_failed'
  | 'storage_download_failed'
  | 'mime_mismatch'
  | 'decode_failed';

export class AssetLoadError extends Error {
  constructor(
    public readonly code: AssetLoadErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AssetLoadError';
  }
}

interface CachedAssetEntry {
  boardId: string;
  userScope: string;
  assetId: string;
  document: BoardAssetDoc;
  byteSize: number;
  lastAccessedAt: number;
}

interface InFlightAssetEntry {
  boardId: string;
  userScope: string;
  promise: Promise<BoardAssetDoc | null>;
}

const BUCKET = 'board-assets';
const KEY_SEPARATOR = '\u001f';
const assetCacheMap = new Map<string, CachedAssetEntry>();
const hashToAssetIdMap = new Map<string, string>();
const inFlightAssetRequests = new Map<string, InFlightAssetEntry>();
let totalAssetCacheBytes = 0;
let assetCacheEpoch = 0;
const boardCacheEpochs = new Map<string, number>();

export const MAX_ASSET_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_SAFE_ASSET_BYTES = MAX_ASSET_DOCUMENT_BYTES;
/** Conservative memory budget for cached data URLs. Already-rendered images remain valid after eviction. */
export const MAX_ASSET_CACHE_BYTES = 64 * 1024 * 1024;

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

function currentAssetUserScope(): string {
  return encodeURIComponent(auth.currentUser?.uid || 'no-auth-user');
}

function cacheKeyFor(boardId: string, assetId: string, userScope = currentAssetUserScope()): string {
  return [userScope, boardId, assetId].join(KEY_SEPARATOR);
}

function hashCacheKey(boardId: string, contentHash: string, userScope = currentAssetUserScope()): string {
  return [userScope, boardId, contentHash].join(KEY_SEPARATOR);
}

function boardEpoch(boardId: string): number {
  return boardCacheEpochs.get(boardId) || 0;
}

function approximateDataUrlMemoryBytes(data: string, originalByteSize?: number): number {
  // JS string storage varies by engine. Two bytes/character is a deliberately
  // conservative estimate and prevents the cache from growing unbounded on phones.
  return Math.max(originalByteSize || 0, data.length * 2);
}

function removeCacheEntry(key: string): void {
  const existing = assetCacheMap.get(key);
  if (!existing) return;
  assetCacheMap.delete(key);
  totalAssetCacheBytes = Math.max(0, totalAssetCacheBytes - existing.byteSize);
}

function evictLeastRecentlyUsed(protectedKey?: string): void {
  if (totalAssetCacheBytes <= MAX_ASSET_CACHE_BYTES) return;

  const candidates = Array.from(assetCacheMap.entries())
    .filter(([key]) => key !== protectedKey)
    .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

  for (const [key] of candidates) {
    removeCacheEntry(key);
    if (totalAssetCacheBytes <= MAX_ASSET_CACHE_BYTES) break;
  }
}

function cacheAsset(boardId: string, document: BoardAssetDoc, byteSize?: number): BoardAssetDoc {
  const key = cacheKeyFor(boardId, document.assetId);
  if (assetCacheMap.has(key)) removeCacheEntry(key);

  const estimatedBytes = Math.max(
    0,
    byteSize ?? approximateDataUrlMemoryBytes(document.data, document.originalByteSize),
  );
  assetCacheMap.set(key, {
    boardId,
    userScope: currentAssetUserScope(),
    assetId: document.assetId,
    document,
    byteSize: estimatedBytes,
    lastAccessedAt: Date.now(),
  });
  totalAssetCacheBytes += estimatedBytes;
  evictLeastRecentlyUsed(key);
  return document;
}

function getCachedAsset(boardId: string, assetId: string): BoardAssetDoc | null {
  const entry = assetCacheMap.get(cacheKeyFor(boardId, assetId));
  if (!entry) return null;
  entry.lastAccessedAt = Date.now();
  return entry.document;
}

function removeAssetFromAllCaches(boardId: string, assetId: string): void {
  for (const [key, entry] of Array.from(assetCacheMap.entries())) {
    if (entry.boardId === boardId && entry.assetId === assetId) removeCacheEntry(key);
  }
}

// Compatibility with export/media code written during the object-URL experiment.
// Data URLs remain valid after cache eviction, so mounted components do not need
// reference counting and these functions intentionally do nothing.
export function retainBoardAsset(_boardId: string, _assetId: string): void {}
export function releaseBoardAsset(_boardId: string, _assetId: string): void {}

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
      const result = compressed.length < base64DataUrl.length ? compressed : base64DataUrl;
      // Release the large backing buffer as soon as the compressed string exists.
      canvas.width = 1;
      canvas.height = 1;
      resolve(result);
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
  // Do not use fetch(dataUrl). Production CSP intentionally limits connect-src.
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('The selected media file is not a valid data URL.');
  }

  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 5) throw new Error('The selected media file has an invalid data URL.');

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

    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  } catch {
    throw new Error('Unable to decode the selected media file.');
  }
}

function startsWithBytes(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

async function assertBlobMatchesMime(blob: Blob, mimeType: string): Promise<void> {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = new TextDecoder('ascii').decode(bytes);
  let valid = false;

  switch (mimeType) {
    case 'image/png':
      valid = startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      break;
    case 'image/jpeg':
      valid = startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
      break;
    case 'image/gif':
      valid = ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
      break;
    case 'image/webp':
      valid = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
      break;
    case 'application/pdf':
      valid = ascii.startsWith('%PDF-');
      break;
    case 'audio/wav':
      valid = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
      break;
    case 'audio/ogg':
      valid = ascii.startsWith('OggS');
      break;
    case 'audio/webm':
      valid = startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
      break;
    case 'audio/mpeg':
      valid = ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
      break;
    default:
      valid = false;
  }

  if (!valid) throw new Error(`The file contents do not match ${mimeType}.`);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      if (!value.startsWith('data:')) {
        reject(new Error('Downloaded media could not be converted to a data URL.'));
        return;
      }
      resolve(value);
    };
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

function cacheDataUrlAsset(boardId: string, row: any, dataUrl: string, originalByteSize?: number): BoardAssetDoc {
  const document = metadataToAssetDoc(row, dataUrl);
  return cacheAsset(
    boardId,
    document,
    approximateDataUrlMemoryBytes(dataUrl, originalByteSize ?? document.originalByteSize),
  );
}

export async function saveBoardAsset(
  boardId: string,
  providedAssetId: string | undefined,
  base64DataUrl: string,
  contentType: string = 'image/png',
  userId?: string
): Promise<SavedAssetMeta> {
  let finalData = base64DataUrl;
  if (contentType.startsWith('image/') && contentType !== 'image/gif' && contentType !== 'image/webp') {
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
  await assertBlobMatchesMime(blob, effectiveContentType);

  const contentHash = await computeSHA256Hash(finalData);
  const hashKey = hashCacheKey(boardId, contentHash);
  const cachedId = hashToAssetIdMap.get(hashKey);
  if (cachedId) {
    const cached = getCachedAsset(boardId, cachedId);
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

  if (isSandboxEnvironment()) {
    cacheDataUrlAsset(boardId, metadataRow, finalData, blob.size);
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
        .select('*')
        .eq('board_id', boardId)
        .eq('content_hash', contentHash)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        hashToAssetIdMap.set(hashKey, existing.asset_id);
        cacheDataUrlAsset(boardId, existing, finalData, blob.size);
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

    const { error: metadataError } = await supabase.from('board_assets').insert(metadataRow);
    if (metadataError) {
      const { data: existing } = await supabase
        .from('board_assets')
        .select('*')
        .eq('board_id', boardId)
        .eq('content_hash', contentHash)
        .maybeSingle();
      if (existing) {
        // If this caller used a different asset ID for content that already exists,
        // remove the just-uploaded orphan and use the canonical metadata row.
        if (!isDuplicateUpload && existing.object_path !== objectPath) {
          await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => undefined);
        }
        hashToAssetIdMap.set(hashKey, existing.asset_id);
        cacheDataUrlAsset(boardId, existing, finalData, blob.size);
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
    cacheDataUrlAsset(boardId, metadataRow, finalData, blob.size);
    hashToAssetIdMap.set(hashKey, assetId);
    return { assetId, mimeType: effectiveContentType, encodedByteSize: finalData.length };
  } catch (error) {
    removeAssetFromAllCaches(boardId, assetId);
    hashToAssetIdMap.delete(hashKey);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save asset: ${message}`);
  }
}

export async function getBoardAsset(boardId: string, assetId: string): Promise<BoardAssetDoc | null> {
  const cacheKey = cacheKeyFor(boardId, assetId);
  const cached = getCachedAsset(boardId, assetId);
  if (cached) return cached;

  const inFlight = inFlightAssetRequests.get(cacheKey);
  if (inFlight) return inFlight.promise;
  if (isSandboxEnvironment()) return null;

  const requestEpoch = assetCacheEpoch;
  const requestBoardEpoch = boardEpoch(boardId);
  const requestUserScope = currentAssetUserScope();
  let request!: Promise<BoardAssetDoc | null>;
  request = (async () => {
    try {
      const { data: metadata, error: metadataError } = await supabase
        .from('board_assets')
        .select('*')
        .eq('board_id', boardId)
        .eq('asset_id', assetId)
        .maybeSingle();
      if (metadataError) {
        throw new AssetLoadError('metadata_query_failed', `Unable to read metadata for asset ${assetId}.`, metadataError);
      }
      if (!metadata) return null;

      const mimeType = String(metadata.mime_type || '').toLowerCase().split(';')[0].trim();
      if (!metadata.object_path || !ALLOWED_ASSET_MIME_TYPES.has(mimeType)) {
        throw new AssetLoadError('invalid_metadata', `Asset ${assetId} has invalid Storage metadata.`);
      }

      const { data: blob, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(metadata.object_path);
      if (downloadError || !blob) {
        throw new AssetLoadError('storage_download_failed', `Unable to download asset ${assetId} from Storage.`, downloadError);
      }
      if (blob.size > MAX_SAFE_ASSET_BYTES) {
        throw new AssetLoadError('invalid_metadata', `Asset ${assetId} exceeds the 20 MB media limit.`);
      }

      try {
        await assertBlobMatchesMime(blob, mimeType);
      } catch (error) {
        throw new AssetLoadError('mime_mismatch', `Asset ${assetId} does not match its saved MIME type (${mimeType}).`, error);
      }

      // A board/account cache clear may have happened while Storage was downloading.
      // Never repopulate a newer identity's cache with an older request.
      if (
        requestEpoch !== assetCacheEpoch ||
        requestBoardEpoch !== boardEpoch(boardId) ||
        requestUserScope !== currentAssetUserScope()
      ) {
        return null;
      }

      let dataUrl: string;
      try {
        dataUrl = await blobToDataUrl(blob);
      } catch (error) {
        throw new AssetLoadError('decode_failed', `Unable to decode asset ${assetId} for display.`, error);
      }

      const document = cacheDataUrlAsset(boardId, metadata, dataUrl, blob.size);
      hashToAssetIdMap.set(hashCacheKey(boardId, document.contentHash), assetId);
      trackOperation('read', 'supabase-asset-metadata-read', 1);
      trackOperation('read', 'supabase-storage-download', 1);
      return document;
    } catch (error) {
      if (error instanceof AssetLoadError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new AssetLoadError('storage_download_failed', `Unable to load asset ${assetId}: ${message}`, error);
    } finally {
      const current = inFlightAssetRequests.get(cacheKey);
      if (current?.promise === request) inFlightAssetRequests.delete(cacheKey);
    }
  })();

  inFlightAssetRequests.set(cacheKey, {
    boardId,
    userScope: requestUserScope,
    promise: request,
  });
  return request;
}

export async function deleteAssetFromStorage(
  boardId: string,
  assetId: string,
  activeElementAssetIds?: Set<string>
): Promise<void> {
  if (!assetId || isSandboxEnvironment()) return;
  if (activeElementAssetIds?.has(assetId)) return;

  const cached = getCachedAsset(boardId, assetId);
  if (cached?.contentHash) hashToAssetIdMap.delete(hashCacheKey(boardId, cached.contentHash));
  removeAssetFromAllCaches(boardId, assetId);

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

export async function deleteAllBoardAssets(boardId: string): Promise<number> {
  if (isSandboxEnvironment()) return 0;
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
  return paths.length;
}

export function clearAssetCache(boardId?: string): void {
  if (!boardId) {
    assetCacheEpoch += 1;
    boardCacheEpochs.clear();
    assetCacheMap.clear();
    totalAssetCacheBytes = 0;
    hashToAssetIdMap.clear();
    inFlightAssetRequests.clear();
    return;
  }

  boardCacheEpochs.set(boardId, boardEpoch(boardId) + 1);
  for (const [key, entry] of Array.from(assetCacheMap.entries())) {
    if (entry.boardId === boardId) removeCacheEntry(key);
  }
  for (const key of Array.from(hashToAssetIdMap.keys())) {
    const [, keyBoardId] = key.split(KEY_SEPARATOR);
    if (keyBoardId === boardId) hashToAssetIdMap.delete(key);
  }
  for (const [key, entry] of Array.from(inFlightAssetRequests.entries())) {
    if (entry.boardId === boardId) inFlightAssetRequests.delete(key);
  }
}

/** Exposed for diagnostics and regression tests. */
export function getAssetCacheStats(): { entries: number; bytes: number; maxBytes: number } {
  return {
    entries: assetCacheMap.size,
    bytes: totalAssetCacheBytes,
    maxBytes: MAX_ASSET_CACHE_BYTES,
  };
}
