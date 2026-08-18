# Whiteboard architecture and free-tier behavior

## Dashboard

`list_my_boards_page` returns a lightweight, RLS-filtered keyset page ordered by
`(created_at, id)`. Full board JSON and shards are not downloaded merely to render
the dashboard, and stale page responses are ignored.

## Initial board load and offline edits

The client first resolves authenticated board access, then loads one
`get_board_state(board_id)` RPC containing the board manifest, existing shards,
and asset metadata. Media bytes are still fetched from private Storage only when
needed.
Unsynced mutations are stored under project/user/board IndexedDB keys. Their
restoration completes before cloud hydration is considered ready, preventing a
slow IndexedDB read from losing local work or briefly exposing another account's
cached content.

Cloud boards do not maintain duplicate full-board browser snapshots. A legacy
unscoped mutation queue can be adopted only for a current writer after RLS
authorization. Old complete-board snapshots are discarded instead of being
replayed over newer collaborator state. If write access is removed, the original
account's pending queue remains stored but is hidden and not retried until write
access returns.

## Writes

Edits are local-first and deduplicated by element ID. A checkpoint runs after an
idle debounce or maximum window and calls `apply_board_mutations`. The transaction
locks the board manifest, validates and groups mutations by deterministic shard,
updates only affected rows, advances one compact revision, and commits atomically.
Direct browser writes to `board_shards` are disabled.

Reconnects, large pastes, and imports are partitioned into resumable batches of at
most 400 mutations and approximately 6 MB. Successful batches remove only the
exact queued generations they committed, so newer in-flight edits remain pending.
IndexedDB queue writes are serialized to prevent an older snapshot from completing
last.

PDF boards use the same bounded mutation path, followed by
`finalize_board_initialization`.

## Realtime collaboration

One authenticated WebSocket is shared per board by all canvas and persistence
subscribers. The relay carries cursors, live strokes, element previews, focus,
laser, timer, follow mode, and compact manifest notifications. Cursor and drawing
preview traffic never enters Postgres. Durable manifest messages wait for
authentication; ephemeral events are dropped under disconnection or backpressure.

## Media

Images, signatures, audio, and PDF pages are uploaded to private Supabase Storage.
Rows contain asset IDs and metadata rather than Base64 media. Downloads use
self-contained data URLs in a 64 MB bounded LRU cache with project/user/board/asset
identity scoping, a 30-day persistent IndexedDB cache, and in-flight request
deduplication. Persistent hits require the current asset content hash from
authorized board metadata.

## Graphs and exports

Graph expressions are parsed by a bounded math grammar; the CSP remains strict and
no runtime JavaScript evaluation is used. Exports render persisted private media,
graphs, tables, annotations, and an audio placeholder to a bounded canvas. SVG is
raster-backed so it can include private images without unsafe foreign objects.

## Presence and operations

Presence uses a low-frequency visible-page heartbeat rather than interaction
writes. The admin presence subscription exists only while the admin panel is open.
The health endpoint checks the Render process without querying Supabase. Destructive
board operations retry transient failures and visibly restore state when completion
cannot be confirmed.

## Realtime ordering and validation

Manifest notifications are processed through one per-board serial queue. Only the
newest pending revision is retained, and responses for revisions older than the
current local revision are discarded. This prevents network timing from rolling a
board back after simultaneous collaborator saves.

Live drawing previews are evenly sampled to a maximum of 900 points for transport;
the final drawing uses the complete locally collected stroke and is persisted by
the normal mutation checkpoint. Element previews and timers are validated again
by the Render relay before broadcasting.

## Identity changes with offline edits

Permanent accounts may leave with their scoped recovery queue preserved for the
same account. Anonymous accounts are different because the guest identity may not
be recoverable after sign-out. Guest sign-out or Google switching is therefore
blocked until pending edits are cloud-synced.
