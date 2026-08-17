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
import {
  deleteBoardRecoveryCache,
  getScopedBoardCacheKey,
  discardLegacyBoardRecoveryForAuthorizedUser,
} from '../utils/boardRecoveryCache';
import {
  sendBoardSocketMessage,
  subscribeBoardSocketMessages,
  subscribeBoardSocketStatus,
} from './boardSocketService';

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
  loadError?: string;
}

export const SHARD_COUNT = 16;
export const MAX_STATE_SHARD_DOCUMENT_BYTES = 4_000_000;
export const TARGET_CHUNK_SIZE_BYTES = 1_500_000;
export const MAX_SINGLE_ELEMENT_BYTES = 900_000;
export const MAX_MUTATIONS_PER_RPC = 400;
export const TARGET_MUTATION_RPC_BYTES = 6 * 1024 * 1024;

const IDLE_FLUSH_DELAY = 2_000;
const MAX_FLUSH_INTERVAL = 8_000;
const RETRY_BASE_DELAY = 4_000;
const RETRY_MAX_DELAY = 60_000;
const MAX_AUTO_RETRY_ATTEMPTS = 8;
const MAX_DRAWING_POINTS = 20_000;
const ALLOWED_ELEMENT_TYPES = new Set([
  'sticky', 'shape', 'text', 'drawing', 'image',
  'connector', 'audio', 'stamp', 'math', 'table',
]);
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LEGACY_PENDING_KEY_PREFIX = 'supabase_pending_mutations_';

export interface MutationItem {
  elementId: string;
  data: BoardElement | null;
  action: 'set' | 'delete';
  generation: number;
  updatedAt: number;
  updatedByClientId?: string;
}

export interface RpcMutationPayload {
  elementId: string;
  shardId: string;
  action: 'set' | 'delete';
  data: BoardElement | null;
  updatedAt: number;
  updatedByClientId: string;
}

/**
 * Keeps every RPC comfortably below the database's 500-item/8 MB hard limit.
 * JSON byte estimates are conservative enough to leave room for JSONB overhead.
 */
export function partitionMutationPayloads(
  payloads: RpcMutationPayload[],
  targetBytes: number = TARGET_MUTATION_RPC_BYTES,
  maxItems: number = MAX_MUTATIONS_PER_RPC
): RpcMutationPayload[][] {
  const batches: RpcMutationPayload[][] = [];
  let current: RpcMutationPayload[] = [];
  let currentBytes = 2; // JSON array brackets.

  for (const payload of payloads) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength + 1;
    if (current.length > 0 && (current.length >= maxItems || currentBytes + bytes > targetBytes)) {
      batches.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(payload);
    currentBytes += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface RemoteOperation {
  operationId: string;
  clientId: string;
  baseRevision: number;
  elementId: string;
  action: 'set' | 'delete';
  data: BoardElement | Partial<BoardElement> | null;
  updatedAt: number;
  isMerge?: boolean;
}

interface PendingManifestRefresh {
  revision: number;
  changedShardIds: string[];
  deletedShardIds: string[];
  boardData: any;
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
  loadError: string | null;
  dirtyGeneration: number;
  committedGeneration: number;
  firstMutationTime: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  flushPromise: Promise<void> | null;
  nextFlushRequested: boolean;
  socketMessageUnsubscribe: (() => void) | null;
  socketStatusUnsubscribe: (() => void) | null;
  socketAuthenticated: boolean;
  manifestRefreshPromise: Promise<void> | null;
  pendingManifestRefresh: PendingManifestRefresh | null;
  hydrationPromise: Promise<void>;
  resolveHydration: () => void;
  pendingRestorePromise: Promise<void> | null;
  pendingRestored: boolean;
  pendingPersistPromise: Promise<void> | null;
  pendingPersistRequested: boolean;
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

function pendingKey(boardId: string): string | null {
  return getScopedBoardCacheKey('pending', boardId);
}

function legacyPendingKey(boardId: string): string {
  return `${LEGACY_PENDING_KEY_PREFIX}${boardId}`;
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

  if (control.boardData?.effectiveCanWrite === true) {
    for (const mutation of control.pendingMutations.values()) {
      if (mutation.action === 'delete') next.delete(mutation.elementId);
      else if (mutation.data) next.set(mutation.elementId, mutation.data);
    }
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
    loadError: control.loadError || undefined,
  };
}

function notify(control: BoardControl): void {
  const state = stateFromControl(control);
  for (const callback of [...control.subscribers]) {
    try {
      callback(state);
    } catch (subscriberError) {
      // A React subscriber must never turn a successful database checkpoint into
      // a failed retry or prevent the other mounted views from updating.
      console.error('A board-state subscriber failed.', subscriberError);
    }
  }
}

async function persistPending(control: BoardControl): Promise<void> {
  const key = pendingKey(control.boardId);
  if (!key) return;

  // Serialize writes to the same IndexedDB key. Rapid edits previously started
  // overlapping idbSet calls, allowing an older snapshot to finish last and
  // replace a newer offline queue during a crash or tab close.
  control.pendingPersistRequested = true;
  if (control.pendingPersistPromise) return control.pendingPersistPromise;

  control.pendingPersistPromise = (async () => {
    while (control.pendingPersistRequested) {
      control.pendingPersistRequested = false;
      const snapshot = Array.from(control.pendingMutations.values());
      if (snapshot.length === 0) await safeIdbDel(key);
      else await safeIdbSet(key, snapshot);
    }
  })().finally(() => {
    control.pendingPersistPromise = null;
    // A mutation can arrive in the microtask between the final loop check and
    // this cleanup. Chain one more drain so callers awaiting the current write
    // do not return before that newest snapshot is durable.
    if (control.pendingPersistRequested) return persistPending(control);
  });

  return control.pendingPersistPromise;
}

function normalizePendingMutation(control: BoardControl, item: any): MutationItem | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const elementId = typeof item.elementId === 'string' ? item.elementId.trim() : '';
  if (!elementId || elementId.length > 128) return null;
  const action = item.action === 'delete' ? 'delete' : item.action === 'set' ? 'set' : null;
  if (!action) return null;

  const parsedGeneration = Number(item.generation);
  const generation = Number.isSafeInteger(parsedGeneration) && parsedGeneration > 0 && parsedGeneration <= 1_000_000_000
    ? parsedGeneration
    : Math.max(control.dirtyGeneration + 1, 1);
  const now = Date.now();
  const parsedUpdatedAt = Number(item.updatedAt);
  const updatedAt = Number.isFinite(parsedUpdatedAt) && parsedUpdatedAt > 0 && parsedUpdatedAt <= now + 5 * 60_000
    ? parsedUpdatedAt
    : now;
  const candidateClientId = typeof item.updatedByClientId === 'string'
    ? item.updatedByClientId.trim().slice(0, 128)
    : '';
  const updatedByClientId = candidateClientId || auth.currentUser?.uid || 'recovered-client';

  if (action === 'delete') {
    return { elementId, action, data: null, generation, updatedAt, updatedByClientId };
  }

  if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) return null;
  if (typeof item.data.type !== 'string' || !ALLOWED_ELEMENT_TYPES.has(item.data.type)) return null;

  try {
    let data = sanitizeElementForStorage({ ...item.data, id: elementId } as BoardElement);
    if (data.type === 'drawing' && Array.isArray((data as any).points)) {
      data = { ...data, points: limitDrawingPoints((data as any).points) } as BoardElement;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    if (bytes > MAX_SINGLE_ELEMENT_BYTES) return null;
    return { elementId, action, data, generation, updatedAt, updatedByClientId };
  } catch {
    return null;
  }
}

function mergePendingItems(control: BoardControl, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  let rejected = 0;
  for (const item of raw) {
    const mutation = normalizePendingMutation(control, item);
    if (!mutation) {
      rejected += 1;
      continue;
    }
    const existing = control.pendingMutations.get(mutation.elementId);
    if (!existing || mutation.updatedAt >= existing.updatedAt) {
      control.pendingMutations.set(mutation.elementId, mutation);
    }
    control.dirtyGeneration = Math.max(control.dirtyGeneration, mutation.generation);
  }
  if (rejected > 0) {
    console.warn(`Discarded ${rejected} invalid recovered mutation${rejected === 1 ? '' : 's'} for board ${control.boardId}.`);
  }
}

async function restorePending(control: BoardControl, canWrite: boolean): Promise<void> {
  if (control.pendingRestored) return;
  if (control.pendingRestorePromise) return control.pendingRestorePromise;

  control.pendingRestorePromise = (async () => {
    const key = pendingKey(control.boardId);
    if (canWrite && key) {
      mergePendingItems(control, await safeIdbGet(key));
      // Rewrite the queue after validation so corrupt legacy rows cannot poison
      // every future checkpoint attempt for this user and board.
      await persistPending(control);
    }

    // The board state RPC has already confirmed that this account may read the
    // board. An old unscoped mutation queue may be adopted only by a current
    // writer; regardless of role, delete the ambiguous key after this check so
    // it can never be assigned to another account on the same browser.
    const legacyKey = legacyPendingKey(control.boardId);
    const legacy = await safeIdbGet(legacyKey);
    const canAdoptLegacy = canWrite && control.pendingMutations.size === 0 && Array.isArray(legacy);
    if (canAdoptLegacy) {
      mergePendingItems(control, legacy);
      await persistPending(control);
    }
    await safeIdbDel(legacyKey);
    await discardLegacyBoardRecoveryForAuthorizedUser(control.boardId);

    control.pendingRestored = true;
  })().finally(() => {
    control.pendingRestorePromise = null;
  });

  return control.pendingRestorePromise;
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

export function sanitizeForDatabase(value: any, depth: number = 0): any {
  if (depth > 24) throw new Error('Element data is nested too deeply.');
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Element data contains a non-finite number.');
    return value;
  }
  if (typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForDatabase(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  const clean: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new Error(`Element data contains a forbidden key: ${key}`);
    }
    const sanitized = sanitizeForDatabase(item, depth + 1);
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
  if (!clean || typeof clean.id !== 'string' || clean.id.length < 1 || clean.id.length > 128) {
    throw new Error('Element ID is invalid.');
  }
  if (typeof clean.type !== 'string' || !ALLOWED_ELEMENT_TYPES.has(clean.type)) {
    throw new Error('Element type is invalid.');
  }
  for (const field of ['x', 'y', 'width', 'height', 'zIndex', 'fontSize', 'duration', 'strokeWidth']) {
    if (clean[field] !== undefined && (
      typeof clean[field] !== 'number' ||
      !Number.isFinite(clean[field]) ||
      Math.abs(clean[field]) > 10_000_000
    )) {
      throw new Error(`Element numeric field is invalid: ${field}`);
    }
  }
  if (typeof clean.text === 'string' && clean.text.length > 100_000) {
    throw new Error('Element text is too long.');
  }
  if (clean.type === 'drawing') {
    if (!Array.isArray(clean.points) || !clean.points.every((point: any) => (
      point && typeof point === 'object' &&
      typeof point.x === 'number' && Number.isFinite(point.x) && Math.abs(point.x) <= 10_000_000 &&
      typeof point.y === 'number' && Number.isFinite(point.y) && Math.abs(point.y) <= 10_000_000
    ))) {
      throw new Error('Drawing contains invalid points.');
    }
    if (typeof clean.width !== 'number' || clean.width <= 0 || clean.width > 200) {
      throw new Error('Drawing width is invalid.');
    }
  }
  if (clean.type === 'table') {
    if (!Number.isInteger(clean.rows) || clean.rows < 1 || clean.rows > 200 ||
        !Number.isInteger(clean.cols) || clean.cols < 1 || clean.cols > 200 ||
        !Array.isArray(clean.data) || clean.data.length > 200 ||
        !clean.data.every((row: unknown) => Array.isArray(row) && row.length <= 200)) {
      throw new Error('Table dimensions or data are invalid.');
    }
  }
  if (clean.type === 'image' && !clean.assetId && typeof clean.src === 'string' && clean.src.startsWith('blob:')) {
    throw new Error('Temporary image blob URLs cannot be persisted. Save the image as a board asset first.');
  }
  if (clean.type === 'image' && clean.rotation !== undefined && ![0, 90, 180, 270].includes(clean.rotation)) {
    throw new Error('Image rotation is invalid.');
  }
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

function limitDrawingPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const simplified = simplifyPoints(points);
  if (simplified.length <= MAX_DRAWING_POINTS) return simplified;
  const lastIndex = simplified.length - 1;
  return Array.from({ length: MAX_DRAWING_POINTS }, (_, index) => {
    const sourceIndex = Math.round((index * lastIndex) / (MAX_DRAWING_POINTS - 1));
    return simplified[sourceIndex];
  });
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

export async function ensureAuthUser(captchaToken?: string) {
  await authPersistenceReady.catch(() => undefined);
  if (isSandboxEnvironment()) return null;

  try {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser;

    // Never create a guest account while Supabase is exchanging a Google OAuth
    // callback. The permanent Google session must be allowed to settle first.
    if (isOAuthFlowInProgress()) return null;

    const credential = await signInAnonymously(auth, captchaToken);
    return credential.user;
  } catch (error) {
    const details = getAuthErrorDetails(error);
    if (details.code !== 'oauth_in_progress') {
      console.error('Supabase guest sign-in failed.', details);
    }
    if (captchaToken) throw error;
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
    loadError: null,
    dirtyGeneration: 0,
    committedGeneration: 0,
    firstMutationTime: null,
    idleTimer: null,
    maxTimer: null,
    retryTimer: null,
    retryAttempt: 0,
    flushPromise: null,
    nextFlushRequested: false,
    socketMessageUnsubscribe: null,
    socketStatusUnsubscribe: null,
    socketAuthenticated: false,
    manifestRefreshPromise: null,
    pendingManifestRefresh: null,
    hydrationPromise,
    resolveHydration,
    pendingRestorePromise: null,
    pendingRestored: false,
    pendingPersistPromise: null,
    pendingPersistRequested: false,
    hydrated: false,
    disposed: false,
  };
  activeControls.set(boardId, control);
  return control;
}

export function getOrCreateControl(boardId: string): BoardControl {
  return activeControls.get(boardId) || createControl(boardId);
}

async function fetchBoardAndAllShards(control: BoardControl): Promise<void> {
  control.loadState = 'loading-manifest';
  control.loadError = null;
  notify(control);

  let boardRow: any = null;
  let shardRows: any[] = [];

  const { data: statePayload, error: stateError } = await supabase.rpc('get_board_state', {
    p_board_id: control.boardId,
  });

  if (stateError) {
    const message = stateError.message || 'Unknown database error';
    throw new Error(
      `Unable to load this board through get_board_state. Apply the latest Supabase migrations before deploying this client. ${message}`
    );
  }

  const payload = statePayload as any;
  boardRow = payload?.board;
  shardRows = Array.isArray(payload?.shards) ? payload.shards : [];

  if (!boardRow) throw new Error('Board not found or access denied.');

  control.boardData = mapBoardRow(boardRow);
  control.revision = Number(control.boardData.currentRevision || 0);
  await restorePending(control, control.boardData.effectiveCanWrite === true);
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
  // A newer manifest may have completed while this request was in flight. Never
  // let an older shard response roll the board revision or visible state back.
  if (nextRevision <= control.revision || control.disposed) return;

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

function enqueueManifestRefresh(control: BoardControl, next: PendingManifestRefresh): void {
  if (control.disposed || next.revision <= control.revision) return;

  const queued = control.pendingManifestRefresh;
  if (!queued || next.revision >= queued.revision) {
    control.pendingManifestRefresh = next;
  }
  if (control.manifestRefreshPromise) return;

  control.manifestRefreshPromise = (async () => {
    // A manifest can arrive while the initial get_board_state call is still in
    // flight. Waiting prevents two full snapshots from completing out of order.
    if (!control.hydrated) await control.hydrationPromise;

    while (!control.disposed && control.pendingManifestRefresh) {
      const pending = control.pendingManifestRefresh;
      control.pendingManifestRefresh = null;
      if (pending.revision <= control.revision) continue;

      try {
        await fetchChangedShards(
          control,
          pending.changedShardIds,
          pending.deletedShardIds,
          pending.revision,
          pending.boardData
        );
      } catch (error) {
        console.error('Persistence relay shard refresh failed:', error);
        // A gap, deleted shard, or transient partial response is safest to repair
        // with one authoritative snapshot. The newest queued revision is still
        // processed afterwards if another notification arrived meanwhile.
        try {
          await fetchBoardAndAllShards(control);
        } catch (reloadError) {
          console.error('Authoritative board reload after realtime failure failed:', reloadError);
        }
      }
    }
  })().finally(() => {
    control.manifestRefreshPromise = null;
    if (!control.disposed && control.pendingManifestRefresh) {
      const pending = control.pendingManifestRefresh;
      control.pendingManifestRefresh = null;
      enqueueManifestRefresh(control, pending);
    }
    disposeControlIfIdle(control);
  });
}

function clearFlushTimers(control: BoardControl): void {
  if (control.idleTimer) clearTimeout(control.idleTimer);
  if (control.maxTimer) clearTimeout(control.maxTimer);
  control.idleTimer = null;
  control.maxTimer = null;
  control.firstMutationTime = null;
}

function clearRetryTimer(control: BoardControl): void {
  if (control.retryTimer) clearTimeout(control.retryTimer);
  control.retryTimer = null;
}

function disposeControlIfIdle(control: BoardControl): void {
  const retriesExhausted = control.retryAttempt >= MAX_AUTO_RETRY_ATTEMPTS && !control.retryTimer;
  if (
    control.subscribers.size === 0 &&
    (control.pendingMutations.size === 0 || retriesExhausted) &&
    !control.flushPromise &&
    !control.pendingPersistPromise
  ) {
    // Unsynced mutations remain in the project/user/board-scoped IndexedDB key.
    // Once automatic retries are exhausted, release the socket/control instead
    // of keeping a free Render connection alive after the board UI is closed.
    disposeBoardPersistence(control.boardId);
  }
}

function scheduleRetry(control: BoardControl): void {
  if (
    control.disposed ||
    isSandboxEnvironment() ||
    control.boardData?.effectiveCanWrite !== true ||
    control.pendingMutations.size === 0 ||
    control.retryTimer
  ) return;
  if (control.retryAttempt >= MAX_AUTO_RETRY_ATTEMPTS) {
    console.warn(`Automatic checkpoint retries paused for board ${control.boardId}; pending edits remain recoverable.`);
    disposeControlIfIdle(control);
    return;
  }

  const attempt = Math.min(control.retryAttempt, MAX_AUTO_RETRY_ATTEMPTS - 1);
  const delay = Math.min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * 2 ** attempt);
  const jitter = Math.floor(Math.random() * Math.min(1_000, Math.max(250, delay * 0.1)));
  control.retryAttempt += 1;
  control.retryTimer = setTimeout(() => {
    control.retryTimer = null;
    runScheduledFlush(control, 'retry-backoff');
  }, delay + jitter);
}

export function applyBoardMetadataPatchLocally(boardId: string, patch: Record<string, unknown>): void {
  const control = activeControls.get(boardId);
  if (!control || control.disposed) return;
  control.boardData = {
    ...(control.boardData || {}),
    ...sanitizeForDatabase(patch),
  };
  notify(control);
}

function applyEffectivePermission(
  control: BoardControl,
  permission: string,
  canWrite: boolean,
  canManage: boolean
): void {
  const previouslyCanWrite = control.boardData?.effectiveCanWrite === true;
  control.boardData = {
    ...(control.boardData || {}),
    effectivePermission: permission,
    effectiveCanWrite: canWrite,
    effectiveCanManage: canManage,
  };

  if (previouslyCanWrite && !canWrite) {
    clearFlushTimers(control);
    clearRetryTimer(control);
    // Keep the account-scoped queue for possible later restoration, but do not
    // display or repeatedly submit edits while this session is read-only.
    rebuildCurrentElements(control);
  } else if (!previouslyCanWrite && canWrite && control.hydrated) {
    control.retryAttempt = 0;
    clearRetryTimer(control);
    control.pendingRestored = false;
    void restorePending(control, true)
      .then(() => {
        rebuildCurrentElements(control);
        notify(control);
        if (control.pendingMutations.size > 0) scheduleFlush(control);
      })
      .catch((error) => console.error('Unable to restore pending edits after permission upgrade.', error));
  }
  notify(control);
}

function startPersistenceSocket(control: BoardControl): void {
  if (control.socketMessageUnsubscribe || isSandboxEnvironment()) return;

  control.socketStatusUnsubscribe = subscribeBoardSocketStatus(control.boardId, (status) => {
    control.socketAuthenticated = status.authenticated;
    if (status.authenticated) {
      applyEffectivePermission(control, status.permission, status.canWrite, status.canManage);
    }
  });

  control.socketMessageUnsubscribe = subscribeBoardSocketMessages(control.boardId, (message) => {
    if (message.type === 'permission_updated') {
      applyEffectivePermission(
        control,
        String(message.permission || 'viewer'),
        message.canWrite === true,
        message.canManage === true
      );
      return;
    }

    if (message.type === 'board_settings_changed' && message.boardId === control.boardId) {
      applyBoardMetadataPatchLocally(control.boardId, {
        studentsCanWrite: message.studentsCanWrite === true,
        updatedAt: Number(message.updatedAt || Date.now()),
      });
      return;
    }

    if (message.type !== 'board_manifest_changed' || message.boardId !== control.boardId) return;
    const nextRevision = Number(message.revision || 0);
    if (!Number.isSafeInteger(nextRevision) || nextRevision <= control.revision) return;
    enqueueManifestRefresh(control, {
      revision: nextRevision,
      changedShardIds: Array.isArray(message.changedShardIds) ? message.changedShardIds : [],
      deletedShardIds: Array.isArray(message.deletedShardIds) ? message.deletedShardIds : [],
      boardData: {
        ...(control.boardData || {}),
        currentRevision: nextRevision,
        changedShardIds: message.changedShardIds || [],
        deletedShardIds: message.deletedShardIds || [],
        totalElements: Number(message.totalElements || control.currentElements.size),
        updatedAt: Number(message.updatedAt || Date.now()),
      },
    });
  });
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
  await restorePending(control, control.boardData?.effectiveCanWrite === true);
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
  try {
    callback(stateFromControl(control));
  } catch (subscriberError) {
    console.error('The initial board-state subscriber failed.', subscriberError);
  }
  startPersistenceSocket(control);

  if (!control.hydrated && control.loadState === 'idle') {
    void ensureAuthUser()
      .then((user) => {
        if (!user) throw new Error('Supabase authentication is not ready. Finish Google sign-in or retry guest access.');
        return fetchBoardAndAllShards(control);
      })
      .catch((error) => {
        console.error('Supabase board load failed:', error);
        const message = error instanceof Error ? error.message : String(error);
        if (/access denied|permission denied|not found/i.test(message)) {
          void deleteBoardRecoveryCache(boardId);
        }
        control.loadState = 'error';
        control.loadError = message;
        if (!control.hydrated) {
          control.hydrated = true;
          control.resolveHydration();
        }
        notify(control);
      });
  }

  return () => {
    control.subscribers.delete(callback);
    disposeControlIfIdle(control);
  };
}

function runScheduledFlush(control: BoardControl, reason: string): void {
  if (control.disposed || control.flushPromise) return;
  emitSyncStatus(control.boardId, 'saving-cloud');
  void flushBoardCheckpoint(control.boardId, reason)
    .then(() => {
      control.retryAttempt = 0;
      clearRetryTimer(control);
      emitSyncStatus(control.boardId, 'synced');
      disposeControlIfIdle(control);
    })
    .catch((error) => {
      console.error(`Supabase board checkpoint failed (${reason}):`, error);
      emitSyncStatus(control.boardId, 'offline', error);
      scheduleRetry(control);
      disposeControlIfIdle(control);
    });
}

function scheduleFlush(control: BoardControl): void {
  if (isSandboxEnvironment() || control.boardData?.effectiveCanWrite !== true || control.disposed) return;
  clearRetryTimer(control);
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
  if (!isSandboxEnvironment() && control.boardData?.effectiveCanWrite !== true) {
    throw new Error(control.hydrated
      ? 'This board is read-only for the current account.'
      : 'Board permissions are still loading. Please wait before editing.');
  }
  if (typeof elementId !== 'string' || elementId.length < 1 || elementId.length > 128) {
    throw new Error('Element ID is invalid.');
  }
  control.dirtyGeneration += 1;
  control.retryAttempt = 0;
  clearRetryTimer(control);

  let clean: BoardElement | null = action === 'delete' ? null : data;
  if (action === 'set' && data) {
    clean = sanitizeElementForStorage({ ...data, id: elementId } as BoardElement);
    if (clean.type === 'drawing' && Array.isArray((clean as any).points)) {
      clean = { ...clean, points: limitDrawingPoints((clean as any).points) } as BoardElement;
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

export function mergeRemoteElementData(
  existing: BoardElement | undefined,
  incoming: BoardElement | Partial<BoardElement>,
  elementId: string,
  isMerge: boolean,
): BoardElement {
  // Compact realtime patches (for example { text: "hello" }) are only valid
  // when they can be merged into an existing complete element. Sanitize the
  // completed candidate, not the partial patch by itself, so normal persistence
  // validation remains the single source of truth.
  const candidate = isMerge && existing
    ? { ...existing, ...incoming, id: elementId }
    : { ...incoming, id: elementId };

  let clean = sanitizeElementForStorage(candidate as BoardElement);
  if (clean.type === 'drawing' && Array.isArray((clean as any).points)) {
    clean = { ...clean, points: limitDrawingPoints((clean as any).points) } as BoardElement;
  }
  return clean;
}

export function applyRemoteOperation(boardId: string, operation: RemoteOperation): void {
  const control = getOrCreateControl(boardId);
  if (control.appliedOperationIds.has(operation.operationId)) return;
  control.appliedOperationIds.add(operation.operationId);
  if (control.appliedOperationIds.size > 2_000) {
    Array.from(control.appliedOperationIds).slice(0, 500).forEach((id) => control.appliedOperationIds.delete(id));
  }

  // Local unsynced work wins in this tab until the checkpoint RPC resolves the
  // conflict. Never let a transient realtime message overwrite that queue.
  if (control.pendingMutations.has(operation.elementId)) return;

  const shardId = getShardIdForElement(operation.elementId);
  const shard = new Map(control.shards.get(shardId) || []);
  if (operation.action === 'delete') {
    shard.delete(operation.elementId);
    control.currentElements.delete(operation.elementId);
  } else if (operation.data) {
    try {
      const existing = control.currentElements.get(operation.elementId);
      const next = mergeRemoteElementData(
        existing,
        operation.data,
        operation.elementId,
        operation.isMerge === true,
      );
      shard.set(operation.elementId, next);
      control.currentElements.set(operation.elementId, next);
    } catch (error) {
      console.warn('Ignored an invalid realtime element update.', error);
      return;
    }
  }
  if (shard.size > 0) control.shards.set(shardId, shard);
  else control.shards.delete(shardId);
  if (control.boardData) control.boardData = { ...control.boardData, updatedAt: operation.updatedAt };
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
  await restorePending(control, control.boardData?.effectiveCanWrite === true);

  if (control.boardData?.effectiveCanWrite !== true) {
    clearFlushTimers(control);
    if (control.pendingMutations.size > 0) {
      throw new Error('Write access is unavailable. Pending edits were preserved for this account.');
    }
    return;
  }
  if (control.pendingMutations.size === 0) return;
  await persistPending(control);
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
  const payloads: RpcMutationPayload[] = Array.from(snapshot.values()).map((mutation) => ({
    elementId: mutation.elementId,
    shardId: getShardIdForElement(mutation.elementId),
    action: mutation.action,
    data: mutation.data,
    updatedAt: mutation.updatedAt,
    updatedByClientId: mutation.updatedByClientId || '',
  }));
  const batches = partitionMutationPayloads(payloads);

  let flushSucceeded = false;
  control.flushPromise = (async () => {
    for (const batch of batches) {
      const activeBatch = batch.filter((payload) => {
        const snapshotted = snapshot.get(payload.elementId);
        const current = control.pendingMutations.get(payload.elementId);
        return Boolean(snapshotted && current?.generation === snapshotted.generation);
      });
      if (activeBatch.length === 0) continue;

      const { data, error } = await supabase.rpc('apply_board_mutations', {
        p_board_id: boardId,
        p_mutations: activeBatch,
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

      let highestCommittedGeneration = control.committedGeneration;
      for (const committedPayload of activeBatch) {
        const snapshotted = snapshot.get(committedPayload.elementId);
        if (!snapshotted) continue;
        highestCommittedGeneration = Math.max(highestCommittedGeneration, snapshotted.generation);
        const current = control.pendingMutations.get(committedPayload.elementId);
        // A newer local edit may have replaced the snapshotted mutation while
        // this batch was in flight. Never remove that newer edit.
        if (current?.generation === snapshotted.generation) {
          control.pendingMutations.delete(committedPayload.elementId);
        }
      }
      control.committedGeneration = highestCommittedGeneration;
      await persistPending(control);
      rebuildCurrentElements(control);
      trackOperation('tx_commit', 'supabase-board-checkpoint-rpc', 1);
      trackOperation('write', 'supabase-affected-shards', (result?.changedShardIds || []).length);
      trackOperation('write', 'supabase-board-manifest', 1);
      notify(control);

      if (control.socketAuthenticated) {
        sendBoardSocketMessage(boardId, {
          type: 'board_manifest_changed',
          revision: control.revision,
          changedShardIds: result?.changedShardIds || [],
          deletedShardIds: result?.deletedShardIds || [],
          totalElements: Number(result?.totalElements || 0),
          updatedAt: Date.now(),
        });
      }
    }
    control.retryAttempt = 0;
    clearRetryTimer(control);
    flushSucceeded = true;
  })()
    .finally(() => {
      control.flushPromise = null;
      if (
        flushSucceeded &&
        control.boardData?.effectiveCanWrite === true &&
        (control.nextFlushRequested || control.pendingMutations.size > 0)
      ) {
        control.nextFlushRequested = false;
        scheduleFlush(control);
      } else if (!flushSucceeded) {
        // The caller schedules a bounded retry. Avoid a tight two-second retry
        // loop while the network or Supabase is unavailable.
        control.nextFlushRequested = false;
      }
      if (flushSucceeded) disposeControlIfIdle(control);
    });

  return control.flushPromise;
}

export interface FlushAllBoardCheckpointsResult {
  flushed: boolean;
  pendingBoards: string[];
}

/**
 * Best-effort checkpoint drain used before sign-out or a deliberate app close.
 * Failed board IDs are returned so the caller can preserve the current user's
 * scoped IndexedDB recovery data instead of deleting unsynced work.
 */
export async function flushAllBoardCheckpoints(
  reason: string = 'flush-all'
): Promise<FlushAllBoardCheckpointsResult> {
  const controls = Array.from(activeControls.values())
    .filter((control) => !control.disposed && control.pendingMutations.size > 0);
  if (controls.length === 0) return { flushed: true, pendingBoards: [] };

  const results = await Promise.allSettled(
    controls.map((control) => flushBoardCheckpoint(control.boardId, reason))
  );
  const pendingBoards = results.flatMap((result, index) =>
    result.status === 'rejected' ? [controls[index].boardId] : []
  );
  return { flushed: pendingBoards.length === 0, pendingBoards };
}

export function getPendingCheckpointBoardIds(): string[] {
  return Array.from(activeControls.values())
    .filter((control) => !control.disposed && control.pendingMutations.size > 0)
    .map((control) => control.boardId);
}

export async function initializeBoardWithElements(
  boardId: string,
  elements: BoardElement[],
  boardData: any
): Promise<void> {
  const user = await ensureAuthUser();
  if (!user) throw new Error('Supabase authentication is not ready. Finish Google sign-in or retry guest access.');

  // The board is created in `initializing` state before its assets are uploaded.
  // Patch only the fields explicitly allowed by the hardened metadata RPC.
  const { error: patchError } = await supabase.rpc('patch_board', {
    p_board_id: boardId,
    p_patch: {
      name: String(boardData?.name || 'Untitled Board'),
      description: String(boardData?.description || ''),
      studentId: String(boardData?.studentId || ''),
      studentName: String(boardData?.studentName || ''),
      studentsCanWrite: boardData?.studentsCanWrite !== false,
      accessMode: boardData?.accessMode === 'shared' ? 'shared' : 'private',
      status: 'initializing',
      updatedAt: Date.now(),
    },
  });
  if (patchError) throw new Error(patchError.message);

  const mutations: RpcMutationPayload[] = elements.map((element, index) => {
    const clean = sanitizeElementForStorage(element);
    const bytes = new TextEncoder().encode(JSON.stringify(clean)).byteLength;
    if (bytes > MAX_SINGLE_ELEMENT_BYTES) {
      throw new Error(`Initial element ${clean.id} is too large (${Math.round(bytes / 1024)} KB).`);
    }
    return {
      elementId: clean.id,
      shardId: getShardIdForElement(clean.id),
      action: 'set',
      data: clean,
      updatedAt: Number((clean as any).updatedAt || Date.now() + index),
      updatedByClientId: 'initial-import',
    };
  });

  for (const batch of partitionMutationPayloads(mutations)) {
    const { error } = await supabase.rpc('apply_board_mutations', {
      p_board_id: boardId,
      p_mutations: batch,
    });
    if (error) throw new Error(error.message);
  }

  const { error: readyError } = await supabase.rpc('finalize_board_initialization', {
    p_board_id: boardId,
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
    if (control.retryTimer) clearTimeout(control.retryTimer);
    control.retryTimer = null;
    control.socketAuthenticated = false;
    control.socketMessageUnsubscribe?.();
    control.socketStatusUnsubscribe?.();
    control.socketMessageUnsubscribe = null;
    control.socketStatusUnsubscribe = null;
    control.pendingManifestRefresh = null;
    control.manifestRefreshPromise = null;
    activeControls.delete(id);
  }
}
