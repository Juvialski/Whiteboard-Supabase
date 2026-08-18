# High-Concurrency Supabase Free-Tier Optimization Plan

## Executive Summary & Objectives

The goal of this plan is to maximize the number of concurrent users on the collaborative whiteboard application while strictly adhering to the **Supabase Free Tier** resource constraints.

### Supabase Free Tier Limits Reference:
* **Realtime WebSocket Connections**: Max **200 concurrent connections**.
* **Database Compute**: Shared CPU, **500 MB RAM**, and a project-specific connection pool. Do not treat an undocumented PostgREST pool size as a fixed application limit.
* **Database Storage**: **500 MB** total PostgreSQL disk.
* **Storage/Egress**: **5 GB uncached egress + 5 GB cached egress** per month. This is unified across Supabase services, not a 2 GB Storage-only quota.
* **Storage File Size**: **1 GB** total bucket storage, 50 MB max file upload.
* **Auth API Rate Limits**: Endpoint-specific token-bucket limits; the burst capacity is commonly 30, but there is no single 30 requests/second limit for all Auth traffic.

Use the current [Supabase pricing](https://supabase.com/pricing), [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress), and [Auth rate-limit](https://supabase.com/docs/guides/auth/rate-limits) pages when sizing the deployment.

## Review Status and Required Revisions

This plan is **partially viable, but should not be implemented verbatim**. The repository baseline currently passes `npm run check:migrations`, `npm run typecheck`, all 110 Vitest tests, and `npm run build`. The following changes are required before implementation:

1. **Realtime scope must be stated precisely.** Removing the `src/App.tsx` channel removes one Supabase Realtime connection per authenticated browser. `Dashboard.tsx` already creates and cleans up its admin channel only while the admin modal is open, so that file does not need the proposed lifecycle change. The result is zero Supabase Realtime connections for normal users, not an unconditional zero. The app's collaboration WebSocket at `/ws` remains active and must not be confused with Supabase Realtime.

2. **The IndexedDB plan is missing its hydration path.** `boardPersistence.ts` already calls `get_board_state`, but it currently consumes only `board` and `shards`. Add an `assets` metadata array to the RPC and explicitly pass it from `boardPersistence.ts` into `storageService.ts` before `useBoardAsset` attempts a load. Otherwise `getBoardAsset(boardId, assetId)` still has to issue the per-asset metadata query before it can discover `content_hash` or `object_path`. The file modification table must include `src/services/boardPersistence.ts`.

3. **Persistent media caching needs identity and invalidation rules.** Keys must include the Supabase project, authenticated user ID, board ID, asset ID, and content hash. Add a bounded byte budget, TTL/versioning, quota-error handling, and cleanup on sign-out, account switch, board deletion, and access revocation. A cache hit is not proof of current authorization; it is safe only after the board access check has succeeded. The existing `idb-keyval` dependency is already present, so no dependency installation is needed. The expected egress reduction must be measured, not promised as 80–90%; browser-local caching does not reduce egress for other users or other browsers.

4. **Do not hand-roll Supabase JWT validation with only `SUPABASE_JWT_SECRET`.** Supabase now supports asymmetric signing keys, and its documentation recommends `getClaims()`/JWKS or a high-quality JWT library; it strongly discourages relying on the legacy shared secret. If local validation is introduced, use a feature-flagged JWKS implementation that validates `iss`, `aud`, `sub`, `exp`, algorithm, and key rotation. Keep the existing Auth-server path for HS256 projects. A five-minute token cache also weakens revocation, and the subsequent `get_board_access` RPC remains a remote authorization check, so “sub-millisecond handshakes” is not a valid acceptance criterion.

5. **In-memory relay state may optimize, but must not become authoritative.** Revision tracking must fall back to the database after a relay restart, on revision gaps, and whenever more than one relay instance exists. Permission refresh should keep the current bounded TTL and use explicit change events as a fast path; event-only invalidation can leave revoked users connected if an event is missed. Render's current `render.yaml` uses a Free web service, not a dedicated or horizontally scalable server. Free services can restart, spin down after inactivity, and cannot scale beyond one instance, so the plan must include reconnect/rehydration behavior and capacity tests on the actual instance.

6. **Do not raise the IP limit to 100 without an abuse-control design.** Keep a small pre-auth connection/handshake limit, rate-limit authentication attempts, and make room/IP limits configurable through validated environment variables. A classroom behind NAT needs a higher authenticated room allowance, but an unrestricted unauthenticated IP allowance is a denial-of-service risk. Test 20, 40, and 60 clients with realistic cursor, drawing, and text traffic before choosing the default.

7. **The cleanup proposal is incomplete.** `presence.id` is a primary key and the application upserts one row per user, so presence does not continuously accumulate one row per heartbeat. Clean up expired `board_members` and `board_share_links`, and separately address anonymous `auth.users` because this application creates anonymous sessions. A database RPC cannot by itself remove orphaned objects from Supabase Storage; storage cleanup needs an authorized Storage API job or an explicit admin workflow. The cleanup function must be admin/service-only, use `SECURITY DEFINER` with `SET search_path = ''`, revoke `PUBLIC`/`anon` execution, use an advisory lock, and have a defined scheduler or caller. An unused RPC is not automatic cleanup.

8. **The SQL optimization description must match this schema.** `effective_board_permission` currently reads `boards`, `board_members`, and `private.admin_users`; it does not read `profiles`. Rewrite the access calculation only after preserving text board IDs, anonymous-user behavior, RLS bypass boundaries, error semantics, grants, and the `search_path = ''` hardening. Replace the unsupported “<5 ms” claim with `EXPLAIN (ANALYZE, BUFFERS)` results from representative data. Adding a migration also requires updating `scripts/verify-migrations.mjs`, regenerating `supabase-schema.sql`, and testing the exact RPC JSON contract.

---

## Architecture Overview

```
+---------------------------------------------------------------------------------------+
|                                    Client Browsers                                    |
|                                                                                       |
|   +---------------------------+   +-----------------------+   +-------------------+   |
|   |   IndexedDB Media Cache   |   |   Local 16-Shard      |   |   App WebSocket    |   |
|   | (Zero-Egress Repeat Loads)|   |   Pending Queue       |   |   Client          |   |
|   +---------------------------+   +-----------------------+   +-------------------+   |
+-----------------------------------------------|-------------------------|-------------+
                                                | HTTP / REST             | WebSocket (/ws)
                                                |                         |
                                                v                         v
+---------------------------------------------------+   +-------------------------------+
|               Supabase Cloud Platform             |   |    Render Web Service (server.ts) |
|                                                   |   |         (server.ts)           |
|  * PostgREST / RPCs:                              |   |                               |
|    - Single-Pass get_board_access                 |   |  * Node.js ws Relay:          |
|    - Batch get_board_state (incl. asset metadata) |   |    - Cursors & Laser Pointers |
|    - apply_board_mutations (Atomic checkpoint)    |   |    - Live Drawing Streams     |
|  * Storage (Private Bucket):                      |   |    - Ephemeral Edit Previews  |
|    - Uploads with Content Deduplication           |   |    - Manifest Notifications   |
|  * Supabase Realtime: normal users disabled       |   |  * Local/JWKS JWT Verify      |
|  * Auth (GoTrue): Token Issuance & Refresh        |   |  * IP / Room Concurrency Tuned|
+---------------------------------------------------+   +-------------------------------+
```

---

## Detailed Optimization Breakdown

### 1. Removing Unused Supabase Realtime Connections
* **Problem**: In `src/App.tsx`, every authenticated user subscribes to `supabase.channel('app-settings-' + authUserId)` on the `admin_settings` table. This opens a direct WebSocket connection to `wss://<project>.supabase.co/realtime/v1/websocket`. On the Free Tier, Supabase drops or denies connections after 200 concurrent users. Furthermore, `admin_settings` is not in a Postgres publication, making this connection completely idle.
* **Solution**:
  * Remove `supabase.channel` from `src/App.tsx`.
  * Rely on the existing 60-second fallback poll and window focus listener for global app status.
  * In `src/components/Dashboard.tsx`, ensure the Admin Panel channel is strictly active only while the Admin Modal is open, with immediate cleanup on close.
* **Impact**: Normal-user Supabase Realtime connections drop from the current per-user channel count to **0**; an admin may still consume one channel while the admin modal is open. This removes the unused Realtime connection pressure from normal users, but does not eliminate capacity limits in the Render relay or Supabase HTTP APIs. All multiplayer collaboration continues to run via the app WebSocket server (`server.ts`).

---

### 2. Storage Egress Reduction (5 GB Cached + 5 GB Uncached Monthly Quota)
* **Problem**: In `src/services/storageService.ts`, media assets (images, PDF pages, audio clips) are cached only in memory (`assetCacheMap = new Map()`). Every page reload or board switch re-downloads all media from Supabase Storage. Viewing a 10 MB PDF board across 20 users consumes roughly 200 MB of transfer per session; the actual impact depends on CDN cache status and the unified egress counters.
* **Solution**:
  * **Persistent 2-Tier Cache**: Use the already-installed `idb-keyval` package to add an IndexedDB persistent store (`whiteboard-asset-cache`) underneath the memory LRU cache.
  * When `getBoardAsset(boardId, assetId)` is called:
    1. Check memory cache (fastest).
    2. Check IndexedDB store by `contentHash`/`assetId`. If present, hydrate memory and return data URL (**0 bytes downloaded from Supabase Storage**).
    3. On cache miss only, fetch from Supabase Storage, then write to both Memory and IndexedDB.
  * **Batch Metadata Hydration**: Update `get_board_state` RPC to return the board's asset metadata list upfront so the client avoids executing individual `SELECT * FROM board_assets WHERE asset_id = ...` queries for every element.
  * **Optional image compression**: Measure the current JPEG/PNG path first. If WebP is adopted, preserve alpha-channel behavior, update MIME metadata/content hashes, and add browser compatibility tests. Do not promise a fixed 35–50% reduction.
* **Impact**: Lower repeat-load transfer for the same browser profile. Quantify the reduction with cached versus uncached egress measurements instead of promising 80–90%.

---

### 3. Relay Server Auth & PostgREST Query Offloading
* **Problem**:
  1. In `server.ts`, every WebSocket connection calls `verifier.auth.getUser(token)` over HTTPS to Supabase GoTrue Auth. Under high concurrency, this adds network latency per connection and contributes to endpoint-specific Auth rate limits; it should not be described as a universal 30 req/sec limit.
  2. Every time a writer broadcasts `board_manifest_changed`, `server.ts` executes `loadAuthoritativeManifest` (a separate `SELECT` on `boards`).
  3. `server.ts` runs periodic authorization checks against Supabase for all connected clients.
* **Solution**:
  * **Conditional local JWT verification**: Prefer Supabase `getClaims()`/JWKS or a maintained JWT library for asymmetric signing keys. Keep the Auth-server verification path for HS256 projects; never expose or bundle the legacy JWT secret. Cache only until the token's `exp`, with an explicit key-rotation/revocation strategy.
  * **In-Memory Revision Tracking**: Track revisions as a best-effort optimization. Fall back to the authoritative `boards` row after restart, on gaps, and whenever relay state is not shared.
  * **Event-Driven Permissions with a TTL safety net**: Refresh immediately on explicit events, but retain bounded authorization checks so missed events cannot leave revoked writers authorized indefinitely.
* **Impact**: Fewer Auth calls when asymmetric local verification is available and fewer manifest reads when the revision cache is valid. Measure p50/p95 handshake and authorization latency; do not use a sub-millisecond target while the `get_board_access` RPC remains on the handshake path.

---

### 4. Database Query & Schema Optimization (SQL Migration)
* **Problem**:
  1. `get_board_access` calls `effective_board_permission`, queries `boards` again, and calls `can_write_board`, which calls the permission function again. In this schema, admin membership is in `private.admin_users`; `profiles` is not part of the authorization calculation.
  2. Expired `board_share_links` and `board_members` can remain indefinitely. `presence` is one upserted row per user because `presence.id` is a primary key; it is not one row per heartbeat.
* **Solution**:
  * Create migration `supabase/migrations/202608080001_free_tier_concurrency_optimizations.sql`:
    * Rewrite `get_board_access(p_board_id text)` into a single-pass authorization calculation over `boards`, `board_members`, and `private.admin_users`, preserving the current security-definer hardening.
    * Update `get_board_state(p_board_id text)` to include `assets jsonb` in the returned JSON object.
    * Add an admin/service-only cleanup path for expired memberships and share links. Define how it is scheduled, and handle anonymous `auth.users` and orphaned Storage objects through the appropriate privileged maintenance path.
* **Impact**: Fewer repeated authorization queries and bounded relational metadata. Validate the improvement with representative `EXPLAIN (ANALYZE, BUFFERS)` results rather than a fixed <5 ms claim.

---

### 5. Presence Write Throttling
* **Problem**: In `src/App.tsx`, every open tab executes an `upsert` on `public.presence` every 90 seconds, plus on visibility changes and board switches. 500 concurrent users generate ~333 DB writes/minute continuously.
* **Solution**:
  * Throttle database presence heartbeats to 300 seconds (5 minutes), but do not stop student writes until the admin dashboard has a replacement source for global student presence.
  * Keep immediate writes for sign-in, board changes, visibility changes, and sign-out where they are required for the current dashboard semantics.
  * Live collaborator presence within boards is already streamed over WebSockets (`server.ts`) in memory.
* **Impact**: A theoretical reduction from 90-second to 300-second heartbeats, subject to visibility/board-change writes and validation against the admin panel's expected behavior.

---

### 6. Relay Server Limits & Classroom/NAT Support
* **Problem**:
  * `MAX_ROOM_CLIENTS = 20` hard-limits board capacity.
  * `MAX_CONNECTIONS_PER_IP = 12` blocks classrooms and schools sharing a single public IP.
* **Solution**:
  * In `server.ts`, make `MAX_ROOM_CLIENTS` configurable and validate a staged default such as 40 before moving to 60.
  * Make the classroom/NAT allowance configurable, but retain separate pre-auth and authenticated limits, handshake rate limiting, and backpressure protection. Do not make 100 unauthenticated connections per IP the unconditional default.
  * Document that the current Render Free service is single-instance and can restart; room state is ephemeral and clients must reconnect and rehydrate.

---

## File Modification Plan

| File | Primary Changes |
| :--- | :--- |
| `src/App.tsx` | Remove Supabase Realtime channel; throttle database presence writes to 5 min. |
| `src/components/Dashboard.tsx` | Verify and preserve the existing admin-modal-only realtime channel lifecycle; no lifecycle change is currently required. |
| `src/services/storageService.ts` | Add 2-tier cache (Memory + IndexedDB); add batch asset metadata hydration. |
| `src/hooks/useBoardAsset.ts` | Integrate with persistent IndexedDB asset cache. |
| `src/services/boardPersistence.ts` | Pass `get_board_state.assets` into the storage metadata cache before rendering assets. |
| `server.ts` | Add local JWT verification/caching; optimize manifest checks; increase room/IP limits. |
| `supabase/migrations/202608080001_free_tier_concurrency_optimizations.sql` | Consolidated single-pass `get_board_access`; batch assets in `get_board_state`; add cleanup RPC. |
| `scripts/verify-migrations.mjs` | Add the new migration to the ordered expected list and keep schema-generation checks exact. |
| `supabase-schema.sql` | Sync with new migration via `npm run schema:generate`. |
| `package.json` / `package-lock.json` | Update only if a maintained JWT/JWKS library is selected; `idb-keyval` is already installed. |

---

## Verification & Testing Plan

### 1. Automated Verification
* `npm run schema:generate`: Verify consolidated schema matches migrations.
* `npm run check:migrations`: Verify migration integrity and formatting.
* `npm run typecheck`: Verify strict TypeScript typing across all modified files.
* `npm test`: Run complete Vitest suite (frontend components, persistence, security, crypto, math).
* `npm run build`: Verify production bundle compilation (Vite + esbuild).

### 2. Concurrency & Performance Benchmarks
* **Realtime Connection Audit**: Verify that normal users create 0 WebSocket connections to `wss://*.supabase.co/realtime/v1/websocket`; verify that the app relay `wss://<render-host>/ws` still connects. Test the documented admin-modal exception separately.
* **Storage Egress Benchmark**: Open a media-heavy board, reload 5 times, and confirm in DevTools Network tab that subsequent loads hit IndexedDB with 0 network calls to Supabase Storage.
* **Relay Authentication Throughput**: Test 20/40/60 clients against the deployed Render region with p50/p95 handshake latency, authorization latency, CPU, memory, broadcast delay, reconnect time, and 429/close rates. Include token expiry, permission revocation, relay restart, and multiple-client-per-NAT tests.
* **Cache and authorization safety**: Test account switching, sign-out, board deletion, revoked membership, stale metadata, IndexedDB quota errors, JWT expiry, signing-key rotation, and cross-account cache isolation.
