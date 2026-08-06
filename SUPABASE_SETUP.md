# Fresh Supabase setup

These instructions are for a **brand-new** project. The existing production
project has already been migrated and should not rerun the root schema.

## 1. Create the project and schema

Create a Supabase project. In SQL Editor, run the full generated
`supabase-schema.sql` once. The generated file is wrapped in one transaction, so
a failure rolls back the fresh setup. It creates profiles, text-ID boards, shards, private
assets, memberships, share links, presence, settings, RLS policies, Storage
policies, triggers, and secured RPCs.

## 2. Configure authentication

Under Authentication:

- Enable **Google** for owners/permanent users.
- Enable **Anonymous Sign-Ins** for students redeeming secure links.
- Set the production Site URL and allowed redirect URL.
- Keep `http://localhost:3000/**` only for local development.

Optional: configure Cloudflare Turnstile and set the public key as
`VITE_TURNSTILE_SITE_KEY`.

## 3. Add the first administrator

Sign in with Google once, then run:

```sql
insert into private.admin_users (user_id)
select id
from auth.users
where lower(email) = lower('YOUR_EMAIL@example.com')
on conflict (user_id) do nothing;
```

Verify:

```sql
select a.user_id, u.email, a.created_at
from private.admin_users a
join auth.users u on u.id = a.user_id;
```

Do not set `profiles.is_admin`; authorization uses the protected private table.

## 4. Configure environment

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_LOCAL_SANDBOX=false
APP_ORIGIN=http://localhost:3000
PORT=3000
```

Never expose the service-role key.

## 5. Run locally

```bash
npm ci --include=dev
npm run verify
npm run dev
```

The Node server is required for `/ws`; a static-only host cannot provide live
collaboration.

## Sharing model

New boards are private. Owners create hashed view/edit invitations. The raw token
appears only once in the URL fragment, is redeemed into `board_members`, and is
then removed. Plain `?board=` URLs never grant permission by themselves.
