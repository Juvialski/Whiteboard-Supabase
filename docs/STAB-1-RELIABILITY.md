# STAB-1 reliability and deployment

Base: `70ad9648cf4a47069c7a1527e163cb12c539c880`. Implementation is isolated
from the original checkout's uncommitted load-test work.

## Root causes and implementation

- Timer state lived in component memory and transient socket messages. Mode
  selection was not broadcast, and editing could leave local running state
  inconsistent with broadcast state. A dedicated per-board table and atomic
  transition RPC now own start/pause/reset, duration/presets, mode, adjustments,
  and visibility. Server timestamps and millisecond baselines restore countdowns
  and stopwatches after reload, sleep, tab closure, reconnect, and relay restarts.
- Countdown completion is derived from the persisted deadline and remains
  visible at zero after reload. Pausing or changing visibility after the deadline
  materializes completion in the row. Start/adjust cannot revive a completed
  countdown; reset, selecting a new duration/preset, or mode selection explicitly
  create a new run. Rendering/completion checks never write on ticks.
- Revisions are checked under a row lock. Failed/ambiguous transitions fetch
  current state and display an error; they are never automatically replayed.
  Readers fetch state on joining. Notifications, socket reauthentication, network
  recovery, token recovery, and foreground resume fetch current state. Requests
  coalesce; no polling or extra realtime subscription architecture was added.
- Audio previously created/resumed a context at completion without awaiting
  browser permission. Real clicks now unlock it with awaited resume and caught
  rejection. Test Sound and local sound preference are available to readers too.
  Completion is claimed once per project/user/board/run in memory/sessionStorage.
  Suspended/blocked sound gets a visual alert, including closed/minimized panels.
  Muting closes the context; node endings disconnect and unmount closes resources.
- Socket reconnection did not inspect missed board revisions. Recovery checks
  the board manifest, refreshes affected shards or a full authoritative snapshot
  for a gap, and overlays pending local mutations. Stale revisions and duplicate
  operations are ignored. Delayed snapshots/save responses cannot roll back the
  revision. Concurrent checkpoint gaps also trigger authoritative recovery.
  Safe revision notifications can queue while disconnected; transient updates
  and legacy timer state cannot replay. Listener cleanup uses the existing
  shared socket service.
- IndexedDB writes/deletes previously converted rejection to success. The
  indicator now distinguishes pending local write, durable local queue, cloud
  saved, cloud pending, and failed local save. Queue keys bind to the creating
  account/project/board. Writes serialize; failed writes preserve in-memory edits,
  warn before closing an undurable queue, and still permit cloud saving. Exhausted
  cloud retries preserve queues and resume on network/auth/socket recovery.
  Sign-out drains/checks pending queues; unreadable recovery data blocks the exit
  rather than being interpreted as empty. Authorization load failure no longer
  deletes recoverable edits. Legacy cache migration keeps its source on failed
  IndexedDB writes. No full-board cache is replayed over collaborator state.
- Voice notes previously displayed Pause immediately after calling play(), even
  on rejection. Playback events/promise success now determine state, with retry
  UI for load/play failures and resource cleanup. Asset identity changes clear
  previous board media and ignore stale responses; image/PDF page persistence,
  retry, and board context have targeted regression coverage.
- Live cursors previously used large opaque pointers and clickable name pills
  over content. A 10px semi-transparent outlined marker now tracks exact screen
  coordinates. Small, noninteractive badges search nearby unoccupied space,
  considering all board element bounds, active drawings, full image/PDF pages,
  other markers/badges, and desktop/mobile viewport edges. Badges disappear when
  no safe space exists. A memoized screen-space grid bounds collision work;
  stable safe orientations reduce label jitter. Follow remains in the existing
  People menu. This feature adds no database objects or permanent controls.

## Database and security evidence

Read-only production catalog inspection on 2026-10-09 (Asia/Manila) confirmed
project `sovmyybkknogvjrldduf` is active, all seven existing migration versions
match the repository, and all eight public tables have RLS enabled. Comparing
the live function definitions to an isolated database built from those migrations
found **24/24 exact SECURITY DEFINER function matches**, including the auth trigger.
No user board contents/assets were queried for the audit. The request's board/
element/asset counts remain an earlier snapshot, not acceptance fixtures.

The live advisor reports 23 authenticated SECURITY DEFINER RPC findings, eight
anonymous-policy findings, and disabled leaked-password protection. Existing
RPCs have empty search paths, explicit authenticated grants, and board/member/
admin checks. Required access was retained; suppressing these warnings by
revoking functional RPC access would break the app. Guests use authenticated
anonymous identities with explicit memberships; unsigned anon has no timer RPC
access. Anonymous board creation remains forbidden. Share tokens remain hashed,
manager-created, expiring/revocable, and membership redemption is checked.
Private administrator records remain authoritative; user metadata grants no
admin permission. Leaked-password protection is a hosted Auth setting and is
deferred to the project owner; this PR changes no hosted configuration.

Migration 8 adds the timer table with RLS and SELECT-only authenticated access,
two narrowly granted RPCs with empty search paths and existing permission checks,
and an author FK index. It also adds the **two verified missing FK indexes**:
`board_members(created_by)` (ON DELETE SET NULL) and
`board_share_links(created_by)` (ON DELETE CASCADE), to bound auth-account deletion
scans/locks. Existing indexes and RPC grants remain. No frontend service-role or
secret key was introduced. Only two scalar timer RPCs are needed; Free-compatible
indexes/row locking and the existing relay avoid tick writes and Realtime polling.

## Validation

Use Node 22, `npm ci`, then:

```sh
npm run typecheck
npm run check:migrations
npm test -- --maxWorkers=2
npm run test:database
npm run build
```

Database validation uses pinned embedded Postgres 17.10 and synthetic Supabase
auth/storage schema shims in a temporary loopback-only cluster. It executes all
eight actual upgrade migrations, compares generated fresh-schema functions,
checks existing data/asset preservation, and tests permissions/RLS/grants,
concurrent timer edits, server-time pause/sleep, completion persistence, guest
membership, share revocation, and concurrent two-client board saves. It is real
Postgres validation, not a hosted Supabase/Auth/Storage integration test.

Verified on Node 22.22.0: typecheck, migration/schema check, and production build
passed; the full unit suite passed **145 tests across 29 files**. The expanded
database script passed **47 assertions** plus the live catalog comparison.
Final targeted reliability rerun: **43 tests across eight files passed**.
Smart cursor geometry/component plus existing presenter checks: **19 tests across
three files passed**. Typecheck and production build also passed with the cursor
feature included. The final connector-control bound adjustment was checked with
the cursor geometry tests again. These are deterministic unit checks; no real
desktop/mobile browser acceptance is claimed.
Existing Vite chunk-size/mixed-import warnings and jsdom media-method diagnostics
are non-fatal. No desktop/browser automation or production user-board tests ran.

## Exact production deployment order (human operated)

1. Review/approve the PR and verify the intended commit. Before starting, obtain
   a current recoverable database backup and confirm Storage assets remain
   intact; never use the generated fresh-project schema on this existing project.
2. Confirm project `sovmyybkknogvjrldduf` and migration history through
   `202608080001`. Review/apply **only**
   `supabase/migrations/20261008230648_stab_1_timer_reliability.sql` once via
   the normal Supabase migration workflow. It is transaction-wrapped and performs
   no board/asset deletions or replacements. Its small index builds take normal
   table locks, so use a quiet period.
3. Verify migration history, table RLS, authenticated SELECT-only grants,
   anon/PUBLIC RPC EXECUTE revocation, and authenticated RPC grants. Inspect the
   actual Data API exposure settings so the two public RPCs are accessible.
   Existing production boards need no timer backfill; their first read returns
   an unpersisted revision-0 default and the first permitted transition creates
   their row. Do not use real boards as acceptance fixtures.
4. Deploy the reviewed server/relay build, then the reviewed frontend build.
   If Render deploys both in one artifact, migration-first followed by that
   artifact satisfies the order. New timer revision events require the new
   relay's sanitizer/database verification. Keep the existing Supabase URL and
   publishable/anon configuration; no service-role credentials are needed.
5. Refresh all participating browser tabs to the new frontend. Old cached
   frontends remain compatible with boards/assets and their legacy timer relay
   messages still work for old peers, but their timer controls are transient and
   cannot become authoritative persisted controls. New clients ignore those
   legacy states. Do not mix timer controllers during acceptance.
6. On a deliberately created disposable test board, have an authorized writer
   and a viewer verify timer start/pause/resume, presets/edit/mode/adjust/visibility,
   reload and foreground recovery, Test Sound, and denied viewer writes. Verify
   ordinary drawing/cursor/presenter/live-text and persisted image/PDF/audio flows.
   Check pending/local/cloud indicators during a brief network interruption.
7. Observe relay/save errors and confirm no missing-migration or permission
   failures. This PR performs none of these production deployment steps itself.

## Rollback and browser limits

Roll back frontend and relay together to the previous reviewed artifact, **leave
migration 8/table/indexes in place**, and retain timer rows. The old frontend
ignores the additive table and resumes its previous transient timer behavior.
Do not drop data/functions or reverse existing migrations. Re-deploying the new
frontend/relay resumes persisted timers with elapsed server time; reset if a
new run is desired. A failed migration transaction rolls back atomically before
frontend rollout.

Autoplay policy can require an explicit gesture on every tab after reload.
Suspended contexts, muted tabs/OS output, and devices with no sound output cannot
be guaranteed audible; tab/OS mute is not reliably observable through Web Audio.
The visual completion alert is always available. A closed tab cannot sound an
alarm; restoration occurs when reopened. Frozen/background tabs may not paint
or play until resumed, then recompute from the server baseline and deduplicate.
Abrupt browser/process termination before an IndexedDB write finishes cannot be
made durable by JavaScript; pending/failed indicators and unload protection make
that limitation explicit. Clock offset is estimated with a request midpoint;
network latency can briefly skew display, but transition time and revision
authority remain in Postgres.
