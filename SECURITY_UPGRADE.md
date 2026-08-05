# Security and free-tier upgrade

This release keeps the existing React/Vite interface, one Render web service, and one Supabase Free project. It does not require Redis, Edge Functions, a service-role key in the browser, persistent Render disks, or paid services.

## 1. Apply the database migration

For an existing Supabase project, open **SQL Editor** and run only:

```text
supabase/migrations/202608050002_security_free_tier_hardening.sql
```

For a completely new project, run the combined root file:

```text
supabase-schema.sql
```

The migration is idempotent for normal re-runs. It:

- Migrates legacy editor/viewer arrays to `board_members`.
- Disables insecure `link-view`, `link-edit`, and broad `public` access.
- Adds hashed secure share links, membership redemption, owner member listing, and access removal RPCs.
- Moves administrators to `private.admin_users`.
- Prevents direct client writes to board shards.
- Restricts profile column updates.
- Validates board mutations server-side.
- Restricts private Storage to approved media and 20 MB per file.
- Adds stable cursor pagination and bounded object-URL media caching.

Old insecure sharing URLs intentionally stop granting access. Owners must create a new secure link from the dashboard or whiteboard Share button.

## 2. Configure the first administrator

After the target user has signed in with Google at least once, run this in SQL Editor:

```sql
insert into private.admin_users (user_id)
select id
from auth.users
where email = 'YOUR_EMAIL@example.com'
on conflict (user_id) do nothing;
```

Do not set `profiles.is_admin` from the browser. The application no longer trusts it.

## 3. Render free service

Use the included `render.yaml`, or configure manually:

```text
Build command: npm install --include=dev && npm run build
Start command: npm start
Health check path: /healthz
Node: 22.x
```

Set these environment variables in Render:

```text
NODE_ENV=production
APP_ORIGIN=https://YOUR_RENDER_SERVICE.onrender.com
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
VITE_TURNSTILE_SITE_KEY=OPTIONAL_FREE_TURNSTILE_SITE_KEY
```

`APP_ORIGIN` may contain comma-separated allowed production origins. Never add a Supabase service-role key.

## 4. Supabase Auth settings

Keep Google Auth enabled for owners. Keep anonymous sign-ins enabled for students using secure invitation links.

Optional abuse protection uses Cloudflare Turnstile's free widget:

1. Create a Turnstile site for the Render domain.
2. Put its public site key in `VITE_TURNSTILE_SITE_KEY`.
3. In Supabase Dashboard, configure the matching CAPTCHA secret for Auth.
4. Redeeming a share link will require the browser security check before anonymous sign-in.

When no Turnstile site key is configured, the app retains the previous anonymous join flow.

## 5. Secure sharing behavior

- A raw token is generated using cryptographically random bytes.
- Only its SHA-256 hash is stored.
- The token is copied once in `?share=...`.
- The browser removes the raw token from the address immediately, then uses `?board=...` after successful redemption.
- The board-ID URL works only for a user who already has RLS membership.
- Owners can create view-only or edit links, choose expiry, and revoke links.
- Revoking a link prevents new redemptions. Existing memberships can be removed separately from the same Share dialog.

## 6. UptimeRobot

Monitor:

```text
https://YOUR_RENDER_SERVICE.onrender.com/healthz
```

Use HTTP GET, expected status 200, every five minutes. The health route does not query Supabase. A Render deployment, platform incident, or free-instance cold start can still produce a brief alert.

## 7. Free-tier limits intentionally used

- One authenticated WebSocket per browser/board.
- Realtime cursors and drawing previews do not write to Postgres.
- Sharded checkpoint RPCs remain batched.
- Dashboard queries return lightweight board summaries.
- Downloaded assets use revocable object URLs with a 100 MB in-memory LRU-style cap.
- Per-file Storage limit is 20 MB, with a conservative 250 MB cap per board.
- No database heartbeat or Supabase keep-alive query is added.
- Rate limiting is in-process because the deployment uses one Render instance.

## 8. Optional anonymous-account cleanup

No paid scheduler is required. When needed, review old anonymous users in Supabase and remove only accounts that own no boards and have no active memberships. Never delete users blindly. A safe cleanup should first verify references in `boards.owner_uid` and `board_members.user_id`.


## Validation and package installation

The repository uses npm commands on Render. A lockfile could not be regenerated in the offline build environment used for this patch, so Render uses `npm install` rather than `npm ci`. Generate and commit `package-lock.json` from a normal npm-connected machine when convenient; this does not require a paid account.
