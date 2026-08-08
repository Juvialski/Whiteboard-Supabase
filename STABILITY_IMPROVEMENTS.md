# Post-stable reliability improvements

Baseline: the first version confirmed to load persisted/new images correctly after
restoring `boardId` propagation into `ElementWrapper`, with live textbox updates
also confirmed working.

## Phase 1 — regression guards

- `boardId` is now required by `ElementWrapper`, `ImageComponent`,
  `AudioComponent`, and `StampComponent` whenever persisted media can be loaded.
- Added regression tests that verify the wrapper forwards the exact board context
  to image, audio, and signature-stamp elements.
- Added a hook regression test that reports a missing board context instead of
  silently producing an empty media source.
- Added a live-text timing test covering the 180 ms coalesced update before blur.

## Phase 2 — bounded media loading without object-URL invalidation

- Kept the proven Storage download -> data URL rendering path.
- Added a 64 MB conservative LRU cache for data URLs so large image boards do not
  retain every downloaded asset for the entire browser session.
- Cache eviction only removes the lookup entry. It cannot invalidate an image
  string already held by a mounted React component.
- Cache keys are scoped by authenticated user + board + asset.
- Board/account cache epochs prevent an old in-flight request from repopulating
  private media after a board/account clear.
- Duplicate asset uploads are deduplicated and stray duplicate Storage objects are
  cleaned up when metadata already points to the canonical object.

## Phase 3 — media validation and diagnostics

- New uploads are checked against the allowlisted MIME type and byte signature
  before Storage upload.
- Downloaded private media is checked against its saved MIME metadata before being
  converted for display.
- Media load failures distinguish metadata, Storage download, MIME mismatch, and
  decode failures in browser diagnostics.
- Image load errors expose the detailed reason through the element tooltip while
  keeping the normal Retry control.

## Phase 4 — conflict-safe realtime partial updates

- Incoming `element_update` messages are routed through the persistence
  controller again instead of directly replacing React state.
- The persistence controller now supports compact merge patches by merging them
  with the existing complete element *before* running normal element validation.
- This preserves the working live-text behavior while restoring the rule that a
  local unsynced mutation wins in the current tab until the checkpoint RPC
  resolves the conflict.
- Added regression tests for valid compact text merges and invalid orphan merge
  patches.

## Deployment

No Supabase migration is required. No Render build/start command changes are
required. Deploy the application files normally.
