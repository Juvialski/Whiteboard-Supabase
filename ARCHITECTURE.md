# Persistence and Read/Write Optimization

## Dashboard

`list_my_boards(limit, offset)` returns one indexed page containing only boards owned by the current user or explicitly shared through editor/viewer ACLs. This replaces multiple ownership and name-recovery scans.

## Initial board load

The client calls one secured `get_board_state(board_id)` RPC. It returns the board manifest and all existing state shards in one network request, with a maximum layout of 16 shards.

Opening a board from the dashboard also reuses its known name, so no extra metadata request is needed.

## Writes

Element edits are local-first and deduplicated by element ID. A checkpoint is triggered after 1.2 seconds idle or after a five-second maximum window.

Each checkpoint calls one Postgres RPC. The transaction:

- locks the board manifest
- groups mutations by deterministic shard
- applies last-write-wins conflict checks and tombstones
- rewrites only affected JSONB shard rows
- updates the compact board manifest once
- commits atomically

Rapid drag, resize, typing, and drawing updates therefore do not produce one database write per browser event.

## Realtime collaboration

High-frequency data never enters Postgres:

- cursor position
- active drawing stream
- laser pointer
- selection focus
- camera follow
- timer state
- immediate peer element previews

These use the Node WebSocket relay. After the origin client commits a checkpoint, a compact shard-change message tells peers to read only the changed shards.

## Media

Binary media is compressed where appropriate, content-hashed for deduplication, and uploaded to private Supabase Storage. Board rows contain only asset IDs and metadata, not large base64 payloads.

## Offline recovery

Pending mutations are stored in IndexedDB until the atomic RPC succeeds. A failed connection does not discard the local queue, and retries remain deduplicated by element ID.
