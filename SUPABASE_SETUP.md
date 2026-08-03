# Fresh Supabase Setup

## 1. Create the project

Create a new Supabase project. No Firebase export or migration is required.

## 2. Install the database schema

Open **SQL Editor**, create a query, paste the full contents of `supabase-schema.sql`, and run it once.

The script creates:

- `profiles`
- `boards`
- `board_shards`
- `board_assets`
- `presence`
- `admin_settings`
- indexes, RLS policies, Storage policies, and optimized RPC functions
- private Storage bucket `board-assets`

The file is safe to rerun while developing because tables, policies, triggers, and functions are created or replaced defensively.

## 3. Configure authentication

In **Authentication → Providers**:

- Enable **Anonymous Sign-Ins** for guest students using shared links.
- Enable **Google** for teachers and permanent accounts.

For Google OAuth, configure the Google client credentials requested by Supabase. Add the deployed app URL and local URL to the allowed redirect URLs, including:

```text
http://localhost:3000
```

## 4. Configure the app

Copy `.env.example` to `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_LOCAL_SANDBOX=false
PORT=3000
```

Find the URL and publishable key under **Project Settings → API**.

Never expose the service-role key.

## 5. Create the first administrator

First sign in to the app with Google so Supabase creates your profile. Then run this in SQL Editor, replacing the email:

```sql
update public.profiles
set is_admin = true,
    updated_at = now()
where id = (
  select id
  from auth.users
  where email = 'YOUR_EMAIL@example.com'
);
```

Sign out and back in after changing administrator access.

## 6. Run locally

```bash
npm install
npm run dev
```

The Node server is required because it hosts `/ws`, the zero-database relay used for cursors and live drawing.

## 7. Production deployment

Build the frontend and run the Node server:

```bash
npm run build
NODE_ENV=production npm start
```

Deploy to a host that supports long-running Node processes and WebSocket upgrades. A static-only host will load saved boards but will not provide live cursors or instant peer updates.

## Sharing behavior

New boards are private. Clicking **Copy Link** as the owner explicitly changes that board to:

- `link-edit` while student writing is enabled
- `link-view` while student writing is disabled

The board is not listed publicly. Someone must have its URL, and all database/Storage access remains enforced by RLS.
