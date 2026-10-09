# QA-1 production acceptance — 2026-10-09

QA-2 follow-up: [isolated regression coverage and CI](QA-2.md), with [separate machine-readable evidence](QA-2-evidence.json). The hosted results below remain the historical QA-1 snapshot; local QA-2 passes do not replace hosted checks.

**Verdict: INCOMPLETE.** Hosted checks: **42 PASS / 2 FAIL / 28 BLOCKED** across 72 explicitly defined scenarios. The two failed scenarios come from one deployed title/backup-metadata bug. Two confirmed bugs are fixed in this branch, including a separate local-sandbox restore issue. Fixes have not been deployed. Detailed scenario definitions, fingerprints, request evidence, and supplemental results are in [QA-1-evidence.json](QA-1-evidence.json). BLOCKED includes scenarios not executed; partial feature coverage is not full acceptance.

## Deployment evidence

- Live URL: <https://whiteboard-8y56.onrender.com/>. Root, main JS/CSS, and `/healthz` returned 200; a nonexistent API route returned the expected 404.
- Deployed main script: `/assets/index-DgL2W1SU.js`, SHA-256 `d86cec1da41d98a7179608679d5d0bbce9f844f86fc04450dab2e2581bc1d3a6`.
- Latest merged base: `65d7ca73125f71d6d939dfe8713747926a9460c9`. The complete main JS equals the Node 22 build of this base after normalizing generated relative JS chunk filenames. Deployed CSS exactly matches the final build's unchanged CSS (SHA-256 `65eb0610a3f9c6450216873409e8857502be1d4d3b7ed9618a618bdbe3b9c034`). This establishes frontend source equivalence, not an exact server/deployment commit.
- No Render management connection or server version marker was available. Exact server SHA/deployment status remains unconfirmed. No stale frontend behavior was diagnosed as a new-code regression.
- Hosted timer read/transition, board creation/state/checkpoints and copy/finalization workflows succeeded. Unsigned timer getter returned the expected 401/`42501` permission denial. Full RPC catalog inspection is blocked without a management/authenticated catalog connection.

## Hosted coverage

| Area | PASS | FAIL | BLOCKED | Evidence / remaining coverage |
|---|---:|---:|---:|---|
| Deployment | 6 | 1 | 2 | Public startup clean; title lost after reload; exact server/catalog unavailable |
| Timer | 11 | 0 | 5 | 30-second custom countdown, running/paused reload, resume/completion, close/reopen, 1m preset, mode switch, stopwatch reload, sound preference and Test Sound UI; audible/background/other presets/isolated viewer checks remain |
| Collaboration | 2 | 0 | 6 | Pencil and text persist; real teacher/guest pen-up timing, move/resize/delete/undo/redo synchronization and missed remote edits remain |
| Smart cursors | 0 | 0 | 2 | Multi-user content collision, accuracy, labels, click interception and follow need distinct identities |
| Answer covers | 4 | 0 | 1 | Hide/reveal/reload, same-account tab update, move/resize/zoom; reloaded geometry 301×146 at (500,220); viewer rejection/export masking remain |
| Duplication | 2 | 0 | 1 | All 3 source elements preserved with distinct IDs, exact geometry/layers/content, separate private copy with student editing disabled; hosted media copy remains |
| Backup/restore | 1 | 1 | 3 | Real v2 JSON download parses; saved title is wrong after reload; hosted upload/restore/malformed/legacy checks blocked |
| Safe clearing | 3 | 0 | 2 | Truthful warning, recovery download before confirmation, copy clears and source stays intact; hosted PDF-page preservation and restore remain |
| Navigation | 4 | 0 | 3 | Pin/unpin, search/recents, 115% zoom reload, Reset View to 100%; explicit pan, hosted bookmarks and account isolation remain |
| Mobile/tablet | 4 | 0 | 1 | Public layouts, phone toolbar/timer and tablet confirmation fit; touch drawing/reveal/PDF/dense content remain |
| Offline/recovery | 2 | 0 | 1 | Tab-scoped interruption accurately shows local/pending/sync state; text recovers through reconnect/reload without duplicate elements; concurrent conflicts remain |
| Performance | 3 | 0 | 1 | Navigation timings recorded, startup console/network clean, lightweight canvas exercised; quantified latency/cursor smoothness/leak analysis remains |
| **Total** | **42** | **2** | **28** | Hosted only |

No production load/stress test, service restart, database reset, hosted setting change, migration application, or real-material edit was performed.

## Confirmed bugs and fixes

1. **P2 — Direct-link reload loses the saved title, including archive metadata.** Create a disposable named board, open it, then reload its `?board=` URL. The header becomes “Collaborative Whiteboard”; Complete Backup writes that placeholder to `board.name`. The App intentionally starts direct links with a placeholder, and Canvas previously kept using the prop after its authorized manifest arrived. Canvas now derives the name from the matching board manifest and updates the parent's presence/title state. Header, backups, clears and exports share that name; another board's loaded name is excluded. Two component regression tests cover title hydration, backup metadata, rename updates and board switching. [Hosted reproduction screenshot](qa-1/title-bug.png).
2. **P3 — Local sandbox restore/copy can show duplicate cards for one ID.** A storage event loads the created board before the completed transfer callback prepends it again. The local browser reproduced two identical headings for one board. Completed restore/copy now removes an existing matching ID before insertion. The browser regression requires exactly one restored/copied heading and checks separate board/element IDs. This was reproduced locally; no hosted duplicate-card failure is claimed.

## Supplemental local evidence

**10 local browser scenarios passed**, separately from the hosted counts. A fresh headless Chromium context against localhost, with external traffic blocked, restored an eight-element fixture containing text, drawing, math, shape, a small PNG and two raster PDF page backgrounds. Images decoded, complete JSON downloaded, media/content copied with new IDs, bookmarks survived reordering, active-page clearing kept both backgrounds and the other page, recovery created a separate board, and malformed version 999 allocated nothing. These tests do not establish hosted Storage transport/RLS or original PDF import. [Synthetic board screenshot](qa-1/local-media.png).

Final validation on **Node 22.23.3**:

- Full Vitest suite: **37 files / 197 tests passed**.
- TypeScript and consistency of all eight migrations passed.
- Production frontend and bundled server build passed. Existing large-chunk/mixed-import warnings remain.
- Isolated real PostgreSQL: eight upgrade migrations and canonical fresh schema, **54 assertions passed**. This is local permission/lifecycle evidence, not production database testing.
- Focused pre-fix tests: 9 files / 49 tests passed; title regression: 2 passed. The full suite was repeated after the newly confirmed sandbox fix.

Run `npm test`, `npm run typecheck`, `npm run check:migrations`, `npm run build`, and optionally `npm run test:database`. Browser harnesses use an external Playwright 1.58.2 install through `QA_PLAYWRIGHT_MODULE`; `scripts/qa-1-public.cjs` is read-only. `scripts/qa-1-local.cjs` uses committed synthetic fixtures and a localhost server (`VITE_LOCAL_SANDBOX=true PORT=3199 npm run dev`). Its blocked external timer RPC is expected; no sandbox timer success is claimed. `scripts/qa-1-build.cjs` uses the fetched app bundle under `artifacts/qa-1` and reuses only public frontend configuration; it never reads a personal session or prints the key. Raw local logs/downloads remain in `artifacts/qa-1`, not Git.

## Browser, console and cleanup limits

- Initial public checks used Chromium 145.0.7632.6 in fresh headless contexts: desktop 1440×900, phone 390×844, tablet 768×1024. All had no startup errors, failed requests or horizontal overflow.
- After the user's explicit authorization, authenticated QA used newly created tabs in the verified **Al** Chrome profile. Existing personal tabs and the Windows desktop were not controlled. Same-account tabs do not establish separate teacher/guest acceptance.
- The extension refused file upload because file-URL access is disabled. Its settings were not changed. Guest invitation navigation was rejected by browser URL policy as invalid; no bypass was attempted. Consequently hosted media/PDF upload/restore and distinct guest/viewer scenarios remain blocked.
- Test Sound was clicked successfully, but actual audible output is **unverified**. Headless audio was muted.
- Expected fetch/presence/checkpoint errors occurred during the deliberate QA-tab offline interval and recovered afterward. Chrome extension `removeChild`/message-channel errors were also observed; these were not classified as app startup defects. The isolated public browser had no errors. No listeners/memory leak acceptance is claimed.
- Only two production QA boards were created: source `7027e8a5-b759-45c3-967c-8de8abd954fe` and copy `609e5718-251a-4b93-9831-28b110061ab2`. After the user's action-time deletion confirmation, both were removed. Cloud refresh plus reload showed no matching QA boards or recent shortcuts. Recovery files are retained locally. The source had no uploaded Storage assets. Sound preference and tab viewport/network overrides were restored.
- Registry audit reported eight production-dependency findings (one critical, two high, four moderate, one low). No exploit/reachability testing was performed; these are advisory findings, not reproduced runtime defects. No dependency churn was included in this behavior-fix PR.

## Next action

Review the single QA-1 PR. If approved, the owner should merge/deploy it through the normal release process, then finish the blocked **QA-1** checks on disposable boards: a real teacher plus guest/viewer, original small PDF/PNG upload, hosted media duplication, archive/restore/clear recovery, PDF bookmark deletion, actual sound, and foreground/missed-edit recovery. Verify Render's exact server commit. Keep the verdict INCOMPLETE until these checks are recorded; no separate follow-up phase is proposed.
