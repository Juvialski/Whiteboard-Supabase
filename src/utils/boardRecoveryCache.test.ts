import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<IDBValidKey, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: IDBValidKey) => store.get(key)),
  set: vi.fn(async (key: IDBValidKey, value: unknown) => { store.set(key, value); }),
  del: vi.fn(async (key: IDBValidKey) => { store.delete(key); }),
  keys: vi.fn(async () => Array.from(store.keys())),
}));

import {
  clearCurrentUserBoardRecoveryCaches,
  getScopedBoardCacheKey,
  hasCurrentUserPendingMutationCaches,
  loadBoardRecoveryCache,
  discardLegacyBoardRecoveryForAuthorizedUser,
  scheduleBoardRecoveryCacheSave,
  setBoardRecoveryProjectScope,
  setBoardRecoveryUserScope,
  flushBoardRecoveryCache,
} from './boardRecoveryCache';
import type { BoardElement } from '../types';

const element: BoardElement = {
  id: 'drawing-1',
  type: 'drawing',
  points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
  color: '#000000',
  width: 2,
  isHighlighter: false,
  zIndex: 1,
};

describe('boardRecoveryCache account scoping', () => {
  beforeEach(() => {
    store.clear();
    setBoardRecoveryProjectScope('project-a');
    setBoardRecoveryUserScope(null);
  });

  it('does not create a cache key before an authenticated user is known', () => {
    expect(getScopedBoardCacheKey('recovery', 'board-1')).toBeNull();
  });

  it('isolates the same board between projects and users', () => {
    setBoardRecoveryUserScope('user-a');
    const first = getScopedBoardCacheKey('recovery', 'board-1');
    setBoardRecoveryUserScope('user-b');
    const second = getScopedBoardCacheKey('recovery', 'board-1');
    setBoardRecoveryProjectScope('project-b');
    const third = getScopedBoardCacheKey('recovery', 'board-1');

    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
  });

  it('persists and clears only the current user namespace', async () => {
    setBoardRecoveryUserScope('user-a');
    scheduleBoardRecoveryCacheSave('board-1', [element]);
    await flushBoardRecoveryCache('board-1');
    expect(await loadBoardRecoveryCache('board-1')).toEqual([element]);

    setBoardRecoveryUserScope('user-b');
    scheduleBoardRecoveryCacheSave('board-1', [{ ...element, id: 'drawing-2' }]);
    await flushBoardRecoveryCache('board-1');
    await clearCurrentUserBoardRecoveryCaches();
    expect(await loadBoardRecoveryCache('board-1')).toEqual([]);

    setBoardRecoveryUserScope('user-a');
    expect(await loadBoardRecoveryCache('board-1')).toEqual([element]);
  });
  it('discards legacy full-board snapshots after authorization instead of replaying stale state', async () => {
    store.set('whiteboard_recovery_v1_board-legacy', [element]);
    setBoardRecoveryUserScope('user-a');

    await discardLegacyBoardRecoveryForAuthorizedUser('board-legacy');
    expect(await loadBoardRecoveryCache('board-legacy')).toEqual([]);
    expect(store.has('whiteboard_recovery_v1_board-legacy')).toBe(false);
  });

  it('detects detached pending queues so sign-out does not erase unsynced work', async () => {
    setBoardRecoveryUserScope('user-a');
    const pendingKey = getScopedBoardCacheKey('pending', 'board-offline');
    expect(pendingKey).not.toBeNull();
    store.set(pendingKey!, [{ elementId: 'note-1', action: 'set' }]);
    expect(await hasCurrentUserPendingMutationCaches()).toBe(true);

    setBoardRecoveryUserScope('user-b');
    expect(await hasCurrentUserPendingMutationCaches()).toBe(false);
  });

});
