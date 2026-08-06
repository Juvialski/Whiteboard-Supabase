import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./realtimeAuth', () => ({
  getRealtimeAccessToken: vi.fn(async () => 'test-access-token'),
}));

class TrackingWebSocket {
  static instances: TrackingWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = TrackingWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    TrackingWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = TrackingWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    });
  }

  send(data: string): void { this.sent.push(data); }
  receive(message: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
  close(): void {
    this.readyState = TrackingWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

const originalWebSocket = global.WebSocket;

describe('boardSocketService connection sharing', () => {
  afterEach(async () => {
    const service = await import('./boardSocketService');
    service.closeAllBoardSockets();
    TrackingWebSocket.instances = [];
    global.WebSocket = originalWebSocket;
  });

  it('uses one physical WebSocket for multiple subscribers on the same board', async () => {
    global.WebSocket = TrackingWebSocket as unknown as typeof WebSocket;
    const service = await import('./boardSocketService');
    const unsubscribeMessages = service.subscribeBoardSocketMessages('board-1', () => undefined);
    const unsubscribeStatus = service.subscribeBoardSocketStatus('board-1', () => undefined);

    await vi.waitFor(() => expect(TrackingWebSocket.instances).toHaveLength(1));
    await vi.waitFor(() => expect(TrackingWebSocket.instances[0].sent).toHaveLength(1));
    expect(JSON.parse(TrackingWebSocket.instances[0].sent[0])).toEqual({
      type: 'authenticate',
      accessToken: 'test-access-token',
      boardId: 'board-1',
    });

    unsubscribeMessages();
    unsubscribeStatus();
  });
  it('queues durable messages until authentication and flushes them once', async () => {
    global.WebSocket = TrackingWebSocket as unknown as typeof WebSocket;
    const service = await import('./boardSocketService');
    const unsubscribe = service.subscribeBoardSocketMessages('board-queue', () => undefined);

    service.sendBoardSocketMessage('board-queue', {
      type: 'board_manifest_changed',
      revision: 4,
      changedShardIds: ['shard_1'],
      deletedShardIds: [],
      totalElements: 2,
      updatedAt: Date.now(),
    });

    await vi.waitFor(() => expect(TrackingWebSocket.instances).toHaveLength(1));
    const socket = TrackingWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.receive({
      type: 'authenticated',
      boardId: 'board-queue',
      permission: 'editor',
      canWrite: true,
      canManage: false,
    });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(JSON.parse(socket.sent[1])).toMatchObject({
      type: 'board_manifest_changed',
      revision: 4,
    });
    unsubscribe();
  });

  it('drops stale element events while offline and coalesces manifest revisions', async () => {
    global.WebSocket = TrackingWebSocket as unknown as typeof WebSocket;
    const service = await import('./boardSocketService');
    const unsubscribe = service.subscribeBoardSocketMessages('board-coalesce', () => undefined);

    service.sendBoardSocketMessage('board-coalesce', {
      type: 'element_update',
      boardId: 'spoofed-board',
      userId: 'spoofed-user',
      element: { id: 'old-element' },
    });
    service.sendBoardSocketMessage('board-coalesce', {
      type: 'board_manifest_changed',
      revision: 4,
      changedShardIds: ['shard_1'],
      deletedShardIds: [],
      totalElements: 1,
      updatedAt: Date.now(),
    });
    service.sendBoardSocketMessage('board-coalesce', {
      type: 'board_manifest_changed',
      revision: 6,
      changedShardIds: ['shard_2'],
      deletedShardIds: [],
      totalElements: 2,
      updatedAt: Date.now(),
    });

    await vi.waitFor(() => expect(TrackingWebSocket.instances).toHaveLength(1));
    const socket = TrackingWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.receive({
      type: 'authenticated',
      boardId: 'board-coalesce',
      permission: 'editor',
      canWrite: true,
      canManage: false,
    });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    const relayed = JSON.parse(socket.sent[1]);
    expect(relayed).toMatchObject({ type: 'board_manifest_changed', revision: 6 });
    expect(relayed.boardId).toBeUndefined();
    expect(socket.sent.some((payload) => payload.includes('old-element'))).toBe(false);
    unsubscribe();
  });

  it('reports CONNECTING until the server acknowledges authentication', async () => {
    global.WebSocket = TrackingWebSocket as unknown as typeof WebSocket;
    const service = await import('./boardSocketService');
    const unsubscribe = service.subscribeBoardSocketMessages('board-ready-state', () => undefined);
    const handle = service.getBoardSocketHandle('board-ready-state');

    await vi.waitFor(() => expect(TrackingWebSocket.instances).toHaveLength(1));
    expect(handle.readyState).toBe(TrackingWebSocket.CONNECTING);

    const socket = TrackingWebSocket.instances[0];
    socket.receive({
      type: 'authenticated',
      boardId: 'board-ready-state',
      permission: 'editor',
      canWrite: true,
      canManage: false,
    });

    await vi.waitFor(() => expect(handle.readyState).toBe(TrackingWebSocket.OPEN));
    unsubscribe();
  });

  it('retains the newest manifest and board setting while disconnected', async () => {
    global.WebSocket = TrackingWebSocket as unknown as typeof WebSocket;
    const service = await import('./boardSocketService');
    const unsubscribe = service.subscribeBoardSocketMessages('board-durable', () => undefined);

    service.sendBoardSocketMessage('board-durable', {
      type: 'board_manifest_changed',
      revision: 2,
      changedShardIds: ['shard_0'],
      deletedShardIds: [],
      totalElements: 1,
      updatedAt: Date.now(),
    });
    service.sendBoardSocketMessage('board-durable', {
      type: 'board_manifest_changed',
      revision: 3,
      changedShardIds: ['shard_1'],
      deletedShardIds: [],
      totalElements: 2,
      updatedAt: Date.now(),
    });
    service.sendBoardSocketMessage('board-durable', {
      type: 'board_settings_changed',
      studentsCanWrite: false,
      updatedAt: Date.now(),
    });

    await vi.waitFor(() => expect(TrackingWebSocket.instances).toHaveLength(1));
    const socket = TrackingWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.receive({
      type: 'authenticated',
      boardId: 'board-durable',
      permission: 'owner',
      canWrite: true,
      canManage: true,
    });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    const relayed = socket.sent.slice(1).map((payload) => JSON.parse(payload));
    expect(relayed).toContainEqual(expect.objectContaining({
      type: 'board_manifest_changed',
      revision: 3,
    }));
    expect(relayed).toContainEqual(expect.objectContaining({
      type: 'board_settings_changed',
      studentsCanWrite: false,
    }));
    unsubscribe();
  });

  it('isolates a failing initial status subscriber', async () => {
    global.WebSocket = TrackingWebSocket as unknown as typeof WebSocket;
    const service = await import('./boardSocketService');
    expect(() => service.subscribeBoardSocketStatus('board-listener-error', () => {
      throw new Error('listener failed');
    })).not.toThrow();
    service.closeBoardSocket('board-listener-error');
  });

});
