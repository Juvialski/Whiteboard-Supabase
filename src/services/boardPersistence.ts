import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { auth, authPersistenceReady, supabase } from '../supabase';
import { getAuthErrorDetails, isOAuthFlowInProgress, signInAnonymously } from '../lib/supabaseAuth';
import { type BoardElement } from '../types';
import {
  getSandboxLocalElements,
  isSandboxEnvironment,
  saveSandboxLocalElements,
} from '../utils/sandboxGuard';
import { trackOperation } from '../utils/databaseInstrumentation';
import { getRealtimeAccessToken } from './realtimeAuth';

export type BoardLoadState = 'idle' | 'loading-manifest' | 'loading-shards' | 'ready' | 'error';

export interface BoardState {
  boardId: string;
  schemaVersion: number;
  currentRevision: number;
  shardIds: string[];
  totalElements: number;
  elements: BoardElement[];
  updatedAt: number;
  boardData?: any;
  loadState?: BoardLoadState;
}

export const SHARD_COUNT = 16;
export const MAX_STATE_SHARD_DOCUMENT_BYTES = 4_000_000;
export const TARGET_CHUNK_SIZE_BYTES = 1_500_000;
export const MAX_SINGLE_ELEMENT_BYTES = 2_000_000;

const IDLE_FLUSH_DELAY = 2_000;
const MAX_FLUSH_INTERVAL = 8_000;
const PENDING_KEY_PREFIX = 'supabase_pending_mutations_';

export interface MutationItem {
  elementId: string;
  data: BoardElement | null;
  action: 'set' | 'delete';
  generation: number;
  updatedAt: number;
  updatedByClientId?: string;
}

export interface RemoteOperation {
  operationId: string;
  clientId: string;
  baseRevision: number;
  elementId: string;
  action: 'set' | 'delete';
  data: BoardElement | null;
  updatedAt: number;
}

interface BoardControl {
  boardId: string;
  subscribers: Set<(state: BoardState) => void>;
  shards: Map<string, Map<string, BoardElement>>;
  currentElements: Map<string, BoardElement>;
  pendingMutations: Map<string, MutationItem>;
  appliedOperationIds: Set<string>;
  boardData: any;
  revision: number;
  loadState: BoardLoadState;
  dirtyGeneration: number;
  committedGeneration: number;
  firstMutationTime: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  flushPromise: Promise<void> | null;
  nextFlushRequested: boolean;
  syncSocket: WebSocket | null;
  syncSocketAuthenticated: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  hydrationPromise: Promise<void>;
  resolveHydration: () => void;
  hydrated: boolean;
  disposed: boolean;
}

const activeControls = new Map<string, BoardControl>();

const SYNC_STATUS_EVENT = 'lucid_spark_sync_status';

function emitSyncStatus(
  boardId: string,
  status: 'synced' | 'saving-cloud' | 'saved-local' | 'offline',
  error?: unknown
): void {
  if (typeof window === 'undefined') return;
  const message = error instanceof Error ? error.message : error ? String(error) : undefined;
  window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, {
    detail: { boardId, status, message },
  }));
}


function safeIdbGet(key: string): Promise<any> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return idbGet(key).catch(() => null);
}

function safeIdbSet(key: string, value: any): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return idbSet(key, value).catch(() => undefined);
}

function safeIdbDel(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return idbDel(key).catch(() => undefined);
}

function pendingKey(boardId: string): string {
  return `${PENDING_KEY_PREFIX}${boardId}`;
}

function mapBoardRow(row: any): any {
  return {
    ...(row?.data || {}),
    id: row.id,
    name: row.name,
    description: row.description || '',
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    createdBy: row.created_by || 'Unknown',
    ownerUid: row.owner_uid,
    accessMode: row.access_mode,
    editorUids: row.editor_uids || [],
    viewerUids: row.viewer_uids || [],
    status: row.status,
    studentId: row.student_id || '',
    studentName: row.student_name || '',
    studentsCanWrite: row.students_can_write !== false,
    schemaVersion: Number(row.schema_version || 4),
    shardLayoutVersion: Number(row.shard_layout_version || 3),
    shardCount: Number(row.shard_count || SHARD_COUNT),
    currentRevision: Number(row.current_revision || 0),
    changedShardIds: row.changed_shard_ids || [],
    deletedShardIds: row.deleted_shard_ids || [],
    totalElements: Number(row.total_elements || 0),
    effectivePermission: row.effective_permission || null,
    effectiveCanWrite: row.effective_can_write === true,
    effectiveCanManage: row.effective_can_manage === true,
  };
}

function shardMapFromRow(row: any): Map<string, BoardElement> {
  const result = new Map<string, BoardElement>();
  const elements = row?.elements || {};
  for (const [id, raw] of Object.entries(elements)) {
    if (!raw || typeof raw !== 'object' || (raw as any).isDeleted) continue;
    result.set(id, { ...(raw as any), id } as BoardElement);
  }
  return result;
}

function rebuildCurrentElements(control: BoardControl): void {
  const next = new Map<string, BoardElement>();
  for (const shard of control.shards.values()) {
    for (const [id, element] of shard) next.set(id, element);
  }

  for (const mutation of control.pendingMutations.values()) {
    if (mutation.action === 'delete') next.delete(mutation.elementId);
    else if (mutation.data) next.set(mutation.elementId, mutation.data);
  }
  control.currentElements = next;
}

function stateFromControl(control: BoardControl): BoardState {
  return {
    boardId: control.boardId,
    schemaVersion: Number(control.boardData?.schemaVersion || 4),
    currentRevision: control.revision,
    shardIds: Array.from(control.shards.keys()),
    totalElements: control.currentElements.size,
    elements: Array.from(control.currentElements.values()),
    updatedAt: Number(control.boardData?.updatedAt || Date.now()),
    boardData: control.boardData,
    loadState: control.loadState,
  };
}

function notify(control: BoardControl): void {
  const state = stateFromControl(control);
  control.subscribers.forEach((callback) => callback(state));
}

async function persistPending(control: BoardControl): Promise<void> {
  if (control.pendingMutations.size === 0) {
    await safeIdbDel(pendingKey(control.boardId));
    return;
  }
  await safeIdbSet(pendingKey(control.boardId), Array.from(control.pendingMutations.values()));
}

async function restorePending(control: BoardControl): Promise<void> {
  const raw = await safeIdbGet(pendingKey(control.boardId));
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item?.elementId || !['set', 'delete'].includes(item.action)) continue;
    const mutation = item as MutationItem;
    control.pendingMutations.set(mutation.elementId, mutation);
    control.dirtyGeneration = Math.max(control.dirtyGeneration, Number(mutation.generation || 0));
  }
}

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getShardIdForElement(elementId: string, shardCount: number = SHARD_COUNT): string {
  return `shard_${stableHash(elementId) % Math.max(1, shardCount)}`;
}

export function getShardCountForBoard(_boardData: any): number {
  return SHARD_COUNT;
}

export function sanitizeForDatabase(value: any): any {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(sanitizeForDatabase).filter((item) => item !== undefined);
  }
  const clean: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeForDatabase(item);
    if (sanitized !== undefined) clean[key] = sanitized;
  }
  return clean;
}

export function assertNoInlineBinaryPayload(element: any): void {
  const candidates = [element?.src, element?.audioUrl, element?.signatureDataUrl];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.startsWith('data:') && candidate.length > 100_000) {
      throw new Error('Large inline media must be saved through Supabase Storage before the element is persisted.');
    }
  }
}

export function sanitizeElementForStorage(element: BoardElement): BoardElement {
  const clean: any = sanitizeForDatabase(element);
  if (clean.assetId) {
    delete clean.src;
    delete clean.audioUrl;
  }
  if (clean.signatureAssetId || clean.assetId) delete clean.signatureDataUrl;
  assertNoInlineBinaryPayload(clean);
  return clean as BoardElement;
}

export function simplifyPoints(
  points: { x: number; y: number }[],
  tolerance: number = 1.5
): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  const result = [points[0]];
  let previous = points[0];
  const threshold = tolerance * tolerance;
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if (dx * dx + dy * dy >= threshold) {
      result.push(point);
      previous = point;
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

export function partitionElementsIntoChunks(
  elements: BoardElement[],
  targetBytes: number = TARGET_CHUNK_SIZE_BYTES
): BoardElement[][] {
  const chunks: BoardElement[][] = [];
  let current: BoardElement[] = [];
  let currentBytes = 0;
  for (const element of elements) {
    const clean = sanitizeElementForStorage(element);
    const bytes = new TextEncoder().encode(JSON.stringify(clean)).byteLength;
    if (current.length > 0 && currentBytes + bytes > targetBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(clean);
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function ensureAuthUser() {
  await authPersistenceReady.catch(() => undefined);
  if (isSandboxEnvironment()) return null;

  try {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser;

    // Never create a guest account while Supabase is exchanging a Google OAuth
    // callback. The permanent Google session must be allowed to settle first.
    if (isOAuthFlowInProgress()) return null;

    const credential = await signInAnonymously(auth);
    return credential.user;
  } catch (error) {
    const details = getAuthErrorDetails(error);
    if (details.code !== 'oauth_in_progress') {
      console.error('Supabase guest sign-in failed.', details);
    }
    return null;
  }
}

function createControl(boardId: string): BoardControl {
  let resolveHydration!: () => void;
  const hydrationPromise = new Promise<void>((resolve) => {
    resolveHydration = resolve;
  });
  const control: BoardControl = {
    boardId,
    subscribers: new Set(),
    shards: new Map(),
    currentElements: new Map(),
    pendingMutations: new Map(),
    appliedOperationIds: new Set(),
    boardData: null,
    revision: 0,
    loadState: 'idle',
    dirtyGeneration: 0,
    committedGeneration: 0,
    firstMutationTime: null,
    idleTimer: null,
    maxTimer: null,
    flushPromise: null,
    nextFlushRequested: false,
    syncSocket: null,
    syncSocketAuthenticated: false,
    reconnectTimer: null,
    hydrationPromise,
    resolveHydration,
    hydrated: false,
    disposed: false,
  };
  activeControls.set(boardId, control);
  void restorePending(control);
  return control;
}

export function getOrCreateControl(boardId: string): BoardControl {
  return activeControls.get(boardId) || createControl(boardId);
}

async function fetchBoardAndAllShards(control: BoardControl): Promise<void> {
  control.loadState = 'loading-manifest';
  notify(control);

  let boardRow: any = null;
  let shardRows: any[] = [];

  const { data: statePayload, error: stateError } = await supabase.rpc('get_board_state', {
    p_board_id: control.boardId,
  });

  if (!stateError && statePayload) {
    const payload = statePayload as any;
    boardRow = payload?.board;
    shardRows = Array.isArray(payload?.shards) ? payload.shards : [];
  } else {
    // Fallback to direct table queries if get_board_state RPC function is missing
    console.warn('RPC get_board_state unavailable, trying direct table select:', stateError?.message);
    const { data: bData, error: bError } = await supabase
      .from('boards')
      .select('*')
      .eq('id', control.boardId)
      .maybeSingle();

    if (bError || !bData) {
      throw bError || new Error('Board not found or access denied.');
    }
    boardRow = bData;

    const { data: sData, error: sError } = await supabase
      .from('board_shards')
      .select('*')
      .eq('board_id', control.boardId);

    if (sError) throw sError;
    shardRows = sData || [];
  }

  if (!boardRow) throw new Error('Board not found or access denied.');

  control.boardData = mapBoardRow(boardRow);
  control.revision = Number(control.boardData.currentRevision || 0);
  control.shards.clear();
  for (const row of shardRows || []) {
    control.shards.set(row.shard_id, shardMapFromRow(row));
  }
  rebuildCurrentElements(control);
  control.loadState = 'ready';
  if (!control.hydrated) {
    control.hydrated = true;
    control.resolveHydration();
  }
  trackOperation('read', 'supabase-board-state-rpc', 1);
  notify(control);

  if (control.pendingMutations.size > 0) scheduleFlush(control);
}

async function fetchChangedShards(
  control: BoardControl,
  changedShardIds: string[],
  deletedShardIds: string[],
  nextRevision: number,
  boardData: any
): Promise<void> {
  const gap = nextRevision - control.revision;
  if (gap > 1 || changedShardIds.length === 0) {
    await fetchBoardAndAllShards(control);
    return;
  }

  const { data, error } = await supabase
    .from('board_shards')
    .select('shard_id,revision,elements,tombstones,updated_at')
    .eq('board_id', control.boardId)
    .in('shard_id', changedShardIds);
  if (error) throw error;

  for (const row of data || []) {
    control.shards.set(row.shard_id, shardMapFromRow(row));
  }
  for (const shardId of deletedShardIds) control.shards.delete(shardId);

  control.boardData = boardData;
  control.revision = nextRevision;
  rebuildCurrentElements(control);
  trackOperation('read', 'supabase-shards-realtime-refresh', (data || []).length);
  notify(control);
}

function startPersistenceSocket(control: BoardControl): void {
  if (control.syncSocket || isSandboxEnvironment() || typeof window === 'undefined') return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  let reconnectAttempt = 0;

  const connect = () => {
    if (control.disposed) return;
    const socket = new WebSocket(wsUrl);
    control.syncSocket = socket;
    control.syncSocketAuthenticated = false;

    socket.onopen = () => {
      void getRealtimeAccessToken()
        .then((accessToken) => {
          if (control.disposed || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({
            type: 'authenticate',
            accessToken,
            boardId: control.boardId,
          }));
        })
        .catch((error) => {
          console.error('Unable to authenticate the persistence relay:', error);
          if (socket.readyState === WebSocket.OPEN) socket.close(1008, 'Authentication failed');
        });
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));

        if (message.type === 'authenticated') {
          if (message.boardId !== control.boardId) {
            socket.close(1008, 'Wrong board');
            return;
          }
          reconnectAttempt = 0;
          control.syncSocketAuthenticated = true;
          return;
        }

        if (message.type === 'auth_error') {
          console.error('Persistence relay authorization failed:', message.error || 'Unknown error');
          socket.close(1008, 'Authorization failed');
          return;
        }

        if (message.type === 'permission_updated') {
          control.boardData = {
            ...(control.boardData || {}),
            effectivePermission: message.permission,
            effectiveCanWrite: message.canWrite === true,
            effectiveCanManage: message.canManage === true,
          };
          notify(control);
          return;
        }

        if (!control.syncSocketAuthenticated) return;
        if (message.type !== 'board_manifest_changed' || message.boardId !== control.boardId) return;
        const nextRevision = Number(message.revision || 0);
        if (nextRevision <= control.revision) return;
        void fetchChangedShards(
          control,
          Array.isArray(message.changedShardIds) ? message.changedShardIds : [],
          Array.isArray(message.deletedShardIds) ? message.deletedShardIds : [],
          nextRevision,
          {
            ...(control.boardData || {}),
            currentRevision: nextRevision,
            changedShardIds: message.changedShardIds || [],
            deletedShardIds: message.deletedShardIds || [],
            totalElements: Number(message.totalElements || control.currentElements.size),
            updatedAt: Number(message.updatedAt || Date.now()),
          }
        ).catch((error) => {
          console.error('Persistence relay shard refresh failed:', error);
        });
      } catch (error) {
        console.warn('Invalid persistence relay message:', error);
      }
    };

    socket.onclose = () => {
      if (control.syncSocket === socket) control.syncSocket = null;
      control.syncSocketAuthenticated = false;
      if (!control.disposed) {
        const delay = Math.min(10_000, 1_000 * 2 ** Math.min(reconnectAttempt, 3));
        reconnectAttempt += 1;
        control.reconnectTimer = setTimeout(connect, delay + Math.floor(Math.random() * 400));
      }
    };

    socket.onerror = () => socket.close();
  };

  connect();
}

export async function loadBoardState(boardId: string): Promise<BoardState> {
  if (isSandboxEnvironment()) {
    const elements = getSandboxLocalElements(boardId);
    return {
      boardId,
      schemaVersion: 4,
      currentRevision: 1,
      shardIds: ['sandbox'],
      totalElements: elements.length,
      elements,
      updatedAt: Date.now(),
      loadState: 'ready',
    };
  }

  const user = await ensureAuthUser();
  if (!user) throw new Error('Supabase authentication is not ready. Finish Google sign-in or retry guest access.');
  const control = getOrCreateControl(boardId);
  if (!control.hydrated && control.loadState === 'idle') await fetchBoardAndAllShards(control);
  else await control.hydrationPromise;
  return stateFromControl(control);
}

export function publishBoardState(boardId: string): void {
  const control = activeControls.get(boardId);
  if (control) notify(control);
}

export function subscribeToBoardState(
  boardId: string,
  callback: (state: BoardState) => void
): () => void {
  if (isSandboxEnvironment()) {
    const emit = () => {
      const elements = getSandboxLocalElements(boardId);
      callback({
        boardId,
        schemaVersion: 4,
        currentRevision: 1,
        shardIds: ['sandbox'],
        totalElements: elements.length,
        elements,
        updatedAt: Date.now(),
        loadState: 'ready',
      });
    };
    emit();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.boardId === boardId) emit();
    };
    window.addEventListener('lucid_spark_elements_updated', handler);
    return () => window.removeEventListener('lucid_spark_elements_updated', handler);
  }

  const control = getOrCreateControl(boardId);
  control.subscribers.add(callback);
  callback(stateFromControl(control));
  startPersistenceSocket(control);

  if (!control.hydrated && control.loadState === 'idle') {
    void ensureAuthUser()
      .then((user) => {
        if (!user) throw new Error('Supabase authentication is not ready. Finish Google sign-in or retry guest access.');
        return fetchBoardAndAllShards(control);
      })
      .catch((error) => {
        console.error('Supabase board load failed:', error);
        control.loadState = 'error';
        if (!control.hydrated) {
          control.hydrated = true;
          control.resolveHydration();
        }
        notify(control);
      });
  }

  return () => {
    control.subscribers.delete(callback);
    if (control.subscribers.size === 0 && control.pendingMutations.size === 0 && !control.flushPromise) {
      disposeBoardPersistence(boardId);
    }
  };
}

function runScheduledFlush(control: BoardControl, reason: string): void {
  emitSyncStatus(control.boardId, 'saving-cloud');
  void flushBoardCheckpoint(control.boardId, reason)
    .then(() => emitSyncStatus(control.boardId, 'synced'))
    .catch((error) => {
      console.error(`Supabase board checkpoint failed (${reason}):`, error);
      emitSyncStatus(control.boardId, 'offline', error);
    });
}

function scheduleFlush(control: BoardControl): void {
  if (isSandboxEnvironment()) return;
  if (!control.firstMutationTime) control.firstMutationTime = Date.now();
  if (control.idleTimer) clearTimeout(control.idleTimer);
  control.idleTimer = setTimeout(() => runScheduledFlush(control, 'idle-debounce'), IDLE_FLUSH_DELAY);

  if (!control.maxTimer) {
    const elapsed = Date.now() - control.firstMutationTime;
    control.maxTimer = setTimeout(
      () => runScheduledFlush(control, 'max-interval'),
      Math.max(0, MAX_FLUSH_INTERVAL - elapsed)
    );
  }
}

export function queueElementMutation(
  boardId: string,
  elementId: string,
  data: BoardElement | null,
  action: 'set' | 'delete' = 'set',
  updatedByClientId?: string
): void {
  const control = getOrCreateControl(boardId);
  control.dirtyGeneration += 1;

  let clean = data;
  if (action === 'set' && data) {
    clean = sanitizeElementForStorage(data);
    if (clean.type === 'drawing' && Array.isArray((clean as any).points)) {
      clean = { ...clean, points: simplifyPoints((clean as any).points) } as BoardElement;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(clean)).byteLength;
    if (bytes > MAX_SINGLE_ELEMENT_BYTES) {
      throw new Error(`Element ${elementId} is too large (${Math.round(bytes / 1024)} KB).`);
    }
  }

  const mutation: MutationItem = {
    elementId,
    data: clean,
    action,
    generation: control.dirtyGeneration,
    updatedAt: Date.now(),
    updatedByClientId: updatedByClientId || auth.currentUser?.uid || 'local-client',
  };
  control.pendingMutations.set(elementId, mutation);
  void persistPending(control);

  if (action === 'delete') control.currentElements.delete(elementId);
  else if (clean) control.currentElements.set(elementId, clean);
  notify(control);
  emitSyncStatus(boardId, 'saved-local');

  if (isSandboxEnvironment()) {
    saveSandboxLocalElements(boardId, Array.from(control.currentElements.values()));
    return;
  }
  scheduleFlush(control);
}

export function applyRemoteOperation(boardId: string, operation: RemoteOperation): void {
  const control = getOrCreateControl(boardId);
  if (control.appliedOperationIds.has(operation.operationId)) return;
  control.appliedOperationIds.add(operation.operationId);
  if (control.appliedOperationIds.size > 2_000) {
    Array.from(control.appliedOperationIds).slice(0, 500).forEach((id) => control.appliedOperationIds.delete(id));
  }
  if (control.pendingMutations.has(operation.elementId)) return;
  if (operation.action === 'delete') control.currentElements.delete(operation.elementId);
  else if (operation.data) control.currentElements.set(operation.elementId, operation.data);
  notify(control);
}

export async function flushBoardCheckpoint(boardId: string, _reason: string = 'manual'): Promise<void> {
  const control = getOrCreateControl(boardId);
  if (isSandboxEnvironment()) {
    control.pendingMutations.clear();
    await persistPending(control);
    return;
  }

  const user = await ensureAuthUser();
  if (!user) throw new Error('Supabase authentication is not ready. Finish Google sign-in or retry guest access.');
  if (!control.hydrated && control.loadState === 'idle') await fetchBoardAndAllShards(control);
  else await control.hydrationPromise;

  if (control.pendingMutations.size === 0) return;
  if (control.flushPromise) {
    control.nextFlushRequested = true;
    return control.flushPromise;
  }

  if (control.idleTimer) clearTimeout(control.idleTimer);
  if (control.maxTimer) clearTimeout(control.maxTimer);
  control.idleTimer = null;
  control.maxTimer = null;
  control.firstMutationTime = null;

  const snapshot = new Map(control.pendingMutations);
  const generation = control.dirtyGeneration;
  const payload = Array.from(snapshot.values()).map((mutation) => ({
    elementId: mutation.elementId,
    shardId: getShardIdForElement(mutation.elementId),
    action: mutation.action,
    data: mutation.data,
    updatedAt: mutation.updatedAt,
    updatedByClientId: mutation.updatedByClientId || '',
  }));

  control.flushPromise = (async () => {
    const { data, error } = await supabase.rpc('apply_board_mutations', {
      p_board_id: boardId,
      p_mutations: payload,
    });
    if (error) throw new Error(error.message);

    const result = data as any;
    const returnedShards = result?.shards || {};
    for (const [shardId, elements] of Object.entries(returnedShards)) {
      control.shards.set(shardId, shardMapFromRow({ elements }));
    }
    for (const shardId of result?.deletedShardIds || []) control.shards.delete(shardId);

    control.revision = Number(result?.revision || control.revision);
    control.boardData = {
      ...(control.boardData || {}),
      currentRevision: control.revision,
      changedShardIds: result?.changedShardIds || [],
      deletedShardIds: result?.deletedShardIds || [],
      totalElements: Number(result?.totalElements || 0),
      updatedAt: Date.now(),
      schemaVersion: 4,
      shardLayoutVersion: 3,
      shardCount: SHARD_COUNT,
    };

    for (const [elementId, mutation] of snapshot) {
      const current = control.pendingMutations.get(elementId);
      if (current && current.generation <= generation) control.pendingMutations.delete(elementId);
    }
    control.committedGeneration = Math.max(control.committedGeneration, generation);
    await persistPending(control);
    rebuildCurrentElements(control);
    trackOperation('tx_commit', 'supabase-board-checkpoint-rpc', 1);
    trackOperation('write', 'supabase-affected-shards', (result?.changedShardIds || []).length);
    trackOperation('write', 'supabase-board-manifest', 1);
    notify(control);

    if (control.syncSocketAuthenticated && control.syncSocket?.readyState === WebSocket.OPEN) {
      control.syncSocket.send(JSON.stringify({
        type: 'board_manifest_changed',
        boardId,
        revision: control.revision,
        changedShardIds: result?.changedShardIds || [],
        deletedShardIds: result?.deletedShardIds || [],
        totalElements: Number(result?.totalElements || 0),
        updatedAt: Date.now(),
      }));
    }
  })()
    .finally(() => {
      control.flushPromise = null;
      if (control.nextFlushRequested || control.pendingMutations.size > 0) {
        control.nextFlushRequested = false;
        scheduleFlush(control);
      }
    });

  return control.flushPromise;
}

export async function initializeBoardWithElements(
  boardId: string,
  elements: BoardElement[],
  boardData: any
): Promise<void> {
  const user = await ensureAuthUser();
  if (!user) throw new Error('Supabase authentication is not ready. Finish Google sign-in or retry guest access.');

  const { error: patchError } = await supabase.rpc('patch_board', {
    p_board_id: boardId,
    p_patch: {
      ...boardData,
      status: 'initializing',
      schemaVersion: 4,
      shardLayoutVersion: 3,
      shardCount: SHARD_COUNT,
      currentRevision: 0,
      totalElements: 0,
      changedShardIds: [],
      deletedShardIds: [],
      updatedAt: Date.now(),
    },
  });
  if (patchError) throw new Error(patchError.message);

  const mutations = elements.map((element, index) => {
    const clean = sanitizeElementForStorage(element);
    return {
      elementId: clean.id,
      shardId: getShardIdForElement(clean.id),
      action: 'set',
      data: clean,
      updatedAt: Number((clean as any).updatedAt || Date.now() + index),
      updatedByClientId: 'initial-import',
    };
  });

  if (mutations.length > 0) {
    const { error } = await supabase.rpc('apply_board_mutations', {
      p_board_id: boardId,
      p_mutations: mutations,
    });
    if (error) throw new Error(error.message);
  }

  const { error: readyError } = await supabase.rpc('patch_board', {
    p_board_id: boardId,
    p_patch: {
      ...boardData,
      status: 'ready',
      schemaVersion: 4,
      shardLayoutVersion: 3,
      shardCount: SHARD_COUNT,
      updatedAt: Date.now(),
    },
  });
  if (readyError) throw new Error(readyError.message);
}

export function disposeBoardPersistence(boardId?: string): void {
  const ids = boardId ? [boardId] : Array.from(activeControls.keys());
  for (const id of ids) {
    const control = activeControls.get(id);
    if (!control) continue;
    control.disposed = true;
    if (control.idleTimer) clearTimeout(control.idleTimer);
    if (control.maxTimer) clearTimeout(control.maxTimer);
    if (control.reconnectTimer) clearTimeout(control.reconnectTimer);
    control.syncSocketAuthenticated = false;
    if (control.syncSocket) control.syncSocket.close();
    activeControls.delete(id);
  }
}
