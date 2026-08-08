# Remaining-issues audit — completed coordinated pass

This pass was made from the user-supplied `whiteboard-supabase (3).zip`, which is
the sole baseline for this package. Earlier generated archives were not merged
into it.

## Completed in this pass

1. **Account-safe offline edits**
   - Pending-mutation keys include Supabase project, authenticated user, and board.
   - A legacy unscoped mutation queue is adopted only for a currently authorized
     writer. Old full-board snapshots are discarded after authorization rather
     than replayed over newer collaborator state.
   - Pending edits are restored before cloud hydration is considered complete.
   - IndexedDB writes to the same queue are serialized so an older snapshot cannot
     finish last and overwrite newer offline work.
   - Sign-out and guest-to-Google transitions first try to flush edits. A failed
     flush leaves the user-scoped queue intact instead of erasing unsynced work.
   - Cloud boards no longer duplicate every full-board snapshot into IndexedDB;
     only unsynced mutation data is retained.
   - If write permission is removed, queued edits stay scoped to the original
     account but are hidden and no denied retry loop runs. They resume only if
     write access is restored.

2. **Resumable bounded persistence**
   - Reconnects and large paste/import operations are divided into batches of at
     most 400 mutations and approximately 6 MB, below the database RPC hard limit.
   - Each successful batch removes only the exact queued versions it committed.
     Newer edits made while a checkpoint is in flight remain pending.
   - Pasted elements now enter the same mutation queue as every other element;
     solo paste no longer exists only in a dead local buffer.

3. **One authenticated realtime socket per board**
   - Canvas events and manifest refreshes share one physical WebSocket.
   - Authentication, reconnect backoff, heartbeat, permission refresh, durable
     message queueing, backpressure, and React StrictMode remounts are centralized.
   - High-frequency ephemeral events are dropped while disconnected rather than
     building an unbounded queue.

4. **CSP-compatible graph evaluation**
   - `new Function` and `eval` are no longer used.
   - A bounded expression parser supports algebra, functions, variables,
     exponents, explicit equations, inequalities, and implicit relations.
   - Export rendering covers explicit, inequality, and implicit graphs as well as
     Cartesian, polar, and isometric grid modes.

5. **Bounded private-media cache**
   - Downloaded assets use self-contained data URLs in a 64 MB LRU-style cache.
   - Eviction never invalidates an image already rendered by React, in-flight
     requests are deduplicated, and account/board cache clearing is identity-scoped.

6. **More complete exports**
   - PNG/SVG/PDF rendering includes private images, PDF backgrounds, drawings,
     text, math, sticky notes, shapes, graphs, connectors, stamps, tables, and an
     audio-note placeholder.
   - Text underline and strike-through decorations are retained.
   - Missing private media is shown as an explicit placeholder instead of silently
     disappearing from the export.

7. **PDF-board safety**
   - Initial elements are saved through the mutation RPC in bounded batches and
     finalized with the dedicated initialization RPC.
   - PDF input is limited to 25 MB and 100 pages.
   - Rendered pages are capped at 1200 px on their longest edge and PDF.js/page
     resources are released as processing proceeds.
   - A board is not created when no pages are selected.

8. **Dashboard and operations**
   - Board lists use stable `(created_at, id)` keyset pagination rather than deep
     offsets or full board JSON downloads.
   - Stale dashboard responses cannot overwrite a newer page request.
   - Presence uses a low-frequency visible-tab heartbeat, and the admin presence
     stream exists only while its panel is open.
   - Board deletion retries transient failures and restores the dashboard card on
     failure instead of pretending deletion succeeded.
   - Voice recordings release streams/object URLs, stop after five minutes, and
     require a Storage-supported WebM/Ogg format.

9. **Repository/database reproducibility**
   - All ordered migrations use the production-compatible text board-ID model.
   - Follow-up fixes for share-token crypto, JSONB validation, and Storage uploads
     are part of the migration history.
   - The generated `supabase-schema.sql` wraps the complete fresh-install history
     in one outer transaction, so a later SQL failure cannot leave a half-hardened
     new project.
   - `npm run check:migrations` verifies ordering, generation, and the canonical
     hardening migration copy.

10. **Server and free-tier safeguards**
    - WebSocket identity and board permissions are verified server-side.
    - Event schemas, payload size, origin, connection count, rate, and buffered
      output are bounded without Redis or another paid service.
    - Optional free Turnstile support is wired into anonymous share redemption.
    - Active share links are capped per board.
    - Render proxy/IP handling uses the address added by the one trusted proxy,
      not a spoofable first `X-Forwarded-For` value.

## Deliberate limitations

- Storage objects and Postgres rows cannot be deleted in one cross-service atomic
  transaction using only a browser publishable key. Deletion therefore retries
  and reports a partial asset deletion if the final board-row deletion still
  fails.
- Audio exports contain a visible audio-note placeholder; a static image/PDF
  cannot embed an interactive audio player.
- Large exports are downscaled to bounded dimensions/pixel counts to prevent a
  browser memory crash.

## Verification completed here

- Migration generation, transaction wrapping, ordering, and canonical-copy checks
  passed for all five migrations.
- Global TypeScript semantic checking passed using local declaration stubs.
- Isolated TypeScript syntax transpilation passed for all project TS/TSX files.
- The math parser was executed directly for algebra, precedence, inequalities,
  implicit multiplication, and malicious-input rejection.
- Static scans confirm one browser WebSocket constructor, no `eval`/`new Function`,
  no direct board-shard mutation fallback, and no `fetch(dataUrl)` upload path.

A full dependency install, Vitest run, and Vite production build could not be
completed in this environment because its npm registry could not retrieve the
locked `zwitch` package. AI Studio/Render must run `npm run verify` with normal npm
registry access before deployment.

## Final reliability additions

The completion pass also closes the following cross-cutting edge cases:

- Realtime manifest refreshes are serialized and coalesced by revision. A slower
  response for an older revision cannot overwrite a newer collaborator state.
- Incoming realtime element previews are sanitized before entering the local
  persistence cache. Malformed or oversized relay data is ignored.
- Full element previews are validated by the server, including IDs, types,
  numeric fields, drawing points, asset references, text lengths, and tables.
- Timer messages now use a strict bounded schema instead of relaying arbitrary
  objects.
- Very long live strokes are evenly sampled to 900 preview points. The complete
  stroke is still retained for the final database checkpoint, while WebSocket
  traffic remains below relay limits.
- Failed checkpoints use bounded exponential retry. Once retries are exhausted,
  the recoverable IndexedDB queue remains scoped to its account without keeping
  an unused Render socket alive indefinitely.
- Anonymous users cannot sign out or switch to Google while guest-only edits are
  still unsynced. The current session stays active so those edits can finish.
- Board cache clearing now matches an exact project/user/board prefix, avoiding
  accidental eviction when board identifiers contain overlapping text.
- Fresh-project presence IDs now use the same text identifier model as the
  production compatibility layer, and its RLS comparisons consistently cast
  `auth.uid()` to text.
