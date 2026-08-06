# Whiteboard Follow-up Audit

Audited from `whiteboard-supabase-image-fetch-fixed-full.zip` after secure sharing,
mutation RPC, authenticated WebSockets, and Storage uploads were working.

## Included in the safe cleanup patch

1. Share secrets now use `#share=...` instead of `?share=...`. The app still accepts
   old query-string links for compatibility, but new tokens are not sent to the
   Render HTTP server or normal access logs.
2. The Gemini API key is kept in `sessionStorage` only. The old permanent
   `lucid_spark_user_gemini_key` localStorage entry is removed automatically.
3. Administrator UI detection now calls the protected `is_admin()` RPC backed by
   `private.admin_users`; it no longer trusts `profiles.is_admin`.
4. The in-app Supabase settings modal no longer offers a dangerously permissive
   SQL schema with `using (true)` policies.
5. The compatibility database layer now rejects direct `board_shards` writes.
6. Trusted element IDs now override any `id` embedded in incoming element JSON.
7. The WebSocket server accepts the database's safe text board-ID format rather
   than requiring UUIDs only.
8. Production responses now include HSTS.

These changes do not require another Supabase SQL migration.

## Remaining issues not changed in this patch

### High priority

#### 1. Migration history is not reproducible

The running project uses legacy `text` board IDs and was upgraded with the
corrected text-ID migration. The repository still contains a UUID fresh schema
and an older UUID hardening script. A brand-new project created only from the
current migration folder would not reproduce the running database safely.

Do not rerun the root UUID hardening file against the current Supabase project.
Create a clean, consolidated text-ID baseline only after taking a database backup
and testing it on a separate free Supabase project.

#### 2. Offline caches are keyed only by board ID

`boardRecoveryCache.ts` and the pending-mutation cache in
`boardPersistence.ts` do not include the Supabase user ID/project ID. On a shared
browser, stale recovery data can be mixed between accounts. The recovery preview
also loads before current board authorization is confirmed.

This needs a coordinated cache-version migration and access-denied cleanup. It
was not included in the low-risk patch because a mistake could discard unsynced
work.

#### 3. Two WebSocket connections are opened per board

`WhiteboardCanvas.tsx` opens the collaboration socket and
`boardPersistence.ts` opens a second manifest socket. It works, but doubles
connections, authentication checks, heartbeats, and reconnect traffic on the
single free Render instance. Consolidate them later into one shared socket
service after adding collaboration regression tests.

### Medium priority

#### 4. Graph elements use `new Function`

`ShapeComponent.tsx` evaluates formulas with `new Function`. The production CSP
does not allow unsafe eval, so graph/implicit-equation features may fail in the
browser. Replacing this requires a tested expression parser; do not loosen CSP.

#### 5. Asset download cache is unbounded Base64

`storageService.ts` converts downloaded media to data URLs and keeps them in a
process-lifetime map. Large PDF/image boards can use substantially more browser
memory. Move to revocable object URLs with a byte-bounded LRU cache.

#### 6. Some export paths are incomplete

PNG/SVG export does not consistently include image/PDF/audio elements, and PDF
export can lose persisted page backgrounds when only `assetId` remains after a
reload. Test exports with every element type before relying on them for backups.

#### 7. RPC fallbacks can hide deployment mistakes

Board loading and dashboard listing fall back to direct table reads when secure
RPCs fail. This can mask a missing or outdated database function and return less
permission metadata. Prefer a clear migration/version error rather than silently
using a different access path.

#### 8. Pending-mutation restore has an initialization race

`restorePending(control)` starts asynchronously while the first cloud load starts.
If IndexedDB is slow, restored edits may arrive after the initial rebuild and
flush scheduling. The control should await one pending-restore promise before
hydrating and deciding whether to flush.

### Lower priority / operational

1. Render uses `npm install` rather than deterministic `npm ci`.
2. `package.json` has no pinned Node engine.
3. The optional Turnstile environment variable exists, but the anonymous-sign-in
   UI does not currently implement Turnstile.
4. Every press of Copy Link creates a new active share-link row; add owner cleanup
   or an active-link cap if the table starts growing.
5. Deleting Storage assets before deleting the board can leave a partially
   deleted board if the database deletion fails afterward.
6. The global app kill switch and presence compatibility listeners are not truly
   cross-client realtime; other clients may need a reload.

## Validation performed

- Static inspection of the complete current project.
- Syntax transpilation of 54 TypeScript/TSX source and configuration files: no
  syntax errors in the patched project.
- A full dependency install, test suite, and Vite production build could not be
  completed in this environment because the available package registry could not
  resolve the locked `zwitch` dependency. Gemini/Render should run the normal
  project build before deployment.
