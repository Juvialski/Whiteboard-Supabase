# QA-2 — isolated regression tests and CI

Date: 2026-10-09 (Asia/Manila). Base: `cf810e60567a78cc4a6586addda854ada88d6138`, latest main after merged PR #3.

**Local regression coverage expanded; hosted acceptance remains incomplete.** The 28 QA-1 blocked scenarios are individually mapped in [QA-2-evidence.json](QA-2-evidence.json). Local equivalents cover 22 scenarios; six remain blocked or only partially covered. None of the 28 hosted scenarios was retested. QA-1's historical hosted 42 PASS / 2 FAIL / 28 BLOCKED counts remain historical, rather than being relabeled by synthetic results.

## Isolation and evidence boundaries

Tests use Codex command-runner processes in a separate clean worktree, Node 22, Vitest/jsdom, synthetic files, an in-memory media backend, and a temporary loopback-only embedded PostgreSQL cluster. No verified remote isolated browser runtime was exposed, so this phase uses the authorized Vitest/local integration fallback. No Chrome, browser profile, extension, desktop automation, personal tab, stored login or production board/database was accessed. No production configuration or secrets are needed by CI. No migration was applied outside the disposable cluster. Local PostgreSQL implements the real migrations and RLS/RPC authorization; it is not a full Supabase service deployment.

`scripts/qa-2-integration.mjs` starts the actual `server.ts` relay with an allowlisted environment and an empty temporary working directory, preventing dotenv from reading developer configuration. Its local Auth/PostgREST facade accepts only fresh test-issued opaque tokens. Each token maps to an independent database connection with the `authenticated` role and synthetic `auth.uid()`. Authorization, membership, timer revisions and mutation conflict resolution execute the production SQL functions; the facade does not grant write access. Production OAuth/JWT issuance and hosted Storage transport remain unverified. Vitest's default fetch fails closed; tests explicitly mock their transport.

## Added regression coverage

- Real teacher/editor/viewer WebSocket sessions: token rejection, outsider rejection, drawing stream, completed stroke before checkpoint, pen-up, authoritative manifest metadata, concurrent different-element edits, missed-edit snapshot reload, move/resize/delete and restore/undo/redo payload sequences, cover reveal, timer revision verification, cursor precision and authorized follow/unfollow.
- Database enforcement: viewer mutation/timer rejection, stale offline edit rejection, deletion tombstone protection and an explicit newer edit. The pre-existing 54-assertion migration/fresh-schema/permission suite also runs.
- Production React components and hooks: suspended timer callbacks followed by foreground recovery, timer/stopwatch elapsed calculations, four presets, multiple cursor labels and pointer-event styles, bookmark ID stability through reorder/deletion and account switch, viewport isolation, and PDF deletion/reflow including attached annotations and actual undo/redo keyboard controls.
- Production transfer/recovery services: committed PNG and original one-page PDF bytes through a local in-memory asset backend, new board/element/asset identities, source preservation, page-specific clearing and complete archive recovery to a separate board; committed malformed archive rejection before allocation. Existing legacy archive, quota cleanup and cover export tests remain part of the full suite. The fixture PDF is copied as original media; original PDF browser rasterization/upload is not established by this test.

These tests exercise real application functions with explicit local transport boundaries. DOM pointer-event styles and input bubbling do not establish real browser hit testing, screenshots or touch acceptance. No actual audible output is verified, and no hardware sleep or production performance result is claimed.

## Confirmed bug fixed

**Authorized realtime deletions were silently dropped.** `element_update` with `actionType: 'delete'` carries no `elementData`, exactly as the canvas sends it. The relay called `payloadSize(undefined)`, whose serialization failure returns `Number.MAX_SAFE_INTEGER`, and rejected the event as oversized. The integration sequence timed out waiting for the remote deletion before checkpoint. Payload size, forbidden-key and element shape checks now apply to set events; delete still requires write authorization, a valid element ID and the allowed action. The nine-scenario suite passes after this narrow change and confirms viewer deletions remain denied. No UI, schema, production architecture or dependency version changed.

## Validation and CI

The existing baseline passed: 37 Vitest files / 197 tests on Node 22.23.3. Focused regression tests were run during development. One complete final validation passed after the changes: clean `npm ci`, all eight migration consistency checks, typecheck, 37 Vitest files / **209 tests**, **54 PostgreSQL assertions**, **nine relay/database scenarios**, and the frontend/bundled-server production build. Existing large-chunk/mixed-import warnings and jsdom media notices remain. Final validation is also recorded in the evidence JSON. CI was not yet run when this evidence was committed; the PR checks provide its subsequent result for the pushed head.

Reproduce from a clean checkout on Node 22:

```sh
npm ci
npm run verify
```

`verify` runs migration consistency, typecheck, Vitest, isolated database/relay integration, and the production build in order. `npm run test:integration` independently runs the 54 database assertions and nine relay/database scenarios. `node scripts/qa-2-fixtures/generate.mjs` regenerates the committed synthetic PNG/PDF fixtures. No browser or provider credentials are required.

The single `.github/workflows/qa.yml` runs the same checks on Node 22 for pull requests and main pushes, with read-only repository permissions, cancellation of superseded runs and a 15-minute limit. It contains no deployment step, production secret, database URL or migration-application command. CI results are reported separately from local validation.

Remaining gates: hosted server SHA/catalog, audible sound, browser cursor collision/hit testing, touch/device behavior and quantified latency/smoothness/leak acceptance. All 28 hosted blocked scenarios retain their hosted gate even where a local equivalent passes. Registry audit notices and existing build warnings are not treated as newly reproduced application bugs; no dependency churn is included.
