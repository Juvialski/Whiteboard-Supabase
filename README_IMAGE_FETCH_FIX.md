# Image `Failed to fetch` fix

This patch replaces `fetch(dataUrl)` in `src/services/storageService.ts` with local data-URL decoding.

The production Content Security Policy intentionally does not allow `data:` under `connect-src`, so using `fetch()` on a pasted image's `data:image/...` URL was blocked before Supabase Storage was contacted.

No Supabase SQL change is required for this patch.
