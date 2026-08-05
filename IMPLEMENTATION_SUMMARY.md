# Completed security and free-tier implementation

This repository contains the complete first-party implementation of the requested hardening work for one Supabase Free project and one Render Free web service.

## Implemented

1. Fast `/healthz` monitoring route, production startup validation, graceful shutdown, and Render blueprint.
2. Public browser/server log collection removed; sensitive server errors are redacted.
3. Small route-specific API bodies, security headers, origin checks, and in-memory rate limiting.
4. Gemini API keys are memory-only by default with optional session-only retention; the old permanent key is removed.
5. Hashed secure share tokens, `board_members`, owner link/member management, expiry, revocation, and one-time URL redemption.
6. Administrators moved to `private.admin_users`; users may update only safe profile columns.
7. Direct authenticated shard writes removed; persistence uses the validated mutation RPC only.
8. Board patches and mutations are allowlisted and validated server-side with bounded sizes, IDs, types, drawing points, timestamps, and media fields.
9. One authenticated WebSocket per board; verified Supabase sessions, immutable socket identity, RLS permission lookup, rate limits, heartbeat, backpressure, origin validation, and periodic permission refresh.
10. Anonymous students may redeem valid links but cannot create boards or share links; optional free Turnstile support is included.
11. Recovery and pending-mutation caches are scoped by Supabase project, user, and board and are cleared after sign-out or denied access.
12. Private Storage has an approved MIME allowlist, file-signature checks, 20 MB per-file limit, conservative 250 MB per-board quota, owner-only destructive deletion, and no SVG uploads.
13. Dashboard board listing is lightweight and cursor-paginated; asset downloads use bounded revocable object URLs instead of permanent Base64 copies.
14. Existing sharded checkpoints and database-free cursor/drawing-preview traffic remain in place for free-tier efficiency.

## Deployment order

1. Existing Supabase project: run `supabase/migrations/202608050002_security_free_tier_hardening.sql` once in SQL Editor.
2. New Supabase project: run the combined `supabase-schema.sql` instead.
3. Add the owner to `private.admin_users` using the command in `SECURITY_UPGRADE.md`.
4. In Render, deploy with `npm install --include=dev && npm run build`, `npm start`, and health path `/healthz`.
5. Set `APP_ORIGIN`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. Turnstile is optional.
6. Existing `link-view`, `link-edit`, and broad `public` access are intentionally invalidated. Create new secure links from the Share dialog.

## Local verification

Run on a machine with npm registry access:

```bash
npm install
npm run verify
```

Commit the generated `package-lock.json` afterward. `bun.lock` was removed so deployment uses one package manager consistently.
