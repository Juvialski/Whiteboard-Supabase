-- Fix board image/audio/PDF uploads on the existing text-ID whiteboard schema.
-- The earlier storage INSERT policy depended on storage object metadata during
-- the INSERT check. Bucket limits already enforce MIME type and file size, so
-- this policy keeps authorization strict while avoiding that fragile check.

begin;

-- Ensure the private free-tier bucket exists and has conservative limits.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'board-assets',
  'board-assets',
  false,
  20971520,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'
  ]::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Extract the text board ID from boards/<board-id>/<file> without depending on
-- object metadata or an exposed search_path.
create or replace function public.storage_board_id(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^boards/[^/]+/[^/]+$' then pg_catalog.split_part(p_name, '/', 2)
    else null
  end
$$;

create or replace function public.storage_asset_path_valid(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    pg_catalog.length(coalesce(p_name, ''::text)) between 1 and 512
    and p_name ~ '^boards/[A-Za-z0-9_.:-]{1,160}/[A-Za-z0-9_.:-]{1,160}\.(png|jpg|jpeg|webp|gif|pdf|mp3|wav|ogg|webm)$'
$$;

revoke execute on function public.storage_board_id(text) from public, anon;
revoke execute on function public.storage_asset_path_valid(text) from public, anon;
grant execute on function public.storage_board_id(text) to authenticated;
grant execute on function public.storage_asset_path_valid(text) to authenticated;

-- Keep metadata authorization and the 20 MB / 250 MB metadata quota.
drop policy if exists board_assets_insert on public.board_assets;
create policy board_assets_insert on public.board_assets
for insert to authenticated
with check (
  public.can_write_board(board_id)
  and original_byte_size between 1 and 20971520
  and public.board_asset_quota_available(board_id, original_byte_size)
  and public.storage_asset_path_valid(object_path)
  and public.storage_board_id(object_path) = board_id
);

grant select, insert, delete on public.board_assets to authenticated;

-- Storage policies. SELECT is intentionally present as well as INSERT because
-- Supabase Storage may read the object row during an upload/duplicate check.
drop policy if exists board_assets_storage_select on storage.objects;
drop policy if exists board_assets_storage_insert on storage.objects;
drop policy if exists board_assets_storage_update on storage.objects;
drop policy if exists board_assets_storage_delete on storage.objects;

create policy board_assets_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'board-assets'
  and public.storage_asset_path_valid(name)
  and public.can_read_board(public.storage_board_id(name))
);

create policy board_assets_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'board-assets'
  and public.storage_asset_path_valid(name)
  and public.can_write_board(public.storage_board_id(name))
);

-- Assets are immutable. The client creates a new content-addressed object when
-- an image is cropped or replaced, so no UPDATE policy is needed.
create policy board_assets_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'board-assets'
  and public.storage_asset_path_valid(name)
  and public.can_manage_board(public.storage_board_id(name))
);

commit;
