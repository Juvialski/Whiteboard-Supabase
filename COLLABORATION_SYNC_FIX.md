# Collaboration synchronization architecture

The original unauthenticated `join` protocol and browser-only drawing override
have been removed. The current build uses one authenticated WebSocket per board,
shared by canvas collaboration and shard-manifest persistence. Supabase remains
the authoritative saved state; IndexedDB is used for account-scoped recovery,
pending edits, and validated persistent media caching after board authorization.

The concurrency follow-up also requires the ordered
`202608080001_free_tier_concurrency_optimizations.sql` migration on existing
production projects.
