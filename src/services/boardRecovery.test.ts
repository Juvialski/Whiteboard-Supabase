import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  store: new Map<string, any>(), set: vi.fn(), get: vi.fn(), del: vi.fn(), rpc: vi.fn(), from: vi.fn(),
  messages: new Map<string, (m: any) => void>(), statuses: new Map<string, (s: any) => void>(),
  authListeners: new Set<(event: string) => void>(),
}));
vi.mock('idb-keyval', () => ({ get: mock.get, set: mock.set, del: mock.del, keys: async () => [...mock.store.keys()] }));
vi.mock('../supabase', () => ({ auth: { currentUser: { uid: 'first' }, authStateReady: async () => {} }, authPersistenceReady: Promise.resolve(),
  supabase: { rpc: mock.rpc, from: mock.from, auth: { onAuthStateChange: (cb: any) => {
    mock.authListeners.add(cb); return { data: { subscription: { unsubscribe: () => mock.authListeners.delete(cb) } } };
  } } } }));
vi.mock('./storageService', () => ({ hydrateBoardAssetMetadata: vi.fn() }));
vi.mock('./boardSocketService', () => ({
  subscribeBoardSocketMessages: (id: string, cb: any) => { mock.messages.set(id, cb); return () => mock.messages.delete(id); },
  subscribeBoardSocketStatus: (id: string, cb: any) => { mock.statuses.set(id, cb); return () => mock.statuses.delete(id); },
  sendBoardSocketMessage: vi.fn(),
}));
import { subscribeToBoardState, queueElementMutation, flushBoardCheckpoint, flushAllBoardCheckpoints, disposeBoardPersistence,
  getPendingCheckpointBoardIds, getShardIdForElement, applyRemoteOperation } from './boardPersistence';
import { setBoardRecoveryProjectScope, setBoardRecoveryUserScope, getScopedBoardCacheKey, hasCurrentUserPendingMutationCaches } from '../utils/boardRecoveryCache';
const note = (id: string, text: string) => ({ id, type: 'text' as const, text, x: 0, y: 0, width: 100, height: 40, color: '#000', fontSize: 16, zIndex: 1 });
let cloudRevision = 1;
let cloudElements: any[] = [];
let states: any[] = [];
function cloudState(board: string) {
  const shards = new Map<string, any>();
  for (const el of cloudElements) {
    const id = getShardIdForElement(el.id);
    if (!shards.has(id)) shards.set(id, {});
    shards.get(id)[el.id] = el;
  }
  return { board: { id: board, current_revision: cloudRevision, effective_can_write: true, effective_can_manage: true },
    shards: [...shards].map(([shard_id, elements]) => ({ shard_id, elements })), assets: [] };
}
const ready = async (id = 'one') => {
  const unsubscribe = subscribeToBoardState(id, state => states.push(state));
  await vi.waitFor(() => expect(states.at(-1)?.loadState).toBe('ready'));
  return unsubscribe;
};
beforeEach(() => {
  vi.stubGlobal('indexedDB', {});
  mock.store.clear(); mock.rpc.mockReset(); mock.from.mockReset(); mock.set.mockReset(); mock.get.mockReset(); mock.del.mockReset();
  mock.get.mockImplementation(async key => mock.store.get(key));
  mock.set.mockImplementation(async (key, value) => { mock.store.set(key, structuredClone(value)); });
  mock.del.mockImplementation(async key => { mock.store.delete(key); });
  cloudRevision = 1; cloudElements = [note('remote', 'initial')]; states = [];
  setBoardRecoveryProjectScope('synthetic'); setBoardRecoveryUserScope('first');
  mock.rpc.mockImplementation(async (name, args) => {
    if (name === 'get_board_state') return { data: cloudState(args.p_board_id), error: null };
    const elements = Object.fromEntries(args.p_mutations.filter((p: any) => p.data).map((p: any) => [p.elementId, p.data]));
    return { data: { revision: ++cloudRevision, shards: { [getShardIdForElement(args.p_mutations[0].elementId)]: elements }, changedShardIds: [getShardIdForElement(args.p_mutations[0].elementId)], totalElements: Object.keys(elements).length }, error: null };
  });
  mock.from.mockImplementation(() => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { current_revision: cloudRevision, changed_shard_ids: [] }, error: null }),
    in: async () => ({ data: cloudState('one').shards, error: null }),
  }) }) }));
});
afterEach(() => { disposeBoardPersistence(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('durable mutation and board recovery', () => {
  it('reports pending before durable local save, and surfaces IndexedDB failure without discarding memory', async () => {
    await ready();
    const statuses: string[] = [];
    const listener = (event: Event) => statuses.push((event as CustomEvent).detail.status);
    window.addEventListener('lucid_spark_sync_status', listener);
    mock.set.mockRejectedValue(new Error('quota'));
    queueElementMutation('one', 'local', note('local', 'keep'));
    await vi.waitFor(() => expect(statuses).toContain('failed'));
    expect(statuses).toContain('pending-local'); expect(statuses).not.toContain('saved-local');
    expect(states.at(-1).elements.find((el: any) => el.id === 'local').text).toBe('keep');
    expect(getPendingCheckpointBoardIds()).toEqual(['one']);
    mock.set.mockImplementation(async (key, value) => mock.store.set(key, value));
    await flushBoardCheckpoint('one');
    expect(getPendingCheckpointBoardIds()).toEqual([]);
    window.removeEventListener('lucid_spark_sync_status', listener);
  });
  it('recovers missed revisions after reconnect and overlays unsynced local edits', async () => {
    await ready();
    queueElementMutation('one', 'local', note('local', 'unsynced'));
    mock.rpc.mockImplementation(async (name, args) => name === 'get_board_state'
      ? { data: cloudState(args.p_board_id), error: null } : { error: { message: 'offline' } });
    cloudRevision = 4; cloudElements = [note('remote', 'collaborator change'), note('local', 'older cloud')];
    mock.statuses.get('one')!({ authenticated: true, permission: 'owner', canWrite: true, canManage: true });
    await vi.waitFor(() => expect(states.at(-1).currentRevision).toBe(4));
    expect(states.at(-1).elements.find((el: any) => el.id === 'remote').text).toBe('collaborator change');
    expect(states.at(-1).elements.find((el: any) => el.id === 'local').text).toBe('unsynced');
    const calls = mock.rpc.mock.calls.filter(([name]) => name === 'get_board_state').length;
    mock.messages.get('one')!({ type: 'board_manifest_changed', boardId: 'one', revision: 2 });
    expect(mock.rpc.mock.calls.filter(([name]) => name === 'get_board_state')).toHaveLength(calls);
    applyRemoteOperation('one', { operationId: 'old', clientId: 'peer', baseRevision: 1, elementId: 'remote', action: 'set', data: note('remote', 'stale'), updatedAt: 1 });
    expect(states.at(-1).elements.find((el: any) => el.id === 'remote').text).toBe('collaborator change');
  });
  it('retains exhausted retries and resumes on network/auth recovery', async () => {
    await ready(); vi.useFakeTimers();
    mock.rpc.mockImplementation(async name => name === 'apply_board_mutations' ? { error: { message: 'offline' } } : { data: cloudState('one') });
    queueElementMutation('one', 'local', note('local', 'retry'));
    await vi.advanceTimersByTimeAsync(600000);
    expect(getPendingCheckpointBoardIds()).toEqual(['one']);
    expect(await hasCurrentUserPendingMutationCaches()).toBe(true);
    mock.rpc.mockImplementation(async name => name === 'apply_board_mutations'
      ? { data: { revision: 2, shards: { [getShardIdForElement('local')]: { local: note('local', 'retry') } } } }
      : { data: cloudState('one') });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(getPendingCheckpointBoardIds()).toEqual([]);
  });
  it('preserves newer local edits while a cloud save is in flight', async () => {
    await ready();
    let resolve!: (result: any) => void;
    mock.rpc.mockImplementation(() => new Promise(r => { resolve = r; }));
    queueElementMutation('one', 'local', note('local', 'first'));
    const saving = flushAllBoardCheckpoints('sign-out');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    queueElementMutation('one', 'local', note('local', 'second'));
    resolve({ data: { revision: 2, shards: { [getShardIdForElement('local')]: { local: note('local', 'first') } } } });
    expect((await saving).flushed).toBe(false);
    expect(getPendingCheckpointBoardIds()).toEqual(['one']);
    expect(states.at(-1).elements.find((el: any) => el.id === 'local').text).toBe('second');
    const pending = mock.store.get(getScopedBoardCacheKey('pending', 'one')!);
    expect(pending[0].data.text).toBe('second');
  });
  it('keeps pending queues isolated across reload, users, projects and boards', async () => {
    await ready();
    queueElementMutation('one', 'private', note('private', 'first account'));
    await vi.waitFor(() => expect(mock.store.get(getScopedBoardCacheKey('pending', 'one')!)?.length).toBe(1));
    disposeBoardPersistence(); states = [];
    setBoardRecoveryUserScope('second');
    await ready();
    expect(states.at(-1).elements.some((el: any) => el.id === 'private')).toBe(false);
    disposeBoardPersistence(); states = [];
    setBoardRecoveryUserScope('first'); setBoardRecoveryProjectScope('other-project');
    await ready();
    expect(states.at(-1).elements.some((el: any) => el.id === 'private')).toBe(false);
    disposeBoardPersistence(); states = [];
    setBoardRecoveryProjectScope('synthetic');
    await ready('two');
    expect(states.at(-1).elements.some((el: any) => el.id === 'private')).toBe(false);
    disposeBoardPersistence(); states = [];
    await ready();
    expect(states.at(-1).elements.find((el: any) => el.id === 'private').text).toBe('first account');
  });
  it('does not interpret unreadable recovery data as an empty queue', async () => {
    mock.get.mockRejectedValue(new Error('IndexedDB blocked'));
    subscribeToBoardState('one', state => states.push(state));
    await vi.waitFor(() => expect(states.at(-1).loadState).toBe('error'));
    expect(() => queueElementMutation('one', 'local', note('local', 'no overwrite'))).toThrow();
  });
});
