# Final deployment and regression checklist

## Deploy

1. Upload the changed-files ZIP into AI Studio Build Mode so it replaces matching paths.
2. Do not ask AI Studio to rewrite the supplied files.
3. Run:
   ```text
   npm ci --include=dev
   npm run verify
   ```
4. Deploy to Render and wait for `/healthz` to return HTTP 200.
5. Hard-refresh existing browser tabs after deployment.

No new Supabase SQL is required for this source-code follow-up on the already-upgraded project.

## Required smoke test

Use one normal teacher window and one fresh incognito student window.

1. Create a normal board; draw, paste multiple elements, and add text, shape, sticky note, table, graph, and image.
2. Wait for `Cloud: Synced`, reload, and confirm every element returns.
3. Generate a secure edit link and join it in incognito.
4. Confirm both browsers see the same initial content, collaborator presence, cursors, and live strokes.
5. Make edits from both browsers, wait for sync, reload both, and confirm persistence.
6. Briefly go offline, create many edits/pastes, reconnect, wait for all batches to sync, then reload.
7. Generate a view-only link and confirm drawing/upload controls cannot persist changes.
8. Revoke the link/member and confirm a fresh unauthorized session cannot open the board.
9. Import a small PDF, deselect/reselect pages, create the PDF board, annotate, reload, and export annotated PDF.
10. Export a mixed board to PNG and SVG; verify images, text decoration, graphs, tables, and the audio placeholder.
11. Record a short voice note, play it, save it, reload, and play it again.
12. Sign out with no pending edits; sign in to a different account and confirm no previous private cache preview appears.
13. Repeat sign-out while an offline edit is pending; sign back into the original account and confirm the edit is recoverable.
14. Delete a test board and confirm it disappears with its assets.
15. Check UptimeRobot against `/healthz`.

## Failure rule

Do not apply old schema SQL to fix a frontend/build error. Capture the exact toast,
Render log, and browser-console message first. The root schema is for a brand-new
Supabase project only.

## Additional collaboration stress checks

16. Draw one continuous, very long stroke for at least 20 seconds. Confirm the
    other browser keeps seeing the live preview and the complete final stroke
    appears after `Cloud: Synced` and reload.
17. Rapidly resize, recolor, relabel, and restyle text, stamps, shapes, and tables
    from both browsers. Confirm no partial or malformed element appears.
18. Toggle **Students Can Write** while the student tab is open. Confirm the
    student immediately becomes read-only, pending writes stop, and editing
    resumes only after permission is restored.
19. Confirm only the owner or administrator can start presenter/follow mode. A
    student who locally chooses a teacher-looking profile must not gain control.
20. Make simultaneous edits that trigger several quick board revisions. Confirm
    neither browser rolls back to an older state after the updates settle.
21. Disconnect the network until automatic retries pause, then close and reopen
    the board with the same account. Reconnect and confirm the account-scoped
    queue resumes. For an anonymous guest, confirm sign-out/account switching is
    blocked until the pending work reaches `Cloud: Synced`.
22. Open and close the timer before starting it, then start/pause both timer and
    stopwatch modes. Confirm only the bounded timer state is synchronized.
23. Upload the same image twice. Confirm deduplication succeeds and no orphaned
    Storage object remains after deleting the duplicate element.
