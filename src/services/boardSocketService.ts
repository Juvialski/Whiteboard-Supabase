import { isSandboxEnvironment } from '../utils/sandboxGuard';
import { getRealtimeAccessToken } from './realtimeAuth';

export type BoardSocketPermission = 'viewer' | 'editor' | 'owner' | 'admin' | 'none';

export interface BoardSocketStatus {
  connected: boolean;
  authenticated: boolean;
  latency: number | null;
  permission: BoardSocketPermission;
  canWrite: boolean;
  canManage: boolean;
  error?: string;
}

export interface BoardSocketHandle {
  readonly readyState: number;
  send(data: string): void;
}

type MessageListener = (message: any) => void;
type StatusListener = (status: BoardSocketStatus) => void;

const CONNECTING_STATE = 0;
const OPEN_STATE = 1;
const CLOSED_STATE = 3;
// Only a manifest notification is safe to replay after reconnection: it tells
// peers to fetch the authoritative database state. Replaying stale cursor,
// element, timer, follow, or drawing-stream events can visually overwrite newer
// work even though the database is correct.
const DURABLE_TYPES = new Set(['board_manifest_changed', 'board_settings_changed']);
const DISPOSE_DELAY_MS = 1_500;

class BoardSocketChannel {
  readonly boardId: string;
  private socket: WebSocket | null = null;
  private messageListeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private stopped = false;
  private queuedDurableMessages = new Map<string, any>();
  private status: BoardSocketStatus = {
    connected: false,
    authenticated: false,
    latency: null,
    permission: 'none',
    canWrite: false,
    canManage: false,
  };

  readonly handle: BoardSocketHandle;

  constructor(boardId: string) {
    this.boardId = boardId;
    const channel = this;
    this.handle = {
      get readyState() {
        if (channel.status.authenticated && channel.socket?.readyState === OPEN_STATE) return OPEN_STATE;
        // An open TCP/WebSocket handshake is not usable by components until the
        // Supabase token and board permission have been acknowledged.
        if (channel.socket && (channel.socket.readyState === CONNECTING_STATE || channel.socket.readyState === OPEN_STATE)) {
          return CONNECTING_STATE;
        }
        return channel.socket?.readyState ?? CLOSED_STATE;
      },
      send(data: string) {
        channel.send(data);
      },
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  subscribeMessages(listener: MessageListener): () => void {
    this.cancelPendingDispose();
    this.messageListeners.add(listener);
    this.ensureConnected();
    return () => {
      this.messageListeners.delete(listener);
      this.scheduleDisposeIfUnused();
    };
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.cancelPendingDispose();
    this.statusListeners.add(listener);
    try {
      listener({ ...this.status });
    } catch (listenerError) {
      console.error('A realtime status subscriber failed.', listenerError);
    }
    this.ensureConnected();
    return () => {
      this.statusListeners.delete(listener);
      this.scheduleDisposeIfUnused();
    };
  }

  private handleOnline = () => {
    if (!this.stopped) this.ensureConnected();
  };

  private handleOffline = () => {
    this.updateStatus({ connected: false, authenticated: false, latency: null, error: 'Browser is offline.' });
    this.socket?.close();
  };

  private listenerCount(): number {
    return this.messageListeners.size + this.statusListeners.size;
  }

  private cancelPendingDispose(): void {
    if (this.disposeTimer) clearTimeout(this.disposeTimer);
    this.disposeTimer = null;
  }

  private scheduleDisposeIfUnused(): void {
    if (this.stopped || this.listenerCount() > 0 || this.disposeTimer) return;
    this.disposeTimer = setTimeout(() => {
      this.disposeTimer = null;
      if (this.listenerCount() === 0) {
        this.dispose();
        channels.delete(this.boardId);
      }
    }, DISPOSE_DELAY_MS);
  }

  private ensureConnected(): void {
    if (
      this.stopped ||
      isSandboxEnvironment() ||
      typeof window === 'undefined' ||
      this.socket ||
      this.connectPromise ||
      this.reconnectTimer ||
      this.listenerCount() === 0 ||
      !navigator.onLine
    ) return;
    this.connectPromise = this.connect()
      .catch((error) => {
        this.updateStatus({
          connected: false,
          authenticated: false,
          error: error instanceof Error ? error.message : String(error),
        });
        this.socket = null;
        this.scheduleReconnect();
      })
      .finally(() => {
        this.connectPromise = null;
      });
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.socket || !navigator.onLine || this.listenerCount() === 0) return;

    let accessToken: string;
    try {
      accessToken = await getRealtimeAccessToken();
    } catch (error) {
      this.updateStatus({
        connected: false,
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
      return;
    }

    if (this.stopped || this.listenerCount() === 0) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const nextSocket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    this.socket = nextSocket;

    nextSocket.onopen = () => {
      if (this.stopped || this.socket !== nextSocket) {
        nextSocket.close(1000, 'Connection no longer needed');
        return;
      }
      nextSocket.send(JSON.stringify({
        type: 'authenticate',
        accessToken,
        boardId: this.boardId,
      }));
      this.authTimer = setTimeout(() => {
        if (!this.status.authenticated) nextSocket.close(1008, 'Authentication timeout');
      }, 5_000);
    };

    nextSocket.onmessage = (event) => {
      if (this.stopped || this.socket !== nextSocket) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'authenticated') {
          if (message.boardId !== this.boardId) {
            nextSocket.close(1008, 'Wrong board');
            return;
          }
          this.reconnectAttempt = 0;
          if (this.authTimer) clearTimeout(this.authTimer);
          this.authTimer = null;
          this.updateStatus({
            connected: true,
            authenticated: true,
            permission: message.permission || 'viewer',
            canWrite: message.canWrite === true,
            canManage: message.canManage === true,
            error: undefined,
          });
          this.startHeartbeat();
          this.flushQueue();
          return;
        }

        if (message.type === 'auth_error') {
          this.updateStatus({
            connected: false,
            authenticated: false,
            permission: 'none',
            canWrite: false,
            canManage: false,
            error: String(message.error || 'Realtime authentication failed.'),
          });
          nextSocket.close(1008, 'Authentication failed');
          return;
        }

        if (message.type === 'permission_updated') {
          this.updateStatus({
            permission: message.permission || 'viewer',
            canWrite: message.canWrite === true,
            canManage: message.canManage === true,
          });
        } else if (message.type === 'pong' && typeof message.id === 'number') {
          this.updateStatus({ latency: Math.max(0, Date.now() - message.id) });
        }

        for (const listener of [...this.messageListeners]) {
          try {
            listener(message);
          } catch (listenerError) {
            console.error('A realtime message subscriber failed.', listenerError);
          }
        }
      } catch (error) {
        console.warn('Ignored an invalid realtime message.', error);
      }
    };

    nextSocket.onclose = () => {
      if (this.socket !== nextSocket && this.socket !== null) return;
      if (this.socket === nextSocket) this.socket = null;
      if (this.authTimer) clearTimeout(this.authTimer);
      this.authTimer = null;
      this.stopHeartbeat();
      this.updateStatus({ connected: false, authenticated: false, latency: null });
      this.scheduleReconnect();
    };

    nextSocket.onerror = () => nextSocket.close();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === OPEN_STATE && this.status.authenticated) {
        this.socket.send(JSON.stringify({ type: 'ping', id: Date.now() }));
      }
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.listenerCount() === 0 || !navigator.onLine) return;
    const delay = Math.min(15_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 4));
    const jitter = Math.floor(Math.random() * 500);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay + jitter);
  }

  private parseOutgoing(data: string): any | null {
    try {
      const message = JSON.parse(data);
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return null;
      // Identity and room are immutable server-side socket context. Never let a
      // component accidentally put spoofable values on relay messages.
      delete message.accessToken;
      delete message.boardId;
      delete message.userId;
      delete message.permission;
      delete message.canWrite;
      delete message.canManage;
      return message;
    } catch {
      return null;
    }
  }

  private send(data: string): void {
    const message = this.parseOutgoing(data);
    if (!message || this.stopped || isSandboxEnvironment()) return;

    if (this.socket?.readyState === OPEN_STATE && this.status.authenticated) {
      this.socket.send(JSON.stringify(message));
      return;
    }

    if (DURABLE_TYPES.has(message.type)) {
      const existing = this.queuedDurableMessages.get(message.type);
      if (message.type !== 'board_manifest_changed' || !existing || Number(message.revision || 0) >= Number(existing.revision || 0)) {
        // Keep only the newest authoritative notification of each durable type.
        this.queuedDurableMessages.set(message.type, message);
      }
    }
    this.ensureConnected();
  }

  private flushQueue(): void {
    if (this.socket?.readyState !== OPEN_STATE || !this.status.authenticated) return;
    const pending = Array.from(this.queuedDurableMessages.values());
    this.queuedDurableMessages.clear();
    for (const message of pending) this.socket.send(JSON.stringify(message));
  }

  private updateStatus(patch: Partial<BoardSocketStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of [...this.statusListeners]) {
      try {
        listener({ ...this.status });
      } catch (listenerError) {
        console.error('A realtime status subscriber failed.', listenerError);
      }
    }
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelPendingDispose();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.authTimer) clearTimeout(this.authTimer);
    this.reconnectTimer = null;
    this.authTimer = null;
    this.stopHeartbeat();
    this.queuedDurableMessages.clear();
    this.socket?.close(1000, 'Board closed');
    this.socket = null;
    this.messageListeners.clear();
    this.statusListeners.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }
}

const channels = new Map<string, BoardSocketChannel>();

function getChannel(boardId: string): BoardSocketChannel {
  let channel = channels.get(boardId);
  if (!channel) {
    channel = new BoardSocketChannel(boardId);
    channels.set(boardId, channel);
  }
  return channel;
}

export function getBoardSocketHandle(boardId: string): BoardSocketHandle {
  return getChannel(boardId).handle;
}

export function subscribeBoardSocketMessages(boardId: string, listener: MessageListener): () => void {
  return getChannel(boardId).subscribeMessages(listener);
}

export function subscribeBoardSocketStatus(boardId: string, listener: StatusListener): () => void {
  return getChannel(boardId).subscribeStatus(listener);
}

export function sendBoardSocketMessage(boardId: string, message: Record<string, unknown>): void {
  getChannel(boardId).handle.send(JSON.stringify(message));
}

export function closeBoardSocket(boardId: string): void {
  channels.get(boardId)?.dispose();
  channels.delete(boardId);
}

export function closeAllBoardSockets(): void {
  channels.forEach((channel) => channel.dispose());
  channels.clear();
}
