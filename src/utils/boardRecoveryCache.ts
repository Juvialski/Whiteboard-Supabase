import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type { BoardElement } from '../types';

const IDB_PREFIX = 'whiteboard_recovery_v1_';
const LEGACY_CLOUD_PREFIX = 'whiteboard_elements_';
const LEGACY_SANDBOX_PREFIX = 'lucid_spark_board_elements_';
const SAVE_DELAY_MS = 700;

const pendingValues = new Map<string, BoardElement[]>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cacheKey(boardId: string): string {
  return `${IDB_PREFIX}${boardId}`;
}

function isBoardElement(value: unknown): value is BoardElement {
  if (!value || typeof value !== 'object') return false;
  const element = value as { id?: unknown; type?: unknown };
  return typeof element.id === 'string' && typeof element.type === 'string';
}

export async function loadBoardRecoveryCache(boardId: string): Promise<BoardElement[]> {
  try {
    const value = await idbGet<unknown>(cacheKey(boardId));
    return Array.isArray(value) ? value.filter(isBoardElement) : [];
  } catch (error) {
    console.warn('Unable to read the IndexedDB board recovery cache.', error);
    return [];
  }
}

export function scheduleBoardRecoveryCacheSave(boardId: string, elements: BoardElement[]): void {
  pendingValues.set(boardId, elements);

  const existingTimer = pendingTimers.get(boardId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    pendingTimers.delete(boardId);
    const latest = pendingValues.get(boardId);
    pendingValues.delete(boardId);
    if (!latest) return;
    void idbSet(cacheKey(boardId), latest).catch((error) => {
      console.warn('Unable to update the IndexedDB board recovery cache.', error);
    });
  }, SAVE_DELAY_MS);

  pendingTimers.set(boardId, timer);
}

export async function flushBoardRecoveryCache(boardId: string): Promise<void> {
  const timer = pendingTimers.get(boardId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(boardId);
  }

  const latest = pendingValues.get(boardId);
  pendingValues.delete(boardId);
  if (latest) await idbSet(cacheKey(boardId), latest);
}

export async function deleteBoardRecoveryCache(boardId: string): Promise<void> {
  const timer = pendingTimers.get(boardId);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(boardId);
  pendingValues.delete(boardId);
  await idbDel(cacheKey(boardId)).catch(() => undefined);

  if (typeof window !== 'undefined') {
    localStorage.removeItem(`${LEGACY_CLOUD_PREFIX}${boardId}`);
    localStorage.removeItem(`${LEGACY_SANDBOX_PREFIX}${boardId}`);
  }
}

/**
 * Moves old full-board localStorage snapshots to IndexedDB. Full board JSON can
 * exhaust the small synchronous localStorage quota and prevent Supabase PKCE
 * from saving its temporary OAuth code verifier.
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
          await idbSet(cacheKey(candidate.boardId), parsed.filter(isBoardElement));
        }
      }
    } catch (error) {
      console.warn(`Unable to migrate legacy board cache ${candidate.key}.`, error);
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
