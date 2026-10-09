# UX-1 classroom productivity and recovery

## Delivered behavior

- **Cover / Reveal:** select an answer and choose Cover Answer in the existing More menu, or add a cover at the current view center. Move and resize the cover using its handles. A teacher/manager can reveal or hide with one click. Viewer controls are disabled; the existing mutation RPC rejects viewer writes. Covers are ordinary persisted shape elements with additive JSON fields, use canvas coordinates, and synchronize over the existing relay/checkpoint flow. Hidden covers paint above drawings in image/PDF exports; revealed covers do not paint.
- **Duplicate:** cloud copies contain the board elements, new element/connector IDs, preserved PDF page prefixes, relative positions and layers, and private media uploaded under the destination board. Images are not recompressed during transfer. Retained original PDFs and other registered assets are included. No memberships, share links, or permissions are inherited; copies are private with student editing disabled until explicitly shared.
- **Complete archive:** the canvas More menu downloads a version 2 `.whiteboard.json` archive with descriptive metadata, all elements, and base64 media. The dashboard Restore board archive action always creates a separate private board. MIME signatures, base64, actual byte sizes, supported versions, ID/path safety, count limits, numeric fields, and storage element limits are checked. Storage RLS/quota checks remain authoritative. Upload/initialization failure cleans only the new draft, including objects uploaded without metadata; cleanup errors name the draft and remain visible.
- **Safe clear:** PDF page backgrounds and all private assets survive clearing. Choose Clear All Annotations or Clear Active Page Annotations from More. Clearing first prepares a complete archive, checks for concurrent changes, requests a download, and requires confirmation that the file finished saving. It checks again before deleting the captured annotations. The dialog truthfully says Ctrl+Z cannot undo this collaborative action. Restore the archive into a new board rather than overwriting newer edits. A drawing spanning page boundaries is retained during active-page clearing.
- **Pinned / Recently Opened:** compact shortcuts retain existing search/category filters and work outside the current dashboard page. Preferences and loaded shortcut/list results are scoped by authenticated user. No new database tables are used.
- **Personal view:** each user/board remembers bounded pan/zoom locally. Reset View lives in More and is disabled while following/presenting. Following and Presenter Mode do not overwrite the personal camera; stopping restores it.
- **PDF bookmarks:** bookmark and label pages in the existing page drawer. Click a label to navigate. Stable page IDs preserve bookmarks through reordering, and deleted pages disappear from bookmarks. Personal bookmarks are local per board/user.

## Corrected drawing handoff

The canvas supplied revision `0` for unversioned relay element updates. The persistence controller rejected these messages as stale on any existing board with a positive revision. The sender also ended the drawing stream before broadcasting the completed element, leaving the student's screen blank until a cloud checkpoint arrived.

Relay previews now omit an unknown revision; explicit stale revisions remain rejected. Completed strokes are sent before stream end. Bounded remote previews survive unrelated shard refreshes and earlier checkpoints from the same author, then yield to the authoritative committed change. Unconfirmed previews expire after 30 seconds and are never persisted by a viewer. Long completed strokes are sampled for the relay while the full persisted stroke is retained. STAB-1 timers, relay authorization, and Smart Live Cursors are preserved.

## Format and operational limits

- At most 50,000 elements, 2,000 assets, 20 MiB per asset, 128 MiB aggregate media, and 256 MiB serialized archive. Duplication shares these conservative transfer limits. Database limits additionally bound single elements to 900 KB and drawings to 20,000 points.
- The archive is uncompressed JSON; large media boards require memory and download time. Unsupported/over-limit boards fail before destructive changes.
- Legacy version 1 JSON restores drawings/text and embedded valid media. Old cloud backups that contain only asset IDs cannot reconstruct missing binaries; restore fails clearly and asks for a complete re-export from the original board. Signed/external/blob media URLs are not treated as portable binaries.
- Original PDF source bytes are included only when still registered in private Storage. For existing imports that retain raster pages only, those pages and annotations are fully archived; missing original PDF bytes cannot be recovered.
- Pins, recents, viewports, and bookmarks are personal device preferences and are not transferred to a different device or copied to a different board.
- A browser download cannot prove a file was saved to disk; the clear workflow explicitly requires the teacher to confirm that it finished saving.
- If connectivity prevents cleanup, the destination remains an owner-only `initializing` draft; the error includes its ID. Do not retry repeatedly until the draft's Storage objects and record have been removed by its owner. Source content/assets are never deleted by the transfer service.
- Automated tests use synthetic lesson boards and actual PNG/audio/PDF header fixtures with mocked Storage transport, plus isolated real PostgreSQL permission tests. No hosted Storage transfer or teacher/student browser-device acceptance has been claimed. No browser/desktop automation or Chrome profile access was used.

## Database / Storage changes

**New migrations: none.** No new tables, RLS policies, buckets, or production writes. Covers use additive fields in existing shape JSON. Existing `create_board`, `apply_board_mutations`, `get_board_state`, and initialization RPCs remain authoritative. Transfers upload to the existing private `board-assets` bucket using destination-scoped paths. Ordinary clearing never deletes assets.

`.gitattributes` pins SQL files to LF and the canonical schema is regenerated with three whitespace-only additions. There are no SQL statement changes. Do not reapply the full schema to an existing installation.

## Safe release

1. Review this single PR and the archive/cleanup limitations. Keep the separate uncommitted capacity-testing work outside this release.
2. Schedule release outside an active lesson; confirm the Render auto-deploy policy before manually merging. The agent has neither merged nor deployed.
3. Use the project's Node 22 runtime and existing environment configuration. No UX-1 migration is required; existing installations must already have the eight migrations from merged STAB-1.
4. After the reviewed release, have teacher and student reload onto the same client build. On a disposable private test lesson, check continuous writing at pen-up, reveal synchronization, viewer rejection, duplication with media, complete archive/restore, PDF active-page clearing and separate-board recovery, bookmarks, and personal camera restore.
5. Keep a known-good build for code rollback. Rollback needs no database reversal; existing boards/assets remain in place. New covers are ordinary shapes to an older client, so use the new client for cover/reveal teaching controls.

## Validation

- Complete unit/component suite: 36 files, 194 tests passed (Node 24.19.0).
- Final account-switch isolation check: 6 preference tests passed after adding the list-scope guard.
- Isolated PostgreSQL: all eight upgrade migrations and canonical fresh schema passed 54 assertions, including cover viewer rejection/reload and private-copy defaults.
- Node 22.23.3 final affected-path validation: 8 files, 43 tests passed. Migration consistency and TypeScript checks passed on Node 22.
- Production frontend/server builds passed on both Node 24 and the project's Node 22 runtime. Vite reports existing large-chunk and mixed-import warnings.
