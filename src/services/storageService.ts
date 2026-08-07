import { auth, supabase } from '../supabase';
import { isSandboxEnvironment } from '../utils/sandboxGuard';
import { trackOperation } from '../utils/databaseInstrumentation';

export interface BoardAssetDoc {
  assetId: string;
  encoding: 'url' | 'base64';
  mimeType: string;
  /** Object URL for cached Storage blobs, or a data URL in sandbox/fallback mode. */
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


export interface BoardImageAssetMeta {
  assetId: string;
  mimeType: string;
  createdAt: number;
  objectPath: string;
  originalByteSize?: number;
}

export interface SavedAssetMeta {
  assetId: string;
  mimeType: string;
  encodedByteSize: number;
  width?: number;
  height?: number;
}

interface CachedAssetEntry {
  boardId: string;
  userScope: string;
  document: BoardAssetDoc;
  byteSize: number;
  lastAccessedAt: number;
  retainCount: number;
  revocable: boolean;
}

const BUCKET = 'board-assets';
const assetCacheMap = new Map<string, CachedAssetEntry>();
const hashToAssetIdMap = new Map<string, string>();
const inFlightAssetRequests = new Map<string, Promise<BoardAssetDoc | null>>();
let totalAssetCacheBytes = 0;
let assetCacheEpoch = 0;
const boardCacheEpochs = new Map<string, number>();
const boardImageAssetIndexCache = new Map<string, { fetchedAt: number; assets: BoardImageAssetMeta[] }>();
const BOARD_IMAGE_ASSET_INDEX_TTL_MS = 30_000;

export const MAX_ASSET_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_SAFE_ASSET_BYTES = MAX_ASSET_DOCUMENT_BYTES;
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
  return `${userScope}:${boardId}:${assetId}`;
}

function hashCacheKey(boardId: string, contentHash: string, userScope = currentAssetUserScope()): string {
  return `${userScope}:${boardId}:${contentHash}`;
}

function boardEpoch(boardId: string): number {
  return boardCacheEpochs.get(boardId) || 0;
}

function canUseObjectUrls(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

function revokeEntry(entry: CachedAssetEntry): void {
  if (entry.revocable && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(entry.document.data);
  }
}

function removeCacheEntry(key: string): void {
  const existing = assetCacheMap.get(key);
  if (!existing) return;
  assetCacheMap.delete(key);
  totalAssetCacheBytes = Math.max(0, totalAssetCacheBytes - existing.byteSize);
  revokeEntry(existing);
}

function evictUnretainedAssets(protectedKey?: string): void {
  if (totalAssetCacheBytes <= MAX_ASSET_CACHE_BYTES) return;

  const candidates = Array.from(assetCacheMap.entries())
    .filter(([key, entry]) => entry.retainCount === 0 && key !== protectedKey)
    .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

  for (const [key] of candidates) {
    removeCacheEntry(key);
    if (totalAssetCacheBytes <= MAX_ASSET_CACHE_BYTES) break;
  }
}

function cacheAsset(
  boardId: string,
  document: BoardAssetDoc,
  byteSize: number,
  revocable: boolean
): BoardAssetDoc {
  const key = cacheKeyFor(boardId, document.assetId);
  const existing = assetCacheMap.get(key);
  if (existing?.retainCount) {
    // Asset IDs are content-addressed and immutable. Keep the URL already in use
    // by mounted React components instead of revoking it underneath them.
    if (revocable && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(document.data);
    }
    existing.lastAccessedAt = Date.now();
    return existing.document;
  }
  const retained = existing?.retainCount || 0;
  if (existing) removeCacheEntry(key);

  assetCacheMap.set(key, {
    boardId,
    userScope: currentAssetUserScope(),
    document,
    byteSize: Math.max(0, byteSize),
    lastAccessedAt: Date.now(),
    retainCount: retained,
    revocable,
  });
  totalAssetCacheBytes += Math.max(0, byteSize);
  evictUnretainedAssets(key);
  return document;
}

function getCachedAsset(boardId: string, assetId: string): BoardAssetDoc | null {
  const entry = assetCacheMap.get(cacheKeyFor(boardId, assetId));
  if (!entry) return null;
  entry.lastAccessedAt = Date.now();
  return entry.document;
}

/** Prevents an object URL currently rendered by React from being evicted. */
export function retainBoardAsset(boardId: string, assetId: string): void {
  const entry = assetCacheMap.get(cacheKeyFor(boardId, assetId));
  if (!entry) return;
  entry.retainCount += 1;
  entry.lastAccessedAt = Date.now();
}

/** Releases a previously retained object URL and runs bounded LRU eviction. */
export function releaseBoardAsset(boardId: string, assetId: string): void {
  const entry = assetCacheMap.get(cacheKeyFor(boardId, assetId));
  if (!entry) return;
  entry.retainCount = Math.max(0, entry.retainCount - 1);
  entry.lastAccessedAt = Date.now();
  evictUnretainedAssets();
}

/**
 * Invalidates one cached asset so the next read is forced back to Storage.
 * This is used when the browser reports that an object URL can no longer be
 * decoded (for example after a revoked/stale blob URL).
 */
export function invalidateBoardAsset(boardId: string, assetId: string): void {
  if (!boardId || !assetId) return;
  const key = cacheKeyFor(boardId, assetId);
  const cached = assetCacheMap.get(key);
  if (cached?.document.contentHash) {
    hashToAssetIdMap.delete(hashCacheKey(boardId, cached.document.contentHash));
  }
  removeCacheEntry(key);
  inFlightAssetRequests.delete(key);
}

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

function detectAssetMime(bytes: Uint8Array): string | null {
  const ascii = new TextDecoder('ascii').decode(bytes);
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('%PDF-')) return 'application/pdf';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii.startsWith('OggS')) return 'audio/ogg';
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  if (ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
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

function createCachedSource(blob: Blob, fallbackDataUrl?: string): {
  data: string;
  encoding: 'url' | 'base64';
  revocable: boolean;
} {
  // Images used to render reliably as data URLs in this app. A later object-URL
  // cache refactor made Storage-backed images depend on browser blob URL
  // lifecycle/CSP behavior and caused both newly pasted and reloaded images to
  // fail in some production browsers. Prefer a self-contained data URL whenever
  // one is already available; the bounded LRU still limits memory use and the
  // value never gets written back into board shards.
  if (fallbackDataUrl?.startsWith('data:image/')) {
    return { data: fallbackDataUrl, encoding: 'base64', revocable: false };
  }
  if (canUseObjectUrls()) {
    return { data: URL.createObjectURL(blob), encoding: 'url', revocable: true };
  }
  if (fallbackDataUrl) return { data: fallbackDataUrl, encoding: 'base64', revocable: false };
  throw new Error('This browser cannot create a local media URL.');
}

async function blobToDataUrl(blob: Blob): Promise<string | undefined> {
  if (!blob.type.toLowerCase().startsWith('image/')) return undefined;
  if (typeof FileReader === 'undefined') return undefined;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      if (value.startsWith('data:image/')) resolve(value);
      else reject(new Error('The downloaded image could not be converted for display.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read the downloaded image.'));
    reader.readAsDataURL(blob);
  });
}

function metadataToAssetDoc(
  row: any,
  data: string,
  encoding: 'url' | 'base64'
): BoardAssetDoc {
  return {
    assetId: row.asset_id,
    encoding,
    mimeType: row.mime_type,
    data,
    encodedByteSize: Number(row.encoded_byte_size || row.original_byte_size || 0),
    originalByteSize: row.original_byte_size == null ? undefined : Number(row.original_byte_size),
    width: row.width == null ? undefined : Number(row.width),
    height: row.height == null ? undefined : Number(row.height),
    contentHash: row.content_hash,
    createdAt: Number(row.created_at || 0),
    createdBy: row.created_by || undefined,
    objectPath: row.object_path,
  };
}

async function normalizeDownloadedAssetBlob(blob: Blob, expectedMimeType: string): Promise<Blob> {
  if (!blob || blob.size <= 0) {
    throw new Error('Storage returned an empty asset.');
  }

  const normalizedMime = (expectedMimeType || blob.type || '').toLowerCase().split(';')[0].trim();
  let candidate = normalizedMime && blob.type !== normalizedMime
    ? blob.slice(0, blob.size, normalizedMime)
    : blob;

  if (!ALLOWED_ASSET_MIME_TYPES.has(normalizedMime)) return candidate;

  try {
    await assertBlobMatchesMime(candidate, normalizedMime);
    return candidate;
  } catch (signatureError) {
    // Older rows may have incorrect MIME metadata even though the object bytes
    // are still healthy. Detect the actual supported type before giving up.
    const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const detectedMime = detectAssetMime(header);
    if (detectedMime && ALLOWED_ASSET_MIME_TYPES.has(detectedMime)) {
      const recovered = blob.slice(0, blob.size, detectedMime);
      await assertBlobMatchesMime(recovered, detectedMime);
      return recovered;
    }

    // A few legacy deployments accidentally stored the complete data URL as
    // text instead of the decoded media bytes. Recover those objects in-memory
    // so old boards can still render without rewriting board data.
    if (blob.size <= MAX_SAFE_ASSET_BYTES) {
      try {
        const legacyText = (await blob.text()).trim();
        if (legacyText.startsWith('data:')) {
          const recovered = await dataUrlToBlob(legacyText);
          const recoveredMime = (recovered.type || normalizedMime).toLowerCase().split(';')[0].trim();
          if (ALLOWED_ASSET_MIME_TYPES.has(recoveredMime)) {
            await assertBlobMatchesMime(recovered, recoveredMime);
            return recovered;
          }
        }
      } catch {
        // Keep the original signature error below; it is more useful than a
        // secondary legacy-decoding failure.
      }
    }
    throw signatureError;
  }
}

function cacheLocalBlob(
  boardId: string,
  row: any,
  blob: Blob,
  fallbackDataUrl?: string
): BoardAssetDoc {
  const source = createCachedSource(blob, fallbackDataUrl);
  const document = metadataToAssetDoc(row, source.data, source.encoding);
  return cacheAsset(boardId, document, blob.size, source.revocable);
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
    cacheLocalBlob(boardId, metadataRow, blob, finalData);
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
        cacheLocalBlob(boardId, existing, blob, finalData);
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
        // A caller-provided asset ID can produce a different object path for
        // content that already has metadata. Remove that just-uploaded duplicate
        // before returning the canonical content-addressed asset.
        if (!isDuplicateUpload && existing.object_path !== objectPath) {
          await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => undefined);
        }
        hashToAssetIdMap.set(hashKey, existing.asset_id);
        cacheLocalBlob(boardId, existing, blob, finalData);
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
    cacheLocalBlob(boardId, metadataRow, blob, finalData);
    hashToAssetIdMap.set(hashKey, assetId);
    return { assetId, mimeType: effectiveContentType, encodedByteSize: finalData.length };
  } catch (error) {
    removeCacheEntry(cacheKeyFor(boardId, assetId));
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
  if (inFlight) return inFlight;
  if (isSandboxEnvironment()) return null;

  const requestEpoch = assetCacheEpoch;
  const requestBoardEpoch = boardEpoch(boardId);
  let request!: Promise<BoardAssetDoc | null>;
  request = (async () => {
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
      const normalizedBlob = await normalizeDownloadedAssetBlob(blob, metadata.mime_type);
      // Render downloaded images from a self-contained data URL. This avoids the
      // production-only object-URL failure that affected both teachers and
      // students while keeping Storage as the durable source of truth.
      const imageDataUrl = await blobToDataUrl(normalizedBlob);

      // An account/board cache clear may have happened while Storage was
      // downloading. Never let a completed request repopulate private media
      // into a newer identity's cache.
      if (requestEpoch !== assetCacheEpoch || requestBoardEpoch !== boardEpoch(boardId)) {
        return null;
      }

      const document = cacheLocalBlob(boardId, metadata, normalizedBlob, imageDataUrl);
      hashToAssetIdMap.set(hashCacheKey(boardId, document.contentHash), assetId);
      trackOperation('read', 'supabase-asset-metadata-read', 1);
      trackOperation('read', 'supabase-storage-download', 1);
      return document;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to load asset ${assetId}: ${message}`);
    } finally {
      // A cache clear can allow a newer request for the same asset to start while
      // this one is still finishing. Do not delete that newer in-flight entry.
      if (inFlightAssetRequests.get(cacheKey) === request) {
        inFlightAssetRequests.delete(cacheKey);
      }
    }
  })();

  inFlightAssetRequests.set(cacheKey, request);
  return request;
}

/**
 * Lists image assets already stored for a board. Used only to repair historical
 * image elements that lost their assetId while the Storage object still exists.
 * The result is cached briefly so a board with several broken images performs a
 * single metadata query instead of one query per image.
 */
export async function listBoardImageAssets(
  boardId: string,
  forceRefresh: boolean = false
): Promise<BoardImageAssetMeta[]> {
  if (!boardId || isSandboxEnvironment()) return [];
  const key = `${currentAssetUserScope()}:${boardId}`;
  const cached = boardImageAssetIndexCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < BOARD_IMAGE_ASSET_INDEX_TTL_MS) {
    return cached.assets;
  }

  const { data, error } = await supabase
    .from('board_assets')
    .select('asset_id,mime_type,created_at,object_path,original_byte_size')
    .eq('board_id', boardId)
    .like('mime_type', 'image/%')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Unable to list saved board images: ${error.message}`);

  const assets: BoardImageAssetMeta[] = (data || [])
    .filter((row: any) => row?.asset_id && row?.object_path)
    .map((row: any) => ({
      assetId: String(row.asset_id),
      mimeType: String(row.mime_type || 'image/png'),
      createdAt: Number(row.created_at || 0),
      objectPath: String(row.object_path),
      originalByteSize: row.original_byte_size == null ? undefined : Number(row.original_byte_size),
    }))
    .filter((row) => Number.isFinite(row.createdAt));

  boardImageAssetIndexCache.set(key, { fetchedAt: Date.now(), assets });
  trackOperation('read', 'supabase-board-image-asset-index', 1);
  return assets;
}

/**
 * Creates a short-lived direct Storage URL for an existing private board asset.
 * This is a rendering fallback only: the signed URL is never persisted into board
 * state. It bypasses local Blob/object-URL handling when a browser cannot render
 * an otherwise valid downloaded object.
 */
export async function getBoardAssetSignedUrl(
  boardId: string,
  assetId: string,
  expiresInSeconds: number = 10 * 60
): Promise<string | null> {
  if (!boardId || !assetId || isSandboxEnvironment()) return null;

  const { data: metadata, error: metadataError } = await supabase
    .from('board_assets')
    .select('object_path')
    .eq('board_id', boardId)
    .eq('asset_id', assetId)
    .maybeSingle();
  if (metadataError) throw new Error(`Unable to read asset metadata: ${metadataError.message}`);
  if (!metadata?.object_path) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(metadata.object_path, Math.max(60, Math.min(expiresInSeconds, 60 * 60)));
  if (error) throw new Error(`Unable to create direct asset URL: ${error.message}`);
  const signedUrl = data?.signedUrl?.trim();
  if (!signedUrl) return null;

  trackOperation('read', 'supabase-asset-signed-url', 1);
  return signedUrl;
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
  removeCacheEntry(cacheKeyFor(boardId, assetId));

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
    boardImageAssetIndexCache.clear();
    for (const key of Array.from(assetCacheMap.keys())) removeCacheEntry(key);
    hashToAssetIdMap.clear();
    inFlightAssetRequests.clear();
    return;
  }

  boardCacheEpochs.set(boardId, boardEpoch(boardId) + 1);
  const imageIndexPrefix = `${currentAssetUserScope()}:${boardId}`;
  boardImageAssetIndexCache.delete(imageIndexPrefix);
  for (const [key, entry] of Array.from(assetCacheMap.entries())) {
    if (entry.boardId === boardId) removeCacheEntry(key);
  }
  const currentPrefix = `${currentAssetUserScope()}:${boardId}:`;
  for (const key of Array.from(hashToAssetIdMap.keys())) {
    if (key.startsWith(currentPrefix)) hashToAssetIdMap.delete(key);
  }
  for (const key of Array.from(inFlightAssetRequests.keys())) {
    if (key.startsWith(currentPrefix)) inFlightAssetRequests.delete(key);
  }
}

/** Exposed only for tests and diagnostics. */
export function getAssetCacheStats(): { entries: number; bytes: number; maxBytes: number } {
  return {
    entries: assetCacheMap.size,
    bytes: totalAssetCacheBytes,
    maxBytes: MAX_ASSET_CACHE_BYTES,
  };
}
