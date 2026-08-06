# Board asset upload fix

This patch fixes image, PDF-page, and audio uploads after the security migration.

## Existing Supabase project

Run only this file in Supabase SQL Editor:

`supabase/migrations/202608060003_fix_board_asset_upload.sql`

Choose **Run without RLS** if the SQL Editor warning appears. The migration drops and recreates only the `board-assets` Storage policies and the matching `board_assets` insert policy. It does not delete boards, drawings, files, or members.

## Render / Gemini deployment

Deploy the updated frontend files as well:

- `src/services/storageService.ts`
- `src/components/WhiteboardCanvas.tsx`

The frontend now:

- Uses the actual MIME type of the generated blob.
- Keeps the client limit aligned with the 20 MB private bucket limit.
- Stores pasted images as JPEG when the compressor outputs JPEG.
- Creates blank PDF pages as PNG instead of blocked SVG.
- Shows the real upload error if another problem remains.

## Test

1. Refresh the teacher tab after running the SQL migration.
2. Paste a screenshot or add an image.
3. Wait for `Cloud: Synced`.
4. Reload the teacher tab and confirm the image remains.
5. Open the secure share link in incognito and confirm the image loads there.
6. Add an image as the guest and reload both tabs.
