import { supabase } from '../supabase';

type RefKind = 'document' | 'collection';

export interface DocumentReference {
  kind: 'document';
  path: string[];
  id: string;
}

export interface CollectionReference {
  kind: 'collection';
  path: string[];
  id: string;
}

export type QueryConstraint =
  | { type: 'where'; field: string; op: string; value: unknown }
  | { type: 'orderBy'; field: string; direction: 'asc' | 'desc' }
  | { type: 'limit'; count: number }
  | { type: 'startAfter'; snapshot: DocumentSnapshot };

export interface QueryReference {
  kind: 'query';
  collection: CollectionReference;
  constraints: QueryConstraint[];
}

export class DocumentSnapshot {
  readonly ref: DocumentReference;
  readonly id: string;
  private readonly value: Record<string, any> | null;

  constructor(ref: DocumentReference, value: Record<string, any> | null) {
    this.ref = ref;
    this.id = ref.id;
    this.value = value;
  }

  exists(): boolean {
    return this.value !== null;
  }

  data(): Record<string, any> | undefined {
    return this.value ? { ...this.value } : undefined;
  }
}

export class QuerySnapshot {
  readonly docs: DocumentSnapshot[];
  readonly size: number;
  readonly empty: boolean;

  constructor(docs: DocumentSnapshot[]) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }

  forEach(callback: (snapshot: DocumentSnapshot) => void): void {
    this.docs.forEach(callback);
  }
}

const BOARD_FIELD_TO_COLUMN: Record<string, string> = {
  name: 'name',
  description: 'description',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  createdBy: 'created_by',
  ownerUid: 'owner_uid',
  accessMode: 'access_mode',
  editorUids: 'editor_uids',
  viewerUids: 'viewer_uids',
  status: 'status',
  studentId: 'student_id',
  studentName: 'student_name',
  studentsCanWrite: 'students_can_write',
  schemaVersion: 'schema_version',
  shardLayoutVersion: 'shard_layout_version',
  shardCount: 'shard_count',
  currentRevision: 'current_revision',
  changedShardIds: 'changed_shard_ids',
  deletedShardIds: 'deleted_shard_ids',
  totalElements: 'total_elements',
};

const PRESENCE_FIELD_TO_COLUMN: Record<string, string> = {
  id: 'id',
  profileId: 'profile_id',
  name: 'name',
  email: 'email',
  lastActive: 'last_active',
  isOnline: 'is_online',
  role: 'role',
  currentBoardId: 'current_board_id',
  currentBoardName: 'current_board_name',
};

const SETTINGS_FIELD_TO_COLUMN: Record<string, string> = {
  appEnabled: 'app_enabled',
  updatedAt: 'updated_at',
  updatedBy: 'updated_by',
};

const DELETE_SENTINEL = Symbol('delete-field');

export function deleteField(): symbol {
  return DELETE_SENTINEL;
}

export function increment(by: number): { __increment: number } {
  return { __increment: by };
}

export function collection(
  _dbOrRef: unknown,
  ...segments: string[]
): CollectionReference {
  const base = isReference(_dbOrRef) ? _dbOrRef.path : [];
  const path = [...base, ...segments];
  return { kind: 'collection', path, id: path[path.length - 1] || '' };
}

export function doc(
  _dbOrRef: unknown,
  ...segments: string[]
): DocumentReference {
  const base = isReference(_dbOrRef) ? _dbOrRef.path : [];
  const path = [...base, ...segments];

  if (path.length % 2 === 1) {
    path.push(crypto.randomUUID());
  }

  return {
    kind: 'document',
    path,
    id: path[path.length - 1],
  };
}

export function where(field: string, op: string, value: unknown): QueryConstraint {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint {
  return { type: 'orderBy', field, direction };
}

export function limit(count: number): QueryConstraint {
  return { type: 'limit', count };
}

export function startAfter(snapshot: DocumentSnapshot): QueryConstraint {
  return { type: 'startAfter', snapshot };
}

export function query(
  collectionRef: CollectionReference,
  ...constraints: QueryConstraint[]
): QueryReference {
  return { kind: 'query', collection: collectionRef, constraints };
}

function isReference(value: unknown): value is DocumentReference | CollectionReference {
  return Boolean(value && typeof value === 'object' && 'path' in value);
}

function throwIfError(error: any): void {
  if (error) throw new Error(error.message || String(error));
}

function emitLocalChange(path: string[]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('supabase-db-change', { detail: { path } }));
}

function mapBoardRow(row: any): Record<string, any> {
  return {
    ...(row.data || {}),
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
    shardCount: Number(row.shard_count || 16),
    currentRevision: Number(row.current_revision || 0),
    changedShardIds: row.changed_shard_ids || [],
    deletedShardIds: row.deleted_shard_ids || [],
    totalElements: Number(row.total_elements || 0),
  };
}

function mapPresenceRow(row: any): Record<string, any> {
  return {
    ...(row.data || {}),
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    email: row.email,
    lastActive: Number(row.last_active || 0),
    isOnline: Boolean(row.is_online),
    role: row.role,
    currentBoardId: row.current_board_id,
    currentBoardName: row.current_board_name,
  };
}

function mapSettingsRow(row: any): Record<string, any> {
  return {
    ...(row.data || {}),
    appEnabled: row.app_enabled !== false,
    updatedAt: Number(row.updated_at || 0),
    updatedBy: row.updated_by || null,
  };
}

function mapShardRow(row: any): Record<string, any> {
  return {
    shardId: row.shard_id,
    revision: Number(row.revision || 0),
    elements: row.elements || {},
    tombstones: row.tombstones || {},
    updatedAt: Number(row.updated_at || 0),
  };
}

function mapAssetRow(row: any): Record<string, any> {
  return {
    assetId: row.asset_id,
    mimeType: row.mime_type,
    objectPath: row.object_path,
    encodedByteSize: Number(row.encoded_byte_size || 0),
    originalByteSize: row.original_byte_size == null ? undefined : Number(row.original_byte_size),
    width: row.width == null ? undefined : Number(row.width),
    height: row.height == null ? undefined : Number(row.height),
    contentHash: row.content_hash,
    createdAt: Number(row.created_at || 0),
    createdBy: row.created_by || undefined,
  };
}

function boardRowFromData(id: string, data: Record<string, any>): Record<string, any> {
  const now = Date.now();
  return {
    id,
    name: data.name || 'Untitled Board',
    description: data.description || '',
    created_at: Number(data.createdAt || now),
    updated_at: Number(data.updatedAt || now),
    created_by: data.createdBy || 'Unknown',
    owner_uid: data.ownerUid,
    access_mode: data.accessMode || 'private',
    editor_uids: Array.isArray(data.editorUids) ? data.editorUids : [],
    viewer_uids: Array.isArray(data.viewerUids) ? data.viewerUids : [],
    status: data.status || 'ready',
    student_id: data.studentId || '',
    student_name: data.studentName || '',
    students_can_write: data.studentsCanWrite !== false,
    schema_version: Number(data.schemaVersion || 4),
    shard_layout_version: Number(data.shardLayoutVersion || 3),
    shard_count: Number(data.shardCount || 16),
    current_revision: Number(data.currentRevision || 0),
    changed_shard_ids: Array.isArray(data.changedShardIds) ? data.changedShardIds : [],
    deleted_shard_ids: Array.isArray(data.deletedShardIds) ? data.deletedShardIds : [],
    total_elements: Number(data.totalElements || 0),
    data,
  };
}

function mapFieldsToColumns(
  data: Record<string, any>,
  map: Record<string, string>
): Record<string, any> {
  const row: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === DELETE_SENTINEL) continue;
    const column = map[key];
    if (column) row[column] = value;
  }
  return row;
}

function resolveResource(path: string[]): {
  table: string;
  type: 'boards' | 'shards' | 'assets' | 'presence' | 'settings';
  boardId?: string;
} {
  if (path[0] === 'whiteboards') {
    if (path.length <= 2) return { table: 'boards', type: 'boards' };
    const sub = path[2];
    if (sub === 'shards') {
      return { table: 'board_shards', type: 'shards', boardId: path[1] };
    }
    if (sub === 'assets') {
      return { table: 'board_assets', type: 'assets', boardId: path[1] };
    }
  }
  if (path[0] === 'presence') return { table: 'presence', type: 'presence' };
  if (path[0] === 'admin_settings') return { table: 'admin_settings', type: 'settings' };
  throw new Error(`Unsupported Supabase compatibility path: ${path.join('/')}`);
}

function mapResourceRow(type: ReturnType<typeof resolveResource>['type'], row: any): Record<string, any> {
  switch (type) {
    case 'boards': return mapBoardRow(row);
    case 'shards': return mapShardRow(row);
    case 'assets': return mapAssetRow(row);
    case 'presence': return mapPresenceRow(row);
    case 'settings': return mapSettingsRow(row);
  }
}

function idColumn(type: ReturnType<typeof resolveResource>['type']): string {
  if (type === 'shards') return 'shard_id';
  if (type === 'assets') return 'asset_id';
  return 'id';
}

function fieldToColumn(type: ReturnType<typeof resolveResource>['type'], field: string): string {
  if (type === 'boards') return BOARD_FIELD_TO_COLUMN[field] || field;
  if (type === 'presence') return PRESENCE_FIELD_TO_COLUMN[field] || field;
  if (type === 'settings') return SETTINGS_FIELD_TO_COLUMN[field] || field;
  if (type === 'shards') {
    return ({ shardId: 'shard_id', updatedAt: 'updated_at' } as Record<string, string>)[field] || field;
  }
  if (type === 'assets') {
    return ({ assetId: 'asset_id', createdAt: 'created_at' } as Record<string, string>)[field] || field;
  }
  return field;
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  const resource = resolveResource(ref.path);
  let request: any = supabase.from(resource.table).select('*');

  if (resource.boardId) request = request.eq('board_id', resource.boardId);
  request = request.eq(idColumn(resource.type), ref.id).maybeSingle();

  const { data, error } = await request;
  throwIfError(error);
  return new DocumentSnapshot(ref, data ? mapResourceRow(resource.type, data) : null);
}

export async function getDocs(
  source: CollectionReference | QueryReference
): Promise<QuerySnapshot> {
  const collectionRef = source.kind === 'query' ? source.collection : source;
  const constraints = source.kind === 'query' ? source.constraints : [];
  const resource = resolveResource(collectionRef.path);

  let request: any = supabase.from(resource.table).select('*');
  if (resource.boardId) request = request.eq('board_id', resource.boardId);

  const ordering = constraints.find((item) => item.type === 'orderBy') as Extract<QueryConstraint, { type: 'orderBy' }> | undefined;

  for (const constraint of constraints) {
    if (constraint.type === 'where') {
      const column = fieldToColumn(resource.type, constraint.field);
      if (constraint.op === '==') request = request.eq(column, constraint.value);
      else if (constraint.op === 'array-contains') request = request.contains(column, [constraint.value]);
      else if (constraint.op === 'in') request = request.in(column, constraint.value as any[]);
      else if (constraint.op === '>') request = request.gt(column, constraint.value);
      else if (constraint.op === '>=') request = request.gte(column, constraint.value);
      else if (constraint.op === '<') request = request.lt(column, constraint.value);
      else if (constraint.op === '<=') request = request.lte(column, constraint.value);
      else throw new Error(`Unsupported query operator: ${constraint.op}`);
    } else if (constraint.type === 'orderBy') {
      request = request.order(fieldToColumn(resource.type, constraint.field), {
        ascending: constraint.direction === 'asc',
      });
    } else if (constraint.type === 'limit') {
      request = request.limit(constraint.count);
    } else if (constraint.type === 'startAfter' && ordering) {
      const data = constraint.snapshot.data() || {};
      const value = data[ordering.field];
      const column = fieldToColumn(resource.type, ordering.field);
      request = ordering.direction === 'desc' ? request.lt(column, value) : request.gt(column, value);
    }
  }

  const { data, error } = await request;
  throwIfError(error);

  const docs = (data || []).map((row: any) => {
    const mapped = mapResourceRow(resource.type, row);
    const id = String(row[idColumn(resource.type)]);
    const ref = doc(null, ...collectionRef.path, id);
    return new DocumentSnapshot(ref, mapped);
  });
  return new QuerySnapshot(docs);
}

export async function setDoc(
  ref: DocumentReference,
  data: Record<string, any>,
  options?: { merge?: boolean }
): Promise<void> {
  const resource = resolveResource(ref.path);

  if (resource.type === 'boards') {
    if (options?.merge) {
      const { error } = await supabase.rpc('patch_board', {
        p_board_id: ref.id,
        p_patch: data,
      });
      if (error) {
        console.warn('patch_board RPC error, falling back to direct update:', error.message);
        const updates: Record<string, any> = {};
        for (const [key, val] of Object.entries(data)) {
          const col = BOARD_FIELD_TO_COLUMN[key];
          if (col) updates[col] = val;
        }
        updates.updated_at = Date.now();
        const { error: directError } = await supabase.from('boards').update(updates).eq('id', ref.id);
        throwIfError(directError);
      }
      emitLocalChange(ref.path);
      return;
    }
    const row = boardRowFromData(ref.id, data);
    const { error } = await supabase.from('boards').upsert(row, { onConflict: 'id' });
    throwIfError(error);
    emitLocalChange(ref.path);
    return;
  }

  if (resource.type === 'presence') {
    const row = {
      id: ref.id,
      ...mapFieldsToColumns(data, PRESENCE_FIELD_TO_COLUMN),
      data,
    };
    const { error } = await supabase.from('presence').upsert(row, { onConflict: 'id' });
    throwIfError(error);
    emitLocalChange(ref.path);
    return;
  }

  if (resource.type === 'settings') {
    const row = {
      id: ref.id,
      ...mapFieldsToColumns(data, SETTINGS_FIELD_TO_COLUMN),
      data,
    };
    const { error } = await supabase.from('admin_settings').upsert(row, { onConflict: 'id' });
    throwIfError(error);
    emitLocalChange(ref.path);
    return;
  }

  if (resource.type === 'shards') {
    const row = {
      board_id: resource.boardId,
      shard_id: ref.id,
      revision: Number(data.revision || 0),
      elements: data.elements || {},
      tombstones: data.tombstones || {},
      updated_at: Number(data.updatedAt || Date.now()),
    };
    const { error } = await supabase.from('board_shards').upsert(row, { onConflict: 'board_id,shard_id' });
    throwIfError(error);
    emitLocalChange(ref.path);
    return;
  }

  if (resource.type === 'assets') {
    const row = {
      board_id: resource.boardId,
      asset_id: ref.id,
      mime_type: data.mimeType,
      object_path: data.objectPath,
      encoded_byte_size: data.encodedByteSize || 0,
      original_byte_size: data.originalByteSize || null,
      width: data.width || null,
      height: data.height || null,
      content_hash: data.contentHash,
      created_at: data.createdAt || Date.now(),
      created_by: data.createdBy || null,
    };
    const { error } = await supabase.from('board_assets').upsert(row, { onConflict: 'board_id,asset_id' });
    throwIfError(error);
    emitLocalChange(ref.path);
  }
}

export async function updateDoc(ref: DocumentReference, data: Record<string, any>): Promise<void> {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === DELETE_SENTINEL) normalized[key] = null;
    else if (value && typeof value === 'object' && '__increment' in value) {
      throw new Error(`Increment updates are not supported for ${key}; use an RPC-backed counter.`);
    } else normalized[key] = value;
  }
  await setDoc(ref, normalized, { merge: true });
}

export async function addDoc(
  collectionRef: CollectionReference,
  data: Record<string, any>
): Promise<DocumentReference> {
  const ref = doc(collectionRef);
  await setDoc(ref, { ...data, id: ref.id });
  return ref;
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  const resource = resolveResource(ref.path);

  if (resource.type === 'assets') {
    const { data } = await supabase
      .from('board_assets')
      .select('object_path')
      .eq('board_id', resource.boardId)
      .eq('asset_id', ref.id)
      .maybeSingle();
    if (data?.object_path) {
      await supabase.storage.from('board-assets').remove([data.object_path]);
    }
    const { error } = await supabase
      .from('board_assets')
      .delete()
      .eq('board_id', resource.boardId)
      .eq('asset_id', ref.id);
    throwIfError(error);
    emitLocalChange(ref.path);
    return;
  }

  let request: any = supabase.from(resource.table).delete();
  if (resource.boardId) request = request.eq('board_id', resource.boardId);
  request = request.eq(idColumn(resource.type), ref.id);
  const { error } = await request;
  throwIfError(error);
  emitLocalChange(ref.path);
}

export function writeBatch(_db: unknown) {
  const operations: Array<() => Promise<void>> = [];
  return {
    set(ref: DocumentReference, data: Record<string, any>, options?: { merge?: boolean }) {
      operations.push(() => setDoc(ref, data, options));
    },
    delete(ref: DocumentReference) {
      operations.push(() => deleteDoc(ref));
    },
    update(ref: DocumentReference, data: Record<string, any>) {
      operations.push(() => updateDoc(ref, data));
    },
    async commit() {
      await Promise.all(operations.map((operation) => operation()));
    },
  };
}

export function onSnapshot(
  ref: DocumentReference,
  onNext: (snapshot: DocumentSnapshot) => void,
  onError?: (error: Error) => void
): () => void {
  let active = true;

  const emit = async () => {
    try {
      const snapshot = await getDoc(ref);
      if (active) onNext(snapshot);
    } catch (error) {
      if (active) onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  void emit();

  const listener = (event: Event) => {
    const changedPath = (event as CustomEvent).detail?.path as string[] | undefined;
    if (!changedPath) return;
    if (changedPath.join('/') === ref.path.join('/')) void emit();
  };
  if (typeof window !== 'undefined') window.addEventListener('supabase-db-change', listener);

  return () => {
    active = false;
    if (typeof window !== 'undefined') window.removeEventListener('supabase-db-change', listener);
  };
}

export const serverTimestamp = () => Date.now();
