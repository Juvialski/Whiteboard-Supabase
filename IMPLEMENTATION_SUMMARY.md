# Completed security, reliability, and free-tier implementation

This repository is designed for one Supabase Free project and one Render Free web
service. It does not require Redis, Edge Functions, a service-role key in the
browser, persistent Render disks, or paid infrastructure.

## Implemented

1. Fast `/healthz`, production startup checks, graceful shutdown, and Render blueprint.
2. Sensitive log collection removed; API bodies, origins, headers, and in-memory rates bounded.
3. Secure hashed share tokens, relational memberships, expiry, revocation, and member removal.
4. Administrators stored in `private.admin_users`; profile updates are column-restricted.
5. Direct shard writes blocked; saves use validated atomic mutation RPCs.
6. Offline queues are project/user/board-scoped, serialized, and restored before cloud hydration.
7. Large reconnect/paste/import queues use resumable 400-item/approximately-6-MB RPC batches.
8. One authenticated WebSocket per browser/board with immutable identity and permission refresh.
9. Anonymous students can redeem valid links but cannot create boards or share links; Turnstile is optional.
10. Private Storage has MIME/signature checks, 20 MB files, bounded board usage, and a 64 MB object-URL cache.
11. Dashboard queries are lightweight and keyset-paginated; high-frequency collaboration avoids Postgres.
12. A safe graph parser replaces runtime JavaScript evaluation and supports graph exports.
13. PNG/SVG/PDF exports cover persisted media and all noninteractive board element types.
14. PDF import is bounded to 25 MB/100 pages and initializes through secured RPC batches.
15. Ordered text-ID migrations generate one atomic fresh-project `supabase-schema.sql`.

## Existing production project

The production Supabase project has already received the security and follow-up SQL
fixes from the preceding rollout. **This source-code follow-up does not require
another SQL Editor action.** Deploy the application files and run the regression
checklist in `FINAL_DEPLOYMENT_CHECKLIST.md`.

## New Supabase project

Run the generated root `supabase-schema.sql` once, configure Auth, then add the
first administrator as described in `SUPABASE_SETUP.md`.

## Verification command

On a machine with normal npm registry access:

```bash
npm ci --include=dev
npm run verify
```

## Final coordinated reliability pass

- Serialized/coalesced manifest refresh prevents stale revision rollback.
- Realtime elements and timers receive explicit server schema validation.
- Long live strokes stay under WebSocket limits while final drawings remain full.
- Automatic checkpoint retries are bounded and recoverable queues survive safely.
- Anonymous users cannot abandon unsynced guest-only work.
- Fresh presence schema and policies now match the text-ID production model.
