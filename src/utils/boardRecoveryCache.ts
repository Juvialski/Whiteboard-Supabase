import {
  del as idbDel,
  get as idbGet,
  keys as idbKeys,
  set as idbSet,
} from 'idb-keyval';
import type { BoardElement } from '../types';

const RECOVERY_PREFIX_V2 = 'whiteboard_recovery_v2_';
const PENDING_PREFIX_V2 = 'supabase_pending_mutations_v2_';
const LEGACY_IDB_PREFIX = 'whiteboard_recovery_v1_';
const LEGACY_CLOUD_PREFIX = 'whiteboard_elements_';
const LEGACY_SANDBOX_PREFIX = 'lucid_spark_board_elements_';
const SAVE_DELAY_MS = 700;

interface RecoveryEnvelope {
  version: 2;
  savedAt: number;
  elements: BoardElement[];
}

let projectScope = 'unconfigured';
let userScope: string | null = null;

const pendingValues = new Map<string, BoardElement[]>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function safeScopePart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase()).slice(0, 240);
}

export function deriveBoardRecoveryProjectScope(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const projectRef = host.split('.')[0] || host;
    return safeScopePart(projectRef || 'unconfigured');
  } catch {
    return safeScopePart(url || 'unconfigured');
  }
}

export function setBoardRecoveryProjectScope(scope: string): void {
  projectScope = safeScopePart(scope || 'unconfigured');
}

export function setBoardRecoveryUserScope(userId: string | null): void {
  userScope = userId ? safeScopePart(userId) : null;
}

export function clearBoardRecoveryIdentity(): void {
  userScope = null;
}

export function getScopedBoardCacheKey(
  category: 'recovery' | 'pending',
  boardId: string
): string | null {
  if (!userScope || !boardId) return null;
  const prefix = category === 'recovery' ? RECOVERY_PREFIX_V2 : PENDING_PREFIX_V2;
  return `${prefix}${projectScope}_${userScope}_${safeScopePart(boardId)}`;
}

function legacyRecoveryKey(boardId: string): string {
  return `${LEGACY_IDB_PREFIX}${boardId}`;
}

function isBoardElement(value: unknown): value is BoardElement {
  if (!value || typeof value !== 'object') return false;
  const element = value as { id?: unknown; type?: unknown };
  return typeof element.id === 'string' && typeof element.type === 'string';
}

function normalizeRecoveryValue(value: unknown): BoardElement[] {
  if (Array.isArray(value)) return value.filter(isBoardElement);
  if (value && typeof value === 'object') {
    const envelope = value as Partial<RecoveryEnvelope>;
    if (Array.isArray(envelope.elements)) return envelope.elements.filter(isBoardElement);
  }
  return [];
}

export async function loadBoardRecoveryCache(boardId: string): Promise<BoardElement[]> {
  const key = getScopedBoardCacheKey('recovery', boardId);
  if (!key) return [];
  try {
    return normalizeRecoveryValue(await idbGet<unknown>(key));
  } catch (error) {
    console.warn('Unable to read the IndexedDB board recovery cache.', error);
    return [];
  }
}

/**
 * Removes old full-board recovery snapshots only after the current account has
 * successfully been authorized to read the board. Cloud persistence now keeps
 * only unsynced mutation queues; replaying an old complete snapshot could
 * overwrite newer collaborator work.
 */
export async function discardLegacyBoardRecoveryForAuthorizedUser(boardId: string): Promise<void> {
  const scopedKey = getScopedBoardCacheKey('recovery', boardId);
  try {
    for (const key of [scopedKey, legacyRecoveryKey(boardId)].filter((value): value is string => Boolean(value))) {
      const timer = pendingTimers.get(key);
      if (timer) clearTimeout(timer);
      pendingTimers.delete(key);
      pendingValues.delete(key);
      await idbDel(key).catch(() => undefined);
    }
  } catch (error) {
    console.warn('Unable to discard the legacy full-board recovery cache.', error);
  }
}

export function scheduleBoardRecoveryCacheSave(boardId: string, elements: BoardElement[]): void {
  const key = getScopedBoardCacheKey('recovery', boardId);
  if (!key) return;

  pendingValues.set(key, elements);
  const existingTimer = pendingTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    const latest = pendingValues.get(key);
    pendingValues.delete(key);
    if (!latest) return;
    const envelope: RecoveryEnvelope = { version: 2, savedAt: Date.now(), elements: latest };
    void idbSet(key, envelope).catch((error) => {
      console.warn('Unable to update the IndexedDB board recovery cache.', error);
    });
  }, SAVE_DELAY_MS);

  pendingTimers.set(key, timer);
}

export async function flushBoardRecoveryCache(boardId: string): Promise<void> {
  const key = getScopedBoardCacheKey('recovery', boardId);
  if (!key) return;

  const timer = pendingTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(key);
  }

  const latest = pendingValues.get(key);
  pendingValues.delete(key);
  if (latest) {
    const envelope: RecoveryEnvelope = { version: 2, savedAt: Date.now(), elements: latest };
    await idbSet(key, envelope);
  }
}

export async function deleteBoardRecoveryCache(boardId: string): Promise<void> {
  const scopedRecoveryKey = getScopedBoardCacheKey('recovery', boardId);
  const scopedPendingKey = getScopedBoardCacheKey('pending', boardId);

  for (const key of [scopedRecoveryKey, scopedPendingKey].filter((value): value is string => Boolean(value))) {
    const timer = pendingTimers.get(key);
    if (timer) clearTimeout(timer);
    pendingTimers.delete(key);
    pendingValues.delete(key);
    await idbDel(key).catch(() => undefined);
  }

  await idbDel(legacyRecoveryKey(boardId)).catch(() => undefined);
  await idbDel(`supabase_pending_mutations_${boardId}`).catch(() => undefined);

  if (typeof window !== 'undefined') {
    localStorage.removeItem(`${LEGACY_CLOUD_PREFIX}${boardId}`);
    localStorage.removeItem(`${LEGACY_SANDBOX_PREFIX}${boardId}`);
  }
}

export async function hasCurrentUserPendingMutationCaches(): Promise<boolean> {
  if (!userScope) return false;
  const suffixPrefix = `${projectScope}_${userScope}_`;
  const belongsToCurrentUserPending = (key: string): boolean =>
    key.startsWith(PENDING_PREFIX_V2) &&
    key.slice(key.indexOf('_v2_') + 4).startsWith(suffixPrefix);

  const keys = await idbKeys().catch(() => []);
  for (const key of keys) {
    if (typeof key !== 'string' || !belongsToCurrentUserPending(key)) continue;
    const value = await idbGet<unknown>(key).catch(() => null);
    if (Array.isArray(value) && value.length > 0) return true;
  }
  return false;
}

export async function clearCurrentUserBoardRecoveryCaches(): Promise<void> {
  if (!userScope) return;
  const suffixPrefix = `${projectScope}_${userScope}_`;
  const belongsToCurrentUser = (key: string): boolean =>
    (key.startsWith(RECOVERY_PREFIX_V2) || key.startsWith(PENDING_PREFIX_V2)) &&
    key.slice(key.indexOf('_v2_') + 4).startsWith(suffixPrefix);

  // Cancel delayed writes before deleting IndexedDB rows. Otherwise a recovery
  // timer could recreate the old account's cache after sign-out completes.
  for (const key of Array.from(pendingTimers.keys())) {
    if (!belongsToCurrentUser(key)) continue;
    clearTimeout(pendingTimers.get(key));
    pendingTimers.delete(key);
    pendingValues.delete(key);
  }

  const keys = await idbKeys().catch(() => []);
  await Promise.all(keys
    .filter((key): key is string => typeof key === 'string' && belongsToCurrentUser(key))
    .map((key) => idbDel(key).catch(() => undefined)));
}

/**
 * Moves old full-board localStorage snapshots to a quarantined legacy IndexedDB
 * key. The key is migrated into the current user's namespace only after board
 * authorization succeeds.
 */
export async function migrateLegacyBoardCachesToIndexedDb(): Promise<void> {
  if (typeof window === 'undefined') return;

  const preserveSandboxCaches = localStorage.getItem('WHITEBOARD_LOCAL_SANDBOX') === 'true';
  const candidates: Array<{ key: string; boardId: string }> = [];
  const staleOAuthFlowKeys: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;

    if (key.includes('-auth-token-flow-')) {
      staleOAuthFlowKeys.push(key);
      continue;
    }

    if (key.startsWith(LEGACY_CLOUD_PREFIX)) {
      candidates.push({ key, boardId: key.slice(LEGACY_CLOUD_PREFIX.length) });
      continue;
    }

    if (!preserveSandboxCaches && key.startsWith(LEGACY_SANDBOX_PREFIX)) {
      candidates.push({ key, boardId: key.slice(LEGACY_SANDBOX_PREFIX.length) });
    }
  }

  staleOAuthFlowKeys.forEach((key) => localStorage.removeItem(key));

  for (const candidate of candidates) {
    try {
      const raw = localStorage.getItem(candidate.key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          await idbSet(legacyRecoveryKey(candidate.boardId), parsed.filter(isBoardElement));
        }
      }
    } catch (error) {
      console.warn(`Unable to quarantine legacy board cache ${candidate.key}.`, error);
    } finally {
      localStorage.removeItem(candidate.key);
    }
  }
}

/** Synchronous emergency cleanup used only when an auth storage write hits quota. */
export function evictLegacyBoardCachesFromLocalStorage(): void {
  if (typeof window === 'undefined') return;
  const keys: string[] = [];
  const preserveSandboxCaches = localStorage.getItem('WHITEBOARD_LOCAL_SANDBOX') === 'true';

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key.includes('-auth-token-flow-')) keys.push(key);
    if (key.startsWith(LEGACY_CLOUD_PREFIX)) keys.push(key);
    if (!preserveSandboxCaches && key.startsWith(LEGACY_SANDBOX_PREFIX)) keys.push(key);
  }

  keys.forEach((key) => localStorage.removeItem(key));
}
