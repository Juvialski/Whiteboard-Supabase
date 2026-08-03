# Google and Guest Authentication Fix

The Supabase Auth logs showed successful anonymous `/signup` requests (`200`). The old client incorrectly treated the result as a disabled-provider error because several application paths started guest authentication at the same time while Google OAuth was restoring its session.

This version changes the flow as follows:

- Dashboard and global-settings loading never create an anonymous user.
- Anonymous sign-in occurs only after an explicit guest action.
- All concurrent guest-auth requests share one promise.
- A pending Google OAuth callback blocks guest sign-in until the PKCE session settles.
- Temporary anonymous sessions are signed out locally before Google login.
- The Supabase auth callback remains synchronous; React and database work is deferred.
- Error logging now preserves Auth error `message`, `code`, and `status` instead of displaying `{}`.

No database schema change is required for this fix. Keep Google and Anonymous providers enabled, retain the existing redirect URLs, redeploy the application, and test in a private/incognito window.
