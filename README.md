# Collaborative Whiteboard — Supabase Edition

A React/Vite collaborative whiteboard using Supabase Auth, Postgres/RLS, private
Storage, and one authenticated Node WebSocket relay. It is designed for one
Supabase Free project and one Render Free web service.

## Backend design

- Google Auth for owners and anonymous Auth for students redeeming secure links
- Hashed share tokens and relational `board_members`
- Sixteen deterministic JSONB state shards per board
- Validated `apply_board_mutations` checkpoints in resumable bounded batches
- Private Storage for images, signatures, audio, and PDF pages
- One WebSocket per board/browser for cursors, live strokes, previews, and manifests
- Project/user/board-scoped IndexedDB queues for unsynced edits
- Bounded data-URL media cache; cloud boards are not duplicated into localStorage
- Lightweight keyset-paginated dashboard queries

## Start a new project

1. Create a Supabase project.
2. Run the generated `supabase-schema.sql` once in SQL Editor.
3. Enable Google and Anonymous sign-ins.
4. Add the first administrator using `SUPABASE_SETUP.md`.
5. Copy `.env.example` to `.env.local` and enter the project URL and publishable key.
6. Install and run:

```bash
npm ci --include=dev
npm run dev
```

Open `http://localhost:3000`.

## Authentication and offline behavior

- Loading the dashboard does not create an anonymous account.
- Anonymous students are created only while redeeming a valid secure invitation.
- Anonymous users cannot create boards or sharing links.
- Google OAuth uses Supabase PKCE session restoration.
- Sign-out and guest-to-Google transitions first attempt to flush pending edits.
- Failed flushes keep the original user's scoped IndexedDB queue for later recovery.

## Commands

```bash
npm run dev               # Vite middleware + Node/WebSocket server
npm run build             # frontend and bundled production server
npm start                 # run dist/server.cjs
npm run schema:generate   # regenerate fresh-project schema from migrations
npm run check:migrations  # verify schema history and canonical copies
npm run typecheck         # TypeScript validation
npm test                  # Vitest suite
npm run verify            # migrations + types + tests + production build
```

## Security rule

Only put the Supabase **publishable/anon key** in
`VITE_SUPABASE_PUBLISHABLE_KEY`. Never expose a service-role or secret key in the
browser or Render frontend environment.

For the already-upgraded production project, this follow-up source package needs
no additional SQL. Use `FINAL_DEPLOYMENT_CHECKLIST.md` after deployment.
