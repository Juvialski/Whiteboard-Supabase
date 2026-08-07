# Security and free-tier deployment notes

This project uses one Supabase Free project and one Render Free web service. It
requires no Redis, Edge Functions, service-role key in the browser, persistent
Render disk, or paid monitoring.

## Existing upgraded project

The current production project has already received the security migration and
follow-up SQL repairs. Do not rerun old standalone migration files. For the
individual per-user View Only control, apply only the new migration
`supabase/migrations/202608070001_add_individual_member_view_only.sql`, then
deploy the application build.

## Brand-new Supabase project

Run the generated root file once:

```text
supabase-schema.sql
```

It is generated from the ordered files in `supabase/migrations`. Run
`npm run check:migrations` before committing database changes.

## First administrator

After the owner signs in with Google once, run:

```sql
insert into private.admin_users (user_id)
select id
from auth.users
where lower(email) = lower('YOUR_EMAIL@example.com')
on conflict (user_id) do nothing;
```

The browser cannot edit administrator membership.

## Render free service

Use `render.yaml`, or configure:

```text
Build command: npm ci --include=dev && npm run build
Start command: npm start
Health check path: /healthz
Node: 22.x
```

Environment variables:

```text
NODE_ENV=production
APP_ORIGIN=https://YOUR_RENDER_SERVICE.onrender.com
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
VITE_TURNSTILE_SITE_KEY=OPTIONAL_FREE_TURNSTILE_SITE_KEY
```

Never configure a service-role key in this application.

## Auth and sharing

- Keep Google Auth enabled for owners.
- Keep Anonymous Sign-Ins enabled for students using secure invitations.
- Optional Cloudflare Turnstile uses the free public widget plus the matching
  Supabase Auth CAPTCHA secret.
- New invitations place the raw token in `#share=...`; fragments are not sent in
  normal HTTP requests. After redemption the URL becomes `?board=...`.
- A board-ID URL works only for a user who already has RLS membership.
- Owners can create view/edit links, choose expiry, revoke links, and remove
  already-redeemed members.

## Free-tier safeguards

- One authenticated WebSocket per board/browser.
- Cursor and live-stroke traffic does not write to Postgres.
- Dashboard queries are lightweight and keyset-paginated.
- Private files are limited to 20 MB each; PDF import is limited to 25 MB/100 pages.
- Downloaded assets use a 64 MB revocable object-URL cache.
- Offline mutation queues are account-scoped, serialized, and flushed in bounded batches.
- No Supabase keep-alive query is used.
- API and WebSocket limits are in-process because Render runs one instance.

## UptimeRobot

Monitor `https://YOUR_RENDER_SERVICE.onrender.com/healthz` with HTTP GET every
five minutes. The health route does not query Supabase.
