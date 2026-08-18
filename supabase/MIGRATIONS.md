# Supabase migration policy

The production whiteboard uses **text board IDs and text owner IDs**. The files in
this folder are the database source of truth and must be applied in filename order.

## Existing production project

Do not rerun migrations that already succeeded. Apply only genuinely new migration
files. The current concurrency follow-up adds
`202608080001_free_tier_concurrency_optimizations.sql`; apply it once after the
existing `202608070001_add_individual_member_view_only.sql` migration.
The application intentionally fails with a clear error when a required secure RPC
is missing; it never falls back to direct unrestricted table access.

## New project

Apply every `*.sql` file in this folder in filename order, use the Supabase CLI
migration workflow, or run the generated root `supabase-schema.sql` once. The root
file is for a completely new project only.

`scripts/generate-schema.mjs` removes standalone transaction wrappers from the
individual source sections and surrounds the complete generated schema with one
outer `BEGIN`/`COMMIT`. This makes a fresh SQL Editor install atomic: a later error
rolls back the whole schema instead of leaving partially applied security rules.

Run before committing database changes:

```bash
npm run schema:generate
npm run check:migrations
```

## Safety rules

- Never run an old UUID hardening script against the production text-ID database.
- Never create `using (true)` policies to work around an application error.
- Keep `private.admin_users` outside the exposed API schema.
- Keep the `board-assets` bucket private.
- Do not hand-edit generated `supabase-schema.sql`; edit migrations and regenerate it.
