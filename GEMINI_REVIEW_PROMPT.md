# Small Gemini Build Mode finishing prompt

Paste this after uploading the full updated repository:

```text
Open this updated repository and run npm install, then npm run verify. Fix only genuine TypeScript, test, build, or runtime integration errors you find. Do not redesign the UI and do not weaken these completed protections: secure hashed share links and board_members RLS, private.admin_users, blocked direct board_shards writes, authenticated single WebSocket per board, server-side mutation validation, private Storage MIME/size/path/quota rules, user-scoped IndexedDB caches, removed public log endpoints, and session-only Gemini-key storage. Do not add paid services, Redis, Edge Functions, a service-role browser key, or another server. Preserve Supabase Free and Render Free compatibility. Report the exact files changed and why.
```
