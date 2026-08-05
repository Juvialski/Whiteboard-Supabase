# Browser Storage Quota Fix

The previous build stored complete whiteboard snapshots under `whiteboard_elements_*` in browser `localStorage`. Large boards could fill that small synchronous storage area. Supabase PKCE also needs localStorage briefly to save an OAuth code verifier, so Google sign-in failed with `QuotaExceededError`.

This build fixes the issue by:

- moving complete board recovery snapshots to IndexedDB
- migrating old `whiteboard_elements_*` data to IndexedDB before Google login
- using a resilient Supabase Auth storage adapter that evicts only obsolete board snapshots if an auth write still reaches quota
- keeping localStorage only for small settings and Supabase session information

For a browser that already has the old deployment cached, deploy this version and reload once. The migration runs automatically before the next Google sign-in.
