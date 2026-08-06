# Collaboration synchronization architecture

The original unauthenticated `join` protocol and browser-only drawing override
have been removed. The current build uses one authenticated WebSocket per board,
shared by canvas collaboration and shard-manifest persistence. Supabase remains
the authoritative saved state; IndexedDB is used only for account-scoped recovery
and pending edits.

No additional SQL is required for this source follow-up.
