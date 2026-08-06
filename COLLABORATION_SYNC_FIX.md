# Collaboration synchronization fix

This patch fixes two independent client-side problems:

1. The browser still sent the removed WebSocket `join` message, while the Render server requires an authenticated first message containing the current Supabase access token and board ID.
2. A legacy device-local IndexedDB key (`drawings_<boardId>`) replaced the authoritative Supabase drawing set after load, so each browser could display its own drawings as though it were on a separate board.

The app now authenticates both collaboration sockets, waits for server confirmation before sending realtime events, reloads changed shards after checkpoints, and uses the full recovery cache only as a temporary preview. Automatic checkpoint status is also reported correctly instead of remaining on `Local Buffer` after a successful save.

No additional Supabase SQL is required for this collaboration patch if the share-link pgcrypto SQL fix has already been run.
