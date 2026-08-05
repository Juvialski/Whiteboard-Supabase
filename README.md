# Collaborative Whiteboard — Supabase Edition

This repository uses a fresh Supabase backend. It does not read, migrate, or depend on the old Firebase database.

## Included backend design

- Supabase Auth for Google and anonymous guest sessions
- Postgres with Row Level Security for boards, permissions, presence, and settings
- 16 deterministic JSONB state shards per board
- One atomic `apply_board_mutations` RPC for each debounced save checkpoint
- Private Supabase Storage for images, audio, signatures, and PDF pages
- The existing Node WebSocket relay for cursors, drawing previews, live element updates, and shard-change notifications
- IndexedDB recovery for unflushed local mutations
- IndexedDB board recovery cache; full board snapshots are never stored in localStorage

## Start here

1. Create a new Supabase project.
2. Run `supabase-schema.sql` in the Supabase SQL Editor.
3. Enable Google and Anonymous sign-ins in Supabase Authentication.
4. Copy `.env.example` to `.env.local` and enter the project URL and publishable key.
5. Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Read [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for exact dashboard and deployment steps.

## Authentication behavior

- Google OAuth uses Supabase PKCE session restoration.
- The dashboard does not create anonymous users merely by loading.
- A guest session is created only after an explicit guest action, such as creating a board or joining a shared link.
- Concurrent guest requests share one in-flight sign-in, preventing duplicate `/signup` calls.
- Database work is deferred outside `onAuthStateChange`, preventing OAuth session-lock races.

## Commands

```bash
npm run dev       # Vite + Node WebSocket relay
npm run build     # Production frontend bundle
npm run start     # Run the Node server; NODE_ENV=production serves dist
npm run lint      # TypeScript validation
npm test          # Vitest suite
```

## Important security rule

Only put the Supabase **publishable key** in `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put a service-role or secret key in browser environment variables.
