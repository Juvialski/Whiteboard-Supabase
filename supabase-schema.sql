-- Consolidated schema generated from supabase/migrations.
-- For a new project, run this entire file once. Existing projects should apply only unapplied migrations.
-- The outer transaction prevents a partially hardened fresh installation if a later statement fails.

begin;
-- =====================================================================
-- SOURCE: supabase/migrations/202608030001_fresh_whiteboard.sql
-- =====================================================================
-- Fresh Supabase backend matching the production legacy-compatible schema.
-- Board and owner IDs are text because the live project was created with text identifiers.
-- New projects should apply every file in supabase/migrations in filename order.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.boards (
  id text primary key default gen_random_uuid()::text,
  name text not null default 'Untitled Board',
  description text not null default '',
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  created_by text not null default 'Unknown',
  owner_uid text not null,
  access_mode text not null default 'private' check (access_mode in ('private', 'shared', 'link-view', 'link-edit', 'public')),
  editor_uids text[] not null default '{}',
  viewer_uids text[] not null default '{}',
  status text not null default 'ready' check (status in ('initializing', 'ready')),
  student_id text not null default '',
  student_name text not null default '',
  students_can_write boolean not null default true,
  schema_version integer not null default 4,
  shard_layout_version integer not null default 3,
  shard_count integer not null default 16 check (shard_count between 1 and 64),
  current_revision bigint not null default 0,
  changed_shard_ids text[] not null default '{}',
  deleted_shard_ids text[] not null default '{}',
  total_elements integer not null default 0,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.board_shards (
  board_id text not null references public.boards(id) on delete cascade,
  shard_id text not null,
  revision bigint not null default 0,
  elements jsonb not null default '{}'::jsonb,
  tombstones jsonb not null default '{}'::jsonb,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  primary key (board_id, shard_id)
);

create table if not exists public.board_assets (
  board_id text not null references public.boards(id) on delete cascade,
  asset_id text not null,
  mime_type text not null,
  object_path text not null unique,
  encoded_byte_size bigint not null default 0,
  original_byte_size bigint,
  width integer,
  height integer,
  content_hash text not null,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  created_by uuid references auth.users(id) on delete set null,
  primary key (board_id, asset_id),
  unique (board_id, content_hash)
);

create table if not exists public.presence (
  id text primary key,
  profile_id text,
  name text not null default 'Guest User',
  email text,
  last_active bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  is_online boolean not null default true,
  role text not null default 'student',
  current_board_id text references public.boards(id) on delete set null,
  current_board_name text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.admin_settings (
  id text primary key,
  app_enabled boolean not null default true,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_by text,
  data jsonb not null default '{}'::jsonb
);

insert into public.admin_settings (id, app_enabled)
values ('global', true)
on conflict (id) do nothing;

-- Index every column used by dashboard filters, RLS, and realtime recovery.
create index if not exists boards_owner_uid_idx on public.boards(owner_uid);
create index if not exists boards_updated_at_idx on public.boards(updated_at desc);
create index if not exists boards_created_at_idx on public.boards(created_at desc);
create index if not exists boards_status_idx on public.boards(status);
create index if not exists boards_created_by_idx on public.boards(created_by);
create index if not exists boards_student_name_idx on public.boards(student_name);
create index if not exists boards_student_id_idx on public.boards(student_id);
create index if not exists boards_editor_uids_gin_idx on public.boards using gin(editor_uids);
create index if not exists boards_viewer_uids_gin_idx on public.boards using gin(viewer_uids);
create index if not exists board_shards_board_revision_idx on public.board_shards(board_id, revision);
create index if not exists board_assets_board_idx on public.board_assets(board_id);
create index if not exists presence_last_active_idx on public.presence(last_active desc);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do update
  set display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_user_meta_data, email on auth.users
for each row execute procedure public.handle_new_auth_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false)
$$;

create or replace function public.can_manage_board(p_board_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boards b
    where b.id = p_board_id
      and (b.owner_uid = (select auth.uid())::text or public.is_admin())
  )
$$;

create or replace function public.can_read_board(p_board_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boards b
    where b.id = p_board_id
      and (
        public.is_admin()
        or b.owner_uid = (select auth.uid())::text
        or (select auth.uid())::text = any(b.editor_uids)
        or (select auth.uid())::text = any(b.viewer_uids)
        or b.access_mode in ('link-view', 'link-edit', 'public')
      )
  )
$$;

create or replace function public.can_write_board(p_board_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boards b
    where b.id = p_board_id
      and (
        public.is_admin()
        or b.owner_uid = (select auth.uid())::text
        or (select auth.uid())::text = any(b.editor_uids)
        or (b.access_mode in ('link-edit', 'public') and b.students_can_write)
      )
  )
$$;

create or replace function public.list_my_boards(
  p_limit integer default 13,
  p_offset integer default 0
)
returns setof public.boards
language sql
stable
security definer
set search_path = public
as $$
  select b.*
  from public.boards b
  where b.status = 'ready'
    and (
      public.is_admin()
      or b.owner_uid = (select auth.uid())::text
      or (select auth.uid())::text = any(b.editor_uids)
      or (select auth.uid())::text = any(b.viewer_uids)
    )
  order by b.created_at desc
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0)
$$;

create or replace function public.get_board_state(p_board_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_board jsonb;
  v_shards jsonb;
begin
  if not public.can_read_board(p_board_id) then
    raise exception 'Not authorized to read this board';
  end if;

  select to_jsonb(b) into v_board
  from public.boards b
  where b.id = p_board_id;

  if v_board is null then
    raise exception 'Board not found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.shard_id), '[]'::jsonb)
    into v_shards
  from public.board_shards s
  where s.board_id = p_board_id;

  return jsonb_build_object('board', v_board, 'shards', v_shards);
end;
$$;

create or replace function public.patch_board(p_board_id text, p_patch jsonb)
returns public.boards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.boards;
  v_requires_manage boolean;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  v_requires_manage := p_patch ?| array[
    'name', 'description', 'ownerUid', 'accessMode', 'editorUids', 'viewerUids',
    'studentId', 'studentName', 'studentsCanWrite', 'status'
  ];

  if v_requires_manage then
    if not public.can_manage_board(p_board_id) then
      raise exception 'Not authorized to manage this board';
    end if;
  elsif not public.can_write_board(p_board_id) then
    raise exception 'Not authorized to update this board';
  end if;

  update public.boards b
  set
    name = case when p_patch ? 'name' then coalesce(p_patch ->> 'name', b.name) else b.name end,
    description = case when p_patch ? 'description' then coalesce(p_patch ->> 'description', '') else b.description end,
    created_at = case when p_patch ? 'createdAt' then (p_patch ->> 'createdAt')::bigint else b.created_at end,
    updated_at = case when p_patch ? 'updatedAt' then (p_patch ->> 'updatedAt')::bigint else greatest(b.updated_at, v_now) end,
    created_by = case when p_patch ? 'createdBy' then coalesce(p_patch ->> 'createdBy', b.created_by) else b.created_by end,
    owner_uid = case when p_patch ? 'ownerUid' then p_patch ->> 'ownerUid' else b.owner_uid end,
    access_mode = case when p_patch ? 'accessMode' then p_patch ->> 'accessMode' else b.access_mode end,
    editor_uids = case when p_patch ? 'editorUids' then
      coalesce((select array_agg(value) from jsonb_array_elements_text(p_patch -> 'editorUids')), '{}'::text[])
      else b.editor_uids end,
    viewer_uids = case when p_patch ? 'viewerUids' then
      coalesce((select array_agg(value) from jsonb_array_elements_text(p_patch -> 'viewerUids')), '{}'::text[])
      else b.viewer_uids end,
    status = case when p_patch ? 'status' then p_patch ->> 'status' else b.status end,
    student_id = case when p_patch ? 'studentId' then coalesce(p_patch ->> 'studentId', '') else b.student_id end,
    student_name = case when p_patch ? 'studentName' then coalesce(p_patch ->> 'studentName', '') else b.student_name end,
    students_can_write = case when p_patch ? 'studentsCanWrite' then (p_patch ->> 'studentsCanWrite')::boolean else b.students_can_write end,
    schema_version = case when p_patch ? 'schemaVersion' then (p_patch ->> 'schemaVersion')::integer else b.schema_version end,
    shard_layout_version = case when p_patch ? 'shardLayoutVersion' then (p_patch ->> 'shardLayoutVersion')::integer else b.shard_layout_version end,
    shard_count = case when p_patch ? 'shardCount' then (p_patch ->> 'shardCount')::integer else b.shard_count end,
    current_revision = case when p_patch ? 'currentRevision' then (p_patch ->> 'currentRevision')::bigint else b.current_revision end,
    changed_shard_ids = case when p_patch ? 'changedShardIds' then
      coalesce((select array_agg(value) from jsonb_array_elements_text(p_patch -> 'changedShardIds')), '{}'::text[])
      else b.changed_shard_ids end,
    deleted_shard_ids = case when p_patch ? 'deletedShardIds' then
      coalesce((select array_agg(value) from jsonb_array_elements_text(p_patch -> 'deletedShardIds')), '{}'::text[])
      else b.deleted_shard_ids end,
    total_elements = case when p_patch ? 'totalElements' then (p_patch ->> 'totalElements')::integer else b.total_elements end,
    data = b.data || p_patch
  where b.id = p_board_id
  returning b.* into v_row;

  if not found then
    raise exception 'Board not found';
  end if;
  return v_row;
end;
$$;

create or replace function public.apply_board_mutations(p_board_id text, p_mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board public.boards;
  v_mut jsonb;
  v_shard_id text;
  v_element_id text;
  v_action text;
  v_payload jsonb;
  v_elements jsonb;
  v_tombstones jsonb;
  v_server jsonb;
  v_tombstone jsonb;
  v_server_updated bigint;
  v_tombstone_updated bigint;
  v_local_updated bigint;
  v_server_client text;
  v_tombstone_client text;
  v_local_client text;
  v_local_wins boolean;
  v_before integer;
  v_after integer;
  v_total_delta integer := 0;
  v_applied integer := 0;
  v_rejected integer := 0;
  v_shard_applied integer;
  v_next_revision bigint;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_cutoff bigint := ((extract(epoch from clock_timestamp()) * 1000)::bigint - 604800000);
  v_changed text[] := '{}';
  v_deleted text[] := '{}';
  v_return_shards jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'p_mutations must be a JSON array';
  end if;

  if jsonb_array_length(p_mutations) > 5000 then
    raise exception 'A checkpoint may contain at most 5000 element mutations';
  end if;

  if not public.can_write_board(p_board_id) then
    raise exception 'Not authorized to write this board';
  end if;

  select * into v_board
  from public.boards
  where id = p_board_id
  for update;

  if not found then
    raise exception 'Board not found';
  end if;

  v_next_revision := v_board.current_revision + 1;

  for v_shard_id in
    select distinct value ->> 'shardId'
    from jsonb_array_elements(p_mutations)
    where coalesce(value ->> 'shardId', '') <> ''
  loop
    if v_shard_id !~ '^shard_([0-9]|1[0-5])$' then
      raise exception 'Invalid shard id: %', v_shard_id;
    end if;
    v_shard_applied := 0;

    select s.elements, s.tombstones
      into v_elements, v_tombstones
    from public.board_shards s
    where s.board_id = p_board_id and s.shard_id = v_shard_id
    for update;

    if not found then
      v_elements := '{}'::jsonb;
      v_tombstones := '{}'::jsonb;
    end if;

    select count(*) into v_before from jsonb_object_keys(v_elements);

    for v_mut in
      select value
      from jsonb_array_elements(p_mutations)
      where value ->> 'shardId' = v_shard_id
    loop
      v_element_id := v_mut ->> 'elementId';
      v_action := coalesce(v_mut ->> 'action', 'set');
      if coalesce(v_element_id, '') = '' then
        raise exception 'Mutation elementId is required';
      end if;
      if v_action not in ('set', 'delete') then
        raise exception 'Invalid mutation action: %', v_action;
      end if;
      v_local_updated := coalesce(nullif(v_mut ->> 'updatedAt', '')::bigint, v_now);
      v_local_client := coalesce(v_mut ->> 'updatedByClientId', '');
      v_server := v_elements -> v_element_id;
      v_tombstone := v_tombstones -> v_element_id;
      v_server_updated := coalesce(nullif(v_server ->> 'updatedAt', '')::bigint, 0);
      v_server_client := coalesce(v_server ->> 'updatedByClientId', '');
      v_tombstone_updated := coalesce(nullif(v_tombstone ->> 'updatedAt', '')::bigint, 0);
      v_tombstone_client := coalesce(v_tombstone ->> 'updatedByClientId', '');
      v_local_wins := true;

      if v_tombstone is not null and (
        v_local_updated < v_tombstone_updated or
        (v_local_updated = v_tombstone_updated and v_local_client <= v_tombstone_client)
      ) then
        v_local_wins := false;
      end if;

      if v_server is not null and (
        v_local_updated < v_server_updated or
        (v_local_updated = v_server_updated and v_local_client <= v_server_client)
      ) then
        v_local_wins := false;
      end if;

      if v_local_wins then
        v_applied := v_applied + 1;
        v_shard_applied := v_shard_applied + 1;
        if v_action = 'delete' then
          v_elements := v_elements - v_element_id;
          v_tombstones := jsonb_set(
            v_tombstones,
            array[v_element_id],
            jsonb_build_object('updatedAt', v_local_updated, 'updatedByClientId', v_local_client),
            true
          );
        else
          v_payload := coalesce(v_mut -> 'data', '{}'::jsonb);
          v_payload := jsonb_set(v_payload, '{updatedAt}', to_jsonb(v_local_updated), true);
          v_payload := jsonb_set(v_payload, '{updatedByClientId}', to_jsonb(v_local_client), true);
          v_elements := jsonb_set(v_elements, array[v_element_id], v_payload, true);
          v_tombstones := v_tombstones - v_element_id;
        end if;
      else
        v_rejected := v_rejected + 1;
      end if;
    end loop;

    -- Return the authoritative shard even when every local mutation lost a conflict.
    v_return_shards := jsonb_set(v_return_shards, array[v_shard_id], v_elements, true);

    -- Rejected-only shards are not rewritten and do not advance the board manifest.
    if v_shard_applied > 0 then
      -- Keep delete conflict protection for seven days, then compact automatically.
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        into v_tombstones
      from jsonb_each(v_tombstones)
      where coalesce(nullif(value ->> 'updatedAt', '')::bigint, 0) >= v_cutoff;

      select count(*) into v_after from jsonb_object_keys(v_elements);
      v_total_delta := v_total_delta + (v_after - v_before);
      v_changed := array_append(v_changed, v_shard_id);

      if v_after = 0 and not exists (select 1 from jsonb_object_keys(v_tombstones)) then
        delete from public.board_shards
        where board_id = p_board_id and shard_id = v_shard_id;
        v_deleted := array_append(v_deleted, v_shard_id);
      else
        insert into public.board_shards (
          board_id, shard_id, revision, elements, tombstones, updated_at
        ) values (
          p_board_id, v_shard_id, v_next_revision, v_elements, v_tombstones, v_now
        )
        on conflict (board_id, shard_id) do update
        set revision = excluded.revision,
            elements = excluded.elements,
            tombstones = excluded.tombstones,
            updated_at = excluded.updated_at;
      end if;
    end if;
  end loop;

  if v_applied > 0 then
    update public.boards
    set current_revision = v_next_revision,
        changed_shard_ids = v_changed,
        deleted_shard_ids = v_deleted,
        total_elements = greatest(0, total_elements + v_total_delta),
        updated_at = v_now,
        schema_version = 4,
        shard_layout_version = 3,
        shard_count = 16,
        data = data || jsonb_build_object(
          'currentRevision', v_next_revision,
          'changedShardIds', to_jsonb(v_changed),
          'deletedShardIds', to_jsonb(v_deleted),
          'totalElements', greatest(0, total_elements + v_total_delta),
          'updatedAt', v_now,
          'schemaVersion', 4,
          'shardLayoutVersion', 3,
          'shardCount', 16
        )
    where id = p_board_id;
  else
    v_next_revision := v_board.current_revision;
  end if;

  return jsonb_build_object(
    'revision', v_next_revision,
    'changedShardIds', to_jsonb(v_changed),
    'deletedShardIds', to_jsonb(v_deleted),
    'totalElements', greatest(0, v_board.total_elements + v_total_delta),
    'applied', v_applied,
    'rejected', v_rejected,
    'shards', v_return_shards
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_shards enable row level security;
alter table public.board_assets enable row level security;
alter table public.presence enable row level security;
alter table public.admin_settings enable row level security;

-- Clean replacement policies.
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_select_self on public.profiles
for select to authenticated
using (id = (select auth.uid()) or public.is_admin());
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists boards_select on public.boards;
drop policy if exists boards_insert on public.boards;
drop policy if exists boards_update on public.boards;
drop policy if exists boards_delete on public.boards;
create policy boards_select on public.boards
for select to authenticated
using (public.can_read_board(id));
create policy boards_insert on public.boards
for insert to authenticated
with check (owner_uid = (select auth.uid())::text);
create policy boards_update on public.boards
for update to authenticated
using (public.can_manage_board(id))
with check (public.can_manage_board(id));
create policy boards_delete on public.boards
for delete to authenticated
using (public.can_manage_board(id));

drop policy if exists board_shards_select on public.board_shards;
drop policy if exists board_shards_write on public.board_shards;
create policy board_shards_select on public.board_shards
for select to authenticated
using (public.can_read_board(board_id));
create policy board_shards_write on public.board_shards
for all to authenticated
using (public.can_write_board(board_id))
with check (public.can_write_board(board_id));

drop policy if exists board_assets_select on public.board_assets;
drop policy if exists board_assets_insert on public.board_assets;
drop policy if exists board_assets_update on public.board_assets;
drop policy if exists board_assets_delete on public.board_assets;
create policy board_assets_select on public.board_assets
for select to authenticated
using (public.can_read_board(board_id));
create policy board_assets_insert on public.board_assets
for insert to authenticated
with check (public.can_write_board(board_id));
create policy board_assets_update on public.board_assets
for update to authenticated
using (public.can_write_board(board_id))
with check (public.can_write_board(board_id));
create policy board_assets_delete on public.board_assets
for delete to authenticated
using (public.can_write_board(board_id));

drop policy if exists presence_select on public.presence;
drop policy if exists presence_write_self on public.presence;
drop policy if exists presence_update_self on public.presence;
drop policy if exists presence_delete on public.presence;
create policy presence_select on public.presence
for select to authenticated
using (id = (select auth.uid())::text or public.is_admin());
create policy presence_write_self on public.presence
for insert to authenticated
with check (id = (select auth.uid())::text);
create policy presence_update_self on public.presence
for update to authenticated
using (id = (select auth.uid())::text)
with check (id = (select auth.uid())::text);
create policy presence_delete on public.presence
for delete to authenticated
using (id = (select auth.uid())::text or public.is_admin());

drop policy if exists admin_settings_select on public.admin_settings;
drop policy if exists admin_settings_write on public.admin_settings;
create policy admin_settings_select on public.admin_settings
for select to authenticated
using (true);
create policy admin_settings_write on public.admin_settings
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.boards to authenticated;
grant select, insert, update, delete on public.board_shards to authenticated;
grant select, insert, update, delete on public.board_assets to authenticated;
grant select, insert, update, delete on public.presence to authenticated;
grant select, insert, update, delete on public.admin_settings to authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.can_manage_board(text) from public, anon;
revoke execute on function public.can_read_board(text) from public, anon;
revoke execute on function public.can_write_board(text) from public, anon;
revoke execute on function public.list_my_boards(integer, integer) from public, anon;
revoke execute on function public.get_board_state(text) from public, anon;
revoke execute on function public.patch_board(text, jsonb) from public, anon;
revoke execute on function public.apply_board_mutations(text, jsonb) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_manage_board(text) to authenticated;
grant execute on function public.can_read_board(text) to authenticated;
grant execute on function public.can_write_board(text) to authenticated;
grant execute on function public.list_my_boards(integer, integer) to authenticated;
grant execute on function public.get_board_state(text) to authenticated;
grant execute on function public.patch_board(text, jsonb) to authenticated;
grant execute on function public.apply_board_mutations(text, jsonb) to authenticated;

-- Private Storage bucket for images, audio, signatures, and PDF pages.
insert into storage.buckets (id, name, public, file_size_limit)
values ('board-assets', 'board-assets', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create or replace function public.storage_board_id(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v_parts text[];
begin
  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) < 2 or v_parts[1] <> 'boards' then
    return null;
  end if;
  return v_parts[2];
exception when others then
  return null;
end;
$$;

drop policy if exists board_assets_storage_select on storage.objects;
drop policy if exists board_assets_storage_insert on storage.objects;
drop policy if exists board_assets_storage_update on storage.objects;
drop policy if exists board_assets_storage_delete on storage.objects;
create policy board_assets_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'board-assets'
  and public.can_read_board(public.storage_board_id(name))
);
create policy board_assets_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'board-assets'
  and public.can_write_board(public.storage_board_id(name))
);
create policy board_assets_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'board-assets'
  and public.can_write_board(public.storage_board_id(name))
)
with check (
  bucket_id = 'board-assets'
  and public.can_write_board(public.storage_board_id(name))
);
create policy board_assets_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'board-assets'
  and public.can_write_board(public.storage_board_id(name))
);

-- Live cursors, drawing previews, and shard-change notifications use the app's
-- existing WebSocket relay, so database replication is intentionally not enabled.

-- After every migration has been applied, give the first administrator access
-- through the protected private table (never through public.profiles.is_admin):
-- insert into private.admin_users (user_id)
-- select id from auth.users where lower(email) = lower('YOUR_EMAIL@example.com')
-- on conflict (user_id) do nothing;

-- =====================================================================
-- SOURCE: supabase/migrations/202608050002_security_free_tier_hardening.sql
-- =====================================================================
-- Security and free-tier hardening for the EXISTING legacy whiteboard schema.
-- This project stores board IDs and owner IDs as text.
-- Do not run the UUID-based 202608050002 migration on this database.
-- This migration is idempotent and safe to rerun after the earlier foreign-key failure.

create extension if not exists pgcrypto;

-- This migration targets the legacy schema created by the in-app setup script.
-- Stop early with a clear error rather than applying UUID assumptions to text IDs.
do $$
declare
  v_board_id_type text;
  v_owner_uid_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_board_id_type
  from pg_attribute a
  where a.attrelid = 'public.boards'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  select format_type(a.atttypid, a.atttypmod)
    into v_owner_uid_type
  from pg_attribute a
  where a.attrelid = 'public.boards'::regclass
    and a.attname = 'owner_uid'
    and not a.attisdropped;

  if v_board_id_type is distinct from 'text' then
    raise exception 'Expected public.boards.id to be text, found %', coalesce(v_board_id_type, 'missing');
  end if;
  if v_owner_uid_type is distinct from 'text' then
    raise exception 'Expected public.boards.owner_uid to be text, found %', coalesce(v_owner_uid_type, 'missing');
  end if;
end
$$;

-- The legacy profile table used full_name. The hardened client uses display_name.
alter table public.profiles add column if not exists display_name text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'full_name'
  ) then
    execute $sql$
      update public.profiles
      set display_name = coalesce(nullif(trim(display_name), ''), nullif(trim(full_name), ''), 'User')
      where display_name is null or trim(display_name) = ''
    $sql$;
  else
    update public.profiles
    set display_name = coalesce(nullif(trim(display_name), ''), 'User')
    where display_name is null or trim(display_name) = '';
  end if;
end
$$;

-- Administrative authorization is stored outside the exposed public schema.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on table private.admin_users from public, anon, authenticated;

-- Harden the auth trigger inherited from the initial migration. User metadata is
-- copied only into display fields and is never used for authorization.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do update
  set display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      updated_at = clock_timestamp();
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- Do not automatically trust the legacy public.profiles.is_admin column: old
-- clients were able to update profile rows. Configure administrators explicitly
-- in private.admin_users after reviewing the intended account email.

-- Relational board memberships replace user-id arrays for authorization.
create table if not exists public.board_members (
  board_id text not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  primary key (board_id, user_id)
);

create index if not exists board_members_user_board_idx
  on public.board_members(user_id, board_id);
create index if not exists board_members_board_idx
  on public.board_members(board_id);
create index if not exists board_members_expiry_idx
  on public.board_members(expires_at)
  where expires_at is not null;

-- Share links store only a hash. The raw token is returned once by the RPC.
create table if not exists public.board_share_links (
  id uuid primary key default gen_random_uuid(),
  board_id text not null references public.boards(id) on delete cascade,
  token_hash text not null unique,
  role text not null check (role in ('viewer', 'editor')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_redeemed_at timestamptz,
  redemption_count integer not null default 0 check (redemption_count >= 0)
);

create index if not exists board_share_links_board_idx
  on public.board_share_links(board_id, created_at desc);
create index if not exists board_share_links_active_idx
  on public.board_share_links(board_id, expires_at)
  where revoked_at is null;

alter table public.board_members enable row level security;
alter table public.board_share_links enable row level security;

-- Convert explicit legacy collaborators to memberships before authorization changes.
insert into public.board_members (board_id, user_id, role, created_by)
select b.id, member_user.id, 'editor', owner_user.id
from public.boards b
cross join lateral unnest(coalesce(b.editor_uids, '{}'::text[])) as u(user_id)
join auth.users member_user on member_user.id::text = u.user_id
left join auth.users owner_user on owner_user.id::text = b.owner_uid
where nullif(trim(u.user_id), '') is not null
  and u.user_id is distinct from b.owner_uid
on conflict (board_id, user_id) do update
set role = 'editor', expires_at = null;

insert into public.board_members (board_id, user_id, role, created_by)
select b.id, member_user.id, 'viewer', owner_user.id
from public.boards b
cross join lateral unnest(coalesce(b.viewer_uids, '{}'::text[])) as u(user_id)
join auth.users member_user on member_user.id::text = u.user_id
left join auth.users owner_user on owner_user.id::text = b.owner_uid
where nullif(trim(u.user_id), '') is not null
  and u.user_id is distinct from b.owner_uid
on conflict (board_id, user_id) do nothing;

-- Legacy link/public modes were not secret enough for a personal tutoring app.
-- Disable them; owners can create explicit secure viewer/editor links.
update public.boards
set access_mode = 'shared',
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint,
    data = data || jsonb_build_object(
      'accessMode', 'shared',
      'legacyLinkDisabled', true,
      'legacyLinkDisabledAt', (extract(epoch from clock_timestamp()) * 1000)::bigint
    )
where access_mode in ('link-view', 'link-edit', 'public');

-- Empty legacy arrays after migration so application code cannot mistake them for ACLs.
update public.boards
set editor_uids = '{}'::text[],
    viewer_uids = '{}'::text[],
    data = data - 'editorUids' - 'viewerUids'
where cardinality(editor_uids) > 0 or cardinality(viewer_uids) > 0;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.admin_users a
    where a.user_id = (select auth.uid())
  )
$$;

create or replace function public.current_user_is_anonymous()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
$$;

create or replace function public.effective_board_permission(p_board_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_board public.boards;
  v_role text;
begin
  if v_uid is null then
    return 'none';
  end if;

  select b.* into v_board
  from public.boards b
  where b.id = p_board_id;

  if not found then
    return 'none';
  end if;

  if public.is_admin() then
    return 'admin';
  end if;

  if v_board.owner_uid = v_uid::text then
    return 'owner';
  end if;

  select m.role into v_role
  from public.board_members m
  where m.board_id = p_board_id
    and m.user_id = v_uid
    and (m.expires_at is null or m.expires_at > clock_timestamp())
  limit 1;

  if v_role in ('viewer', 'editor') then
    return v_role;
  end if;

  return 'none';
end;
$$;

create or replace function public.can_manage_board(p_board_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.effective_board_permission(p_board_id) in ('admin', 'owner')
$$;

create or replace function public.can_read_board(p_board_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.effective_board_permission(p_board_id) in ('admin', 'owner', 'editor', 'viewer')
$$;

create or replace function public.can_write_board(p_board_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case public.effective_board_permission(p_board_id)
    when 'admin' then true
    when 'owner' then true
    when 'editor' then coalesce((select b.students_can_write from public.boards b where b.id = p_board_id), false)
    else false
  end
$$;

create or replace function public.get_board_access(p_board_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permission text;
  v_board public.boards;
begin
  v_permission := public.effective_board_permission(p_board_id);
  if v_permission = 'none' then
    raise exception 'Board not found or access denied' using errcode = '42501';
  end if;

  select b.* into v_board from public.boards b where b.id = p_board_id;
  if not found then
    raise exception 'Board not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'boardId', v_board.id,
    'name', v_board.name,
    'permission', v_permission,
    'canRead', true,
    'canWrite', public.can_write_board(p_board_id),
    'canManage', v_permission in ('admin', 'owner'),
    'ownerUid', v_board.owner_uid,
    'accessMode', v_board.access_mode,
    'studentsCanWrite', v_board.students_can_write
  );
end;
$$;

-- Lightweight dashboard result. Keep the old signature so existing callers continue to work.
drop function if exists public.list_my_boards(integer, integer);
create function public.list_my_boards(
  p_limit integer default 13,
  p_offset integer default 0
)
returns table (
  id text,
  name text,
  description text,
  created_at bigint,
  updated_at bigint,
  created_by text,
  owner_uid text,
  access_mode text,
  status text,
  student_id text,
  student_name text,
  students_can_write boolean,
  schema_version integer,
  shard_layout_version integer,
  shard_count integer,
  current_revision bigint,
  total_elements integer,
  effective_permission text,
  legacy_link_disabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id,
    b.name,
    b.description,
    b.created_at,
    b.updated_at,
    b.created_by,
    b.owner_uid,
    b.access_mode,
    b.status,
    b.student_id,
    b.student_name,
    b.students_can_write,
    b.schema_version,
    b.shard_layout_version,
    b.shard_count,
    b.current_revision::bigint,
    b.total_elements,
    public.effective_board_permission(b.id),
    coalesce((b.data ->> 'legacyLinkDisabled')::boolean, false)
  from public.boards b
  where b.status = 'ready'
    and public.can_read_board(b.id)
  order by b.created_at desc, b.id desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0)
$$;

create or replace function public.list_my_boards_page(
  p_limit integer default 13,
  p_before_created_at bigint default null,
  p_before_id text default null
)
returns table (
  id text,
  name text,
  description text,
  created_at bigint,
  updated_at bigint,
  created_by text,
  owner_uid text,
  access_mode text,
  status text,
  student_id text,
  student_name text,
  students_can_write boolean,
  schema_version integer,
  shard_layout_version integer,
  shard_count integer,
  current_revision bigint,
  total_elements integer,
  effective_permission text,
  legacy_link_disabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id, b.name, b.description, b.created_at, b.updated_at, b.created_by,
    b.owner_uid, b.access_mode, b.status, b.student_id, b.student_name,
    b.students_can_write, b.schema_version, b.shard_layout_version,
    b.shard_count, b.current_revision::bigint, b.total_elements,
    public.effective_board_permission(b.id),
    coalesce((b.data ->> 'legacyLinkDisabled')::boolean, false)
  from public.boards b
  where b.status = 'ready'
    and public.can_read_board(b.id)
    and (
      p_before_created_at is null
      or p_before_id is null
      or (b.created_at, b.id) < (p_before_created_at, p_before_id)
    )
  order by b.created_at desc, b.id desc
  limit least(greatest(p_limit, 1), 100)
$$;

create or replace function public.get_board_state(p_board_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_board jsonb;
  v_shards jsonb;
  v_permission text;
begin
  v_permission := public.effective_board_permission(p_board_id);
  if v_permission = 'none' then
    raise exception 'Board not found or access denied' using errcode = '42501';
  end if;

  select to_jsonb(b) || jsonb_build_object(
      'effective_permission', v_permission,
      'effective_can_write', public.can_write_board(p_board_id),
      'effective_can_manage', v_permission in ('admin', 'owner')
    )
    into v_board
  from public.boards b
  where b.id = p_board_id;

  if v_board is null then
    raise exception 'Board not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.shard_id), '[]'::jsonb)
    into v_shards
  from public.board_shards s
  where s.board_id = p_board_id;

  return jsonb_build_object('board', v_board, 'shards', v_shards);
end;
$$;

-- Owners create boards through this RPC. Anonymous share-link users cannot create boards.
create or replace function public.create_board(
  p_board_id text,
  p_name text,
  p_description text default '',
  p_created_by text default 'User',
  p_student_id text default '',
  p_student_name text default '',
  p_students_can_write boolean default true,
  p_status text default 'ready'
)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_row public.boards;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if public.current_user_is_anonymous() then
    raise exception 'Anonymous users cannot create boards' using errcode = '42501';
  end if;
  if p_board_id is not null and p_board_id !~ '^[A-Za-z0-9_.:-]{1,160}$' then
    raise exception 'Invalid board id';
  end if;
  if p_status not in ('initializing', 'ready') then
    raise exception 'Invalid board status';
  end if;
  if length(trim(coalesce(p_name, ''))) < 1 or length(p_name) > 160 then
    raise exception 'Board name must contain 1 to 160 characters';
  end if;
  if length(coalesce(p_description, '')) > 2000 then
    raise exception 'Board description is too long';
  end if;

  insert into public.boards (
    id, name, description, created_at, updated_at, created_by, owner_uid,
    access_mode, editor_uids, viewer_uids, status, student_id, student_name,
    students_can_write, schema_version, shard_layout_version, shard_count,
    current_revision, changed_shard_ids, deleted_shard_ids, total_elements, data
  ) values (
    coalesce(p_board_id, gen_random_uuid()::text),
    trim(p_name),
    left(coalesce(p_description, ''), 2000),
    v_now,
    v_now,
    left(coalesce(nullif(trim(p_created_by), ''), 'User'), 120),
    v_uid::text,
    'private',
    '{}'::text[],
    '{}'::text[],
    p_status,
    left(coalesce(p_student_id, ''), 160),
    left(coalesce(p_student_name, ''), 160),
    coalesce(p_students_can_write, true),
    4, 3, 16, 0, '{}'::text[], '{}'::text[], 0,
    jsonb_build_object(
      'name', trim(p_name),
      'description', left(coalesce(p_description, ''), 2000),
      'createdAt', v_now,
      'updatedAt', v_now,
      'createdBy', left(coalesce(nullif(trim(p_created_by), ''), 'User'), 120),
      'ownerUid', v_uid,
      'accessMode', 'private',
      'status', p_status,
      'studentId', left(coalesce(p_student_id, ''), 160),
      'studentName', left(coalesce(p_student_name, ''), 160),
      'studentsCanWrite', coalesce(p_students_can_write, true),
      'schemaVersion', 4,
      'shardLayoutVersion', 3,
      'shardCount', 16,
      'currentRevision', 0,
      'totalElements', 0
    )
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Board metadata changes are allowlisted; internal manifest fields are rejected.
create or replace function public.patch_board(p_board_id text, p_patch jsonb)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.boards;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_key text;
  v_access_mode text;
begin
  if jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Board patch must be a JSON object';
  end if;
  if not public.can_manage_board(p_board_id) then
    raise exception 'Not authorized to manage this board' using errcode = '42501';
  end if;

  for v_key in select jsonb_object_keys(p_patch)
  loop
    if v_key not in (
      'name', 'description', 'studentId', 'studentName',
      'studentsCanWrite', 'accessMode', 'status', 'updatedAt'
    ) then
      raise exception 'Unsupported board patch field: %', v_key;
    end if;
  end loop;

  if p_patch ? 'name' and (
    length(trim(coalesce(p_patch ->> 'name', ''))) < 1 or
    length(p_patch ->> 'name') > 160
  ) then
    raise exception 'Board name must contain 1 to 160 characters';
  end if;
  if p_patch ? 'description' and length(coalesce(p_patch ->> 'description', '')) > 2000 then
    raise exception 'Board description is too long';
  end if;
  if p_patch ? 'accessMode' then
    v_access_mode := p_patch ->> 'accessMode';
    if v_access_mode not in ('private', 'shared') then
      raise exception 'Invalid access mode';
    end if;
  end if;
  if p_patch ? 'status' and (p_patch ->> 'status') not in ('initializing', 'ready') then
    raise exception 'Invalid board status';
  end if;

  update public.boards b
  set
    name = case when p_patch ? 'name' then trim(p_patch ->> 'name') else b.name end,
    description = case when p_patch ? 'description' then coalesce(p_patch ->> 'description', '') else b.description end,
    student_id = case when p_patch ? 'studentId' then left(coalesce(p_patch ->> 'studentId', ''), 160) else b.student_id end,
    student_name = case when p_patch ? 'studentName' then left(coalesce(p_patch ->> 'studentName', ''), 160) else b.student_name end,
    students_can_write = case when p_patch ? 'studentsCanWrite' then (p_patch ->> 'studentsCanWrite')::boolean else b.students_can_write end,
    access_mode = case when p_patch ? 'accessMode' then v_access_mode else b.access_mode end,
    status = case when p_patch ? 'status' then p_patch ->> 'status' else b.status end,
    updated_at = v_now,
    data = b.data || jsonb_strip_nulls(jsonb_build_object(
      'name', case when p_patch ? 'name' then trim(p_patch ->> 'name') else null end,
      'description', case when p_patch ? 'description' then coalesce(p_patch ->> 'description', '') else null end,
      'studentId', case when p_patch ? 'studentId' then left(coalesce(p_patch ->> 'studentId', ''), 160) else null end,
      'studentName', case when p_patch ? 'studentName' then left(coalesce(p_patch ->> 'studentName', ''), 160) else null end,
      'studentsCanWrite', case when p_patch ? 'studentsCanWrite' then (p_patch ->> 'studentsCanWrite')::boolean else null end,
      'accessMode', case when p_patch ? 'accessMode' then v_access_mode else null end,
      'status', case when p_patch ? 'status' then p_patch ->> 'status' else null end,
      'updatedAt', v_now
    ))
  where b.id = p_board_id
  returning b.* into v_row;

  if not found then
    raise exception 'Board not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

create or replace function public.finalize_board_initialization(p_board_id text)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.boards;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not public.can_manage_board(p_board_id) then
    raise exception 'Not authorized to finalize this board' using errcode = '42501';
  end if;

  update public.boards b
  set status = 'ready',
      updated_at = v_now,
      data = b.data || jsonb_build_object('status', 'ready', 'updatedAt', v_now)
  where b.id = p_board_id
  returning b.* into v_row;

  if not found then raise exception 'Board not found'; end if;
  return v_row;
end;
$$;

-- Secure share-link management.
create or replace function public.create_board_share_link(
  p_board_id text,
  p_role text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_link public.board_share_links;
begin
  if not public.can_manage_board(p_board_id) then
    raise exception 'Not authorized to share this board' using errcode = '42501';
  end if;
  if p_role not in ('viewer', 'editor') then
    raise exception 'Share role must be viewer or editor';
  end if;
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then
    raise exception 'Share-link expiry must be in the future';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.board_share_links (
    board_id, token_hash, role, created_by, expires_at
  ) values (
    p_board_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_role,
    (select auth.uid()),
    p_expires_at
  ) returning * into v_link;

  update public.boards b
  set access_mode = 'shared',
      updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint,
      data = b.data || jsonb_build_object('accessMode', 'shared', 'legacyLinkDisabled', false)
  where b.id = p_board_id;

  return jsonb_build_object(
    'id', v_link.id,
    'boardId', v_link.board_id,
    'role', v_link.role,
    'expiresAt', v_link.expires_at,
    'rawToken', v_token
  );
end;
$$;

create or replace function public.redeem_board_share_link(p_raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_link public.board_share_links;
  v_board public.boards;
  v_existing_role text;
  v_existing_expires timestamptz;
  v_effective_role text;
  v_effective_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_raw_token is null or length(p_raw_token) < 32 or length(p_raw_token) > 256 then
    raise exception 'Invalid or expired share link' using errcode = '42501';
  end if;

  select l.* into v_link
  from public.board_share_links l
  where l.token_hash = encode(extensions.digest(p_raw_token, 'sha256'), 'hex')
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > clock_timestamp())
  for update;

  if not found then
    raise exception 'Invalid or expired share link' using errcode = '42501';
  end if;

  select b.* into v_board from public.boards b where b.id = v_link.board_id;
  if not found then raise exception 'Board not found'; end if;

  if v_board.owner_uid <> v_uid::text and not public.is_admin() then
    -- Ignore expired grants. A stale editor grant must never turn a newly
    -- redeemed viewer link into permanent editor access.
    select m.role, m.expires_at
      into v_existing_role, v_existing_expires
    from public.board_members m
    where m.board_id = v_link.board_id
      and m.user_id = v_uid
      and (m.expires_at is null or m.expires_at > clock_timestamp());

    if v_link.role = 'editor' then
      v_effective_role := 'editor';
      if v_existing_role = 'editor' then
        v_effective_expires := case
          when v_existing_expires is null or v_link.expires_at is null then null
          else greatest(v_existing_expires, v_link.expires_at)
        end;
      else
        v_effective_expires := v_link.expires_at;
      end if;
    elsif v_existing_role = 'editor' then
      -- A viewer link cannot extend the lifetime of an editor grant.
      v_effective_role := 'editor';
      v_effective_expires := v_existing_expires;
    else
      v_effective_role := 'viewer';
      v_effective_expires := case
        when v_existing_role = 'viewer' and (v_existing_expires is null or v_link.expires_at is null) then null
        when v_existing_role = 'viewer' then greatest(v_existing_expires, v_link.expires_at)
        else v_link.expires_at
      end;
    end if;

    insert into public.board_members (board_id, user_id, role, expires_at, created_by)
    values (v_link.board_id, v_uid, v_effective_role, v_effective_expires, v_link.created_by)
    on conflict (board_id, user_id) do update
    set role = excluded.role,
        expires_at = excluded.expires_at,
        created_by = excluded.created_by;
  end if;

  update public.board_share_links
  set last_redeemed_at = clock_timestamp(),
      redemption_count = redemption_count + 1
  where id = v_link.id;

  return jsonb_build_object(
    'boardId', v_link.board_id,
    'name', v_board.name,
    'permission', public.effective_board_permission(v_link.board_id)
  );
end;
$$;

create or replace function public.list_board_share_links(p_board_id text)
returns table (
  id uuid,
  role text,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_redeemed_at timestamptz,
  redemption_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.role, l.created_at, l.expires_at, l.revoked_at,
         l.last_redeemed_at, l.redemption_count
  from public.board_share_links l
  where l.board_id = p_board_id
    and public.can_manage_board(p_board_id)
  order by l.created_at desc
$$;

create or replace function public.revoke_board_share_link(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id text;
begin
  select l.board_id into v_board_id
  from public.board_share_links l
  where l.id = p_link_id;

  if v_board_id is null or not public.can_manage_board(v_board_id) then
    raise exception 'Not authorized to revoke this link' using errcode = '42501';
  end if;

  update public.board_share_links
  set revoked_at = coalesce(revoked_at, clock_timestamp())
  where id = p_link_id;

  return found;
end;
$$;

-- Owners can inspect and remove redeemed memberships. Revoking a link blocks
-- future redemption; removing a membership revokes an already-redeemed user.
create or replace function public.list_board_members(p_board_id text)
returns table (
  user_id uuid,
  role text,
  created_at timestamptz,
  expires_at timestamptz,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_board(p_board_id) then
    raise exception 'Not authorized to list board members' using errcode = '42501';
  end if;

  return query
  select m.user_id, m.role, m.created_at, m.expires_at,
         coalesce(nullif(trim(p.display_name), ''), 'Guest user')
  from public.board_members m
  left join public.profiles p on p.id = m.user_id
  where m.board_id = p_board_id
  order by m.created_at desc;
end;
$$;

create or replace function public.remove_board_member(p_board_id text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_board(p_board_id) then
    raise exception 'Not authorized to remove board members' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id::text = (select b.owner_uid from public.boards b where b.id = p_board_id) then
    raise exception 'The board owner cannot be removed';
  end if;

  delete from public.board_members m
  where m.board_id = p_board_id and m.user_id = p_user_id;
  return found;
end;
$$;

-- Match the client's ASCII FNV-1a element sharding. Element IDs are limited
-- to ASCII by validation, so PostgreSQL ascii() matches JavaScript charCodeAt().
create or replace function public.element_shard_id(p_element_id text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hash bigint := 2166136261;
  v_index integer;
begin
  if coalesce(p_element_id, '') !~ '^[A-Za-z0-9_.:-]{1,160}$' then
    return null;
  end if;

  for v_index in 1..length(p_element_id)
  loop
    v_hash := ((v_hash # ascii(substr(p_element_id, v_index, 1))) * 16777619) % 4294967296;
  end loop;

  return 'shard_' || (v_hash % 16)::text;
end;
$$;

-- Stronger server-side mutation validation while retaining sharded checkpoints.
create or replace function public.apply_board_mutations(p_board_id text, p_mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.boards;
  v_mut jsonb;
  v_shard_id text;
  v_element_id text;
  v_action text;
  v_payload jsonb;
  v_type text;
  v_elements jsonb;
  v_tombstones jsonb;
  v_server jsonb;
  v_tombstone jsonb;
  v_server_updated bigint;
  v_tombstone_updated bigint;
  v_local_updated bigint;
  v_client_updated bigint;
  v_server_client text;
  v_tombstone_client text;
  v_local_client text;
  v_local_wins boolean;
  v_before integer;
  v_after integer;
  v_total_delta integer := 0;
  v_applied integer := 0;
  v_rejected integer := 0;
  v_shard_applied integer;
  v_next_revision bigint;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_cutoff bigint := ((extract(epoch from clock_timestamp()) * 1000)::bigint - 604800000);
  v_changed text[] := '{}';
  v_deleted text[] := '{}';
  v_return_shards jsonb := '{}'::jsonb;
  v_actor text := coalesce((select auth.uid())::text, 'unknown');
  v_key text;
begin
  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'p_mutations must be a JSON array';
  end if;
  if jsonb_array_length(p_mutations) > 500 then
    raise exception 'A checkpoint may contain at most 500 element mutations';
  end if;
  if pg_column_size(p_mutations) > 8 * 1024 * 1024 then
    raise exception 'Mutation checkpoint is too large';
  end if;
  if not public.can_write_board(p_board_id) then
    raise exception 'Not authorized to write this board' using errcode = '42501';
  end if;

  select * into v_board
  from public.boards
  where id = p_board_id
  for update;
  if not found then raise exception 'Board not found'; end if;

  v_next_revision := v_board.current_revision + 1;

  -- Validate every record before changing any shard.
  for v_mut in select value from jsonb_array_elements(p_mutations)
  loop
    if jsonb_typeof(v_mut) <> 'object' then
      raise exception 'Every mutation must be an object';
    end if;
    for v_key in select jsonb_object_keys(v_mut)
    loop
      if v_key not in ('elementId', 'shardId', 'action', 'data', 'updatedAt', 'updatedByClientId') then
        raise exception 'Unsupported mutation field: %', v_key;
      end if;
    end loop;

    v_element_id := v_mut ->> 'elementId';
    v_shard_id := v_mut ->> 'shardId';
    v_action := coalesce(v_mut ->> 'action', 'set');

    if coalesce(v_element_id, '') !~ '^[A-Za-z0-9_.:-]{1,160}$' then
      raise exception 'Invalid element id';
    end if;
    if coalesce(v_shard_id, '') !~ '^shard_([0-9]|1[0-5])$'
       or v_shard_id is distinct from public.element_shard_id(v_element_id) then
      raise exception 'Invalid shard id';
    end if;
    if jsonb_typeof(v_mut -> 'action') <> 'string' or v_action not in ('set', 'delete') then
      raise exception 'Invalid mutation action';
    end if;
    if v_mut ? 'updatedAt' and (
      jsonb_typeof(v_mut -> 'updatedAt') <> 'number'
      or coalesce(v_mut ->> 'updatedAt', '') !~ '^[0-9]{1,16}$'
    ) then
      raise exception 'Invalid client timestamp';
    end if;
    if v_mut ? 'updatedByClientId' and jsonb_typeof(v_mut -> 'updatedByClientId') <> 'string' then
      raise exception 'Invalid client id';
    end if;
    if length(coalesce(v_mut ->> 'updatedByClientId', '')) > 128 then
      raise exception 'Client id is too long';
    end if;

    if v_action = 'set' then
      v_payload := v_mut -> 'data';
      if jsonb_typeof(v_payload) <> 'object' then
        raise exception 'Set mutations require an object payload';
      end if;
      if pg_column_size(v_payload) > 1024 * 1024 then
        raise exception 'An element may not exceed 1 MB';
      end if;
      if v_payload ->> 'id' is distinct from v_element_id then
        raise exception 'Element payload id must equal elementId';
      end if;
      if v_payload::text ~ '"(__proto__|prototype|constructor)"[[:space:]]*:' then
        raise exception 'Element contains a forbidden property';
      end if;
      foreach v_key in array array['x', 'y', 'width', 'height', 'zIndex', 'fontSize', 'duration', 'strokeWidth']
      loop
        if v_payload ? v_key and (
          jsonb_typeof(v_payload -> v_key) <> 'number'
          or abs((v_payload ->> v_key)::numeric) > 10000000
        ) then
          raise exception 'Invalid numeric element field: %', v_key;
        end if;
      end loop;
      v_type := v_payload ->> 'type';
      if v_type not in ('sticky', 'shape', 'text', 'drawing', 'image', 'connector', 'audio', 'stamp', 'math', 'table') then
        raise exception 'Unsupported element type';
      end if;
      if length(coalesce(v_payload ->> 'text', '')) > 100000 then
        raise exception 'Element text is too long';
      end if;
      if v_type = 'drawing' then
        if jsonb_typeof(v_payload -> 'points') <> 'array' then
          raise exception 'Drawing points must be an array';
        end if;
        if jsonb_array_length(v_payload -> 'points') > 20000 then
          raise exception 'Drawing contains too many points';
        end if;
        if exists (
          select 1
          from jsonb_array_elements(v_payload -> 'points') as p(point)
          where jsonb_typeof(p.point) <> 'object'
             or jsonb_typeof(p.point -> 'x') <> 'number'
             or jsonb_typeof(p.point -> 'y') <> 'number'
             or abs((p.point ->> 'x')::numeric) > 10000000
             or abs((p.point ->> 'y')::numeric) > 10000000
        ) then
          raise exception 'Drawing contains invalid points';
        end if;
        if jsonb_typeof(v_payload -> 'width') <> 'number'
           or (v_payload ->> 'width')::numeric <= 0
           or (v_payload ->> 'width')::numeric > 200 then
          raise exception 'Drawing width is invalid';
        end if;
      end if;
      if v_type = 'table' then
        if jsonb_typeof(v_payload -> 'rows') <> 'number'
           or jsonb_typeof(v_payload -> 'cols') <> 'number'
           or (v_payload ->> 'rows')::numeric not between 1 and 200
           or (v_payload ->> 'cols')::numeric not between 1 and 200
           or (v_payload ->> 'rows')::numeric <> trunc((v_payload ->> 'rows')::numeric)
           or (v_payload ->> 'cols')::numeric <> trunc((v_payload ->> 'cols')::numeric) then
          raise exception 'Table dimensions are invalid';
        end if;
        if jsonb_typeof(v_payload -> 'data') <> 'array'
           or jsonb_array_length(v_payload -> 'data') > 200 then
          raise exception 'Table data is invalid';
        end if;
        if exists (
          select 1
          from jsonb_array_elements(v_payload -> 'data') as r(row_data)
          where jsonb_typeof(r.row_data) <> 'array'
             or jsonb_array_length(r.row_data) > 200
        ) then
          raise exception 'Table contains an invalid row';
        end if;
      end if;
      if length(coalesce(v_payload ->> 'src', '')) > 100000
         or length(coalesce(v_payload ->> 'audioUrl', '')) > 100000
         or length(coalesce(v_payload ->> 'signatureDataUrl', '')) > 100000 then
        raise exception 'Large inline media must use Storage';
      end if;
    end if;
  end loop;

  for v_shard_id in
    select distinct value ->> 'shardId'
    from jsonb_array_elements(p_mutations)
  loop
    v_shard_applied := 0;

    select s.elements, s.tombstones
      into v_elements, v_tombstones
    from public.board_shards s
    where s.board_id = p_board_id and s.shard_id = v_shard_id
    for update;

    if not found then
      v_elements := '{}'::jsonb;
      v_tombstones := '{}'::jsonb;
    end if;
    select count(*)::integer into v_before from jsonb_object_keys(v_elements);

    for v_mut in
      select value from jsonb_array_elements(p_mutations)
      where value ->> 'shardId' = v_shard_id
    loop
      v_element_id := v_mut ->> 'elementId';
      v_action := coalesce(v_mut ->> 'action', 'set');
      v_client_updated := coalesce(nullif(v_mut ->> 'updatedAt', '')::bigint, v_now);
      -- Bound client clocks. A forged far-future timestamp can no longer win forever.
      v_local_updated := least(v_now + 5000, greatest(v_now - 300000, v_client_updated));
      v_local_client := v_actor || ':' || left(coalesce(v_mut ->> 'updatedByClientId', ''), 96);
      v_server := v_elements -> v_element_id;
      v_tombstone := v_tombstones -> v_element_id;
      v_server_updated := coalesce(nullif(v_server ->> 'updatedAt', '')::bigint, 0);
      v_server_client := coalesce(v_server ->> 'updatedByClientId', '');
      v_tombstone_updated := coalesce(nullif(v_tombstone ->> 'updatedAt', '')::bigint, 0);
      v_tombstone_client := coalesce(v_tombstone ->> 'updatedByClientId', '');
      v_local_wins := true;

      if v_tombstone is not null and (
        v_local_updated < v_tombstone_updated or
        (v_local_updated = v_tombstone_updated and v_local_client <= v_tombstone_client)
      ) then v_local_wins := false; end if;

      if v_server is not null and (
        v_local_updated < v_server_updated or
        (v_local_updated = v_server_updated and v_local_client <= v_server_client)
      ) then v_local_wins := false; end if;

      if v_local_wins then
        v_applied := v_applied + 1;
        v_shard_applied := v_shard_applied + 1;
        if v_action = 'delete' then
          v_elements := v_elements - v_element_id;
          v_tombstones := jsonb_set(
            v_tombstones, array[v_element_id],
            jsonb_build_object('updatedAt', v_local_updated, 'updatedByClientId', v_local_client), true
          );
        else
          v_payload := v_mut -> 'data';
          v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_element_id), true);
          v_payload := jsonb_set(v_payload, '{updatedAt}', to_jsonb(v_local_updated), true);
          v_payload := jsonb_set(v_payload, '{updatedByClientId}', to_jsonb(v_local_client), true);
          v_elements := jsonb_set(v_elements, array[v_element_id], v_payload, true);
          v_tombstones := v_tombstones - v_element_id;
        end if;
      else
        v_rejected := v_rejected + 1;
      end if;
    end loop;

    v_return_shards := jsonb_set(v_return_shards, array[v_shard_id], v_elements, true);

    if v_shard_applied > 0 then
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        into v_tombstones
      from jsonb_each(v_tombstones)
      where coalesce(nullif(value ->> 'updatedAt', '')::bigint, 0) >= v_cutoff;

      select count(*)::integer into v_after from jsonb_object_keys(v_elements);
      v_total_delta := v_total_delta + (v_after - v_before);
      v_changed := array_append(v_changed, v_shard_id);

      if v_after = 0 and not exists (select 1 from jsonb_object_keys(v_tombstones)) then
        delete from public.board_shards
        where board_id = p_board_id and shard_id = v_shard_id;
        v_deleted := array_append(v_deleted, v_shard_id);
      else
        insert into public.board_shards (
          board_id, shard_id, revision, elements, tombstones, updated_at
        ) values (
          p_board_id, v_shard_id, v_next_revision, v_elements, v_tombstones, v_now
        )
        on conflict (board_id, shard_id) do update
        set revision = excluded.revision,
            elements = excluded.elements,
            tombstones = excluded.tombstones,
            updated_at = excluded.updated_at;
      end if;
    end if;
  end loop;

  if v_applied > 0 then
    update public.boards b
    set current_revision = v_next_revision,
        changed_shard_ids = v_changed,
        deleted_shard_ids = v_deleted,
        total_elements = greatest(0, b.total_elements + v_total_delta),
        updated_at = v_now,
        schema_version = 4,
        shard_layout_version = 3,
        shard_count = 16,
        data = b.data || jsonb_build_object(
          'currentRevision', v_next_revision,
          'changedShardIds', to_jsonb(v_changed),
          'deletedShardIds', to_jsonb(v_deleted),
          'totalElements', greatest(0, b.total_elements + v_total_delta),
          'updatedAt', v_now,
          'schemaVersion', 4,
          'shardLayoutVersion', 3,
          'shardCount', 16
        )
    where b.id = p_board_id;
  else
    v_next_revision := v_board.current_revision;
  end if;

  return jsonb_build_object(
    'revision', v_next_revision,
    'changedShardIds', to_jsonb(v_changed),
    'deletedShardIds', to_jsonb(v_deleted),
    'totalElements', greatest(0, v_board.total_elements + v_total_delta),
    'applied', v_applied,
    'rejected', v_rejected,
    'shards', v_return_shards
  );
end;
$$;

-- RLS and least-privilege grants.
-- Remove both the old permissive policies from the in-app setup script and any
-- policies left by an earlier UUID-oriented migration attempt.
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_shards enable row level security;
alter table public.board_assets enable row level security;
alter table public.presence enable row level security;
alter table public.admin_settings enable row level security;
alter table public.board_members enable row level security;
alter table public.board_share_links enable row level security;

drop policy if exists "Allow all operations for public.profiles" on public.profiles;
drop policy if exists "Allow all operations for public.boards" on public.boards;
drop policy if exists "Allow all operations for public.board_shards" on public.board_shards;
drop policy if exists "Allow all operations for public.board_assets" on public.board_assets;
drop policy if exists "Allow all operations for public.presence" on public.presence;
drop policy if exists "Allow all operations for public.admin_settings" on public.admin_settings;

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists boards_select on public.boards;
drop policy if exists boards_insert on public.boards;
drop policy if exists boards_update on public.boards;
drop policy if exists boards_delete on public.boards;
drop policy if exists board_shards_select on public.board_shards;
drop policy if exists board_shards_write on public.board_shards;
drop policy if exists board_assets_select on public.board_assets;
drop policy if exists board_assets_insert on public.board_assets;
drop policy if exists board_assets_update on public.board_assets;
drop policy if exists board_assets_delete on public.board_assets;
drop policy if exists presence_select on public.presence;
drop policy if exists presence_write_self on public.presence;
drop policy if exists presence_update_self on public.presence;
drop policy if exists presence_delete on public.presence;
drop policy if exists admin_settings_select on public.admin_settings;
drop policy if exists admin_settings_write on public.admin_settings;
drop policy if exists board_members_select on public.board_members;
drop policy if exists board_share_links_no_direct_access on public.board_share_links;

-- Remove incompatible UUID overloads that can make PostgREST RPC resolution
-- ambiguous on this text-ID database. CASCADE only removes dependencies on those
-- obsolete overloads; all intended text-ID functions and policies are recreated.
drop function if exists public.effective_board_permission(uuid) cascade;
drop function if exists public.can_manage_board(uuid) cascade;
drop function if exists public.can_read_board(uuid) cascade;
drop function if exists public.can_write_board(uuid) cascade;
drop function if exists public.get_board_access(uuid) cascade;
drop function if exists public.list_my_boards_page(integer, bigint, uuid) cascade;
drop function if exists public.get_board_state(uuid) cascade;
drop function if exists public.create_board(uuid, text, text, text, text, text, boolean, text) cascade;
drop function if exists public.patch_board(uuid, jsonb) cascade;
drop function if exists public.finalize_board_initialization(uuid) cascade;
drop function if exists public.create_board_share_link(uuid, text, timestamptz) cascade;
drop function if exists public.list_board_share_links(uuid) cascade;
drop function if exists public.list_board_members(uuid) cascade;
drop function if exists public.remove_board_member(uuid, uuid) cascade;
drop function if exists public.apply_board_mutations(uuid, jsonb) cascade;
drop function if exists public.board_asset_quota_available(uuid, bigint) cascade;

-- Storage helper functions must return text because board IDs are text.
drop policy if exists board_assets_storage_select on storage.objects;
drop policy if exists board_assets_storage_insert on storage.objects;
drop policy if exists board_assets_storage_update on storage.objects;
drop policy if exists board_assets_storage_delete on storage.objects;
drop function if exists public.storage_board_quota_available(text, bigint) cascade;
drop function if exists public.storage_asset_path_valid(text) cascade;
drop function if exists public.storage_board_id(text) cascade;

create function public.storage_board_id(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[];
begin
  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) < 2 or v_parts[1] <> 'boards' then
    return null;
  end if;
  return v_parts[2];
exception when others then
  return null;
end;
$$;

create function public.storage_asset_path_valid(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    length(coalesce(p_name, '')) between 1 and 512
    and p_name ~ '^boards/[A-Za-z0-9_.:-]{1,160}/[A-Za-z0-9_.:-]{1,160}\.(png|jpg|jpeg|webp|gif|pdf|mp3|wav|ogg|webm)$'
$$;

create function public.storage_board_quota_available(p_name text, p_new_size bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(p_new_size, 0) between 0 and 20971520
    and (
      select coalesce(sum(
        case
          when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]+$'
            then (o.metadata ->> 'size')::bigint
          else 0
        end
      ), 0)
      from storage.objects o
      where o.bucket_id = 'board-assets'
        and public.storage_board_id(o.name) = public.storage_board_id(p_name)
    ) + greatest(coalesce(p_new_size, 0), 0) <= 262144000
$$;

create or replace function public.board_asset_quota_available(
  p_board_id text,
  p_new_size bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_new_size between 1 and 20971520
    and coalesce((
      select sum(coalesce(a.original_byte_size, 0))
      from public.board_assets a
      where a.board_id = p_board_id
    ), 0) + greatest(coalesce(p_new_size, 0), 0) <= 262144000
$$;

-- Profiles expose only ordinary display information. The legacy is_admin column
-- remains for compatibility but is no longer trusted by public.is_admin().
create policy profiles_select_authenticated on public.profiles
for select to authenticated
using (true);

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Boards and shards are readable only through effective membership. Board
-- creation and metadata mutation use RPCs; direct board deletion remains owner/admin only.
create policy boards_select on public.boards
for select to authenticated
using (public.can_read_board(id));

create policy boards_delete on public.boards
for delete to authenticated
using (public.can_manage_board(id));

create policy board_shards_select on public.board_shards
for select to authenticated
using (public.can_read_board(board_id));

create policy board_assets_select on public.board_assets
for select to authenticated
using (public.can_read_board(board_id));

create policy board_assets_insert on public.board_assets
for insert to authenticated
with check (
  public.can_write_board(board_id)
  and public.board_asset_quota_available(board_id, original_byte_size)
);

create policy board_assets_delete on public.board_assets
for delete to authenticated
using (public.can_manage_board(board_id));

-- Presence rows are self-written. Owners/admins can inspect collaborators, and
-- users may see peers only when both are associated with a board they can read.
create policy presence_select on public.presence
for select to authenticated
using (
  public.is_admin()
  or id = (select auth.uid())::text
  or (current_board_id is not null and public.can_read_board(current_board_id))
);

create policy presence_write_self on public.presence
for insert to authenticated
with check (id = (select auth.uid())::text);

create policy presence_update_self on public.presence
for update to authenticated
using (id = (select auth.uid())::text)
with check (id = (select auth.uid())::text);

create policy presence_delete on public.presence
for delete to authenticated
using (public.is_admin() or id = (select auth.uid())::text);

create policy admin_settings_select on public.admin_settings
for select to authenticated
using (true);

create policy admin_settings_write on public.admin_settings
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy board_members_select on public.board_members
for select to authenticated
using (user_id = (select auth.uid()) or public.can_manage_board(board_id));

-- board_share_links intentionally has no direct policies. Owner-only RPCs are
-- the only way to create, list, redeem, or revoke links.

-- Asset metadata checks apply to new rows without rejecting old stored assets.
alter table public.board_assets
  drop constraint if exists board_assets_safe_mime_check;
alter table public.board_assets
  add constraint board_assets_safe_mime_check check (
    mime_type in (
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      'application/pdf',
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'
    )
  ) not valid;

alter table public.board_assets
  drop constraint if exists board_assets_safe_size_check;
alter table public.board_assets
  add constraint board_assets_safe_size_check check (
    encoded_byte_size between 0 and 30000000
    and (original_byte_size is null or original_byte_size between 0 and 20971520)
  ) not valid;

alter table public.board_assets
  drop constraint if exists board_assets_safe_id_check;
alter table public.board_assets
  add constraint board_assets_safe_id_check check (
    asset_id ~ '^[A-Za-z0-9_.:-]{1,160}$'
    and length(object_path) <= 512
    and public.storage_board_id(object_path) = board_id
  ) not valid;

-- Browser roles receive only the operations required by the hardened client.
revoke all on public.profiles from anon;
revoke all on public.boards from anon;
revoke all on public.board_shards from anon;
revoke all on public.board_assets from anon;
revoke all on public.presence from anon;
revoke all on public.admin_settings from anon;
revoke all on public.board_members from anon;
revoke all on public.board_share_links from anon;

revoke all on public.board_shards from authenticated;
grant select on public.board_shards to authenticated;

revoke all on public.boards from authenticated;
grant select, delete on public.boards to authenticated;

revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

revoke all on public.board_members from authenticated;
grant select on public.board_members to authenticated;
revoke all on public.board_share_links from authenticated;

revoke all on public.board_assets from authenticated;
grant select, insert, delete on public.board_assets to authenticated;

revoke all on public.presence from authenticated;
grant select, insert, update, delete on public.presence to authenticated;

revoke all on public.admin_settings from authenticated;
grant select, insert, update, delete on public.admin_settings to authenticated;

-- Restrict function execution, then expose only intentional authenticated RPCs.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.current_user_is_anonymous() from public, anon;
revoke execute on function public.effective_board_permission(text) from public, anon;
revoke execute on function public.can_manage_board(text) from public, anon;
revoke execute on function public.can_read_board(text) from public, anon;
revoke execute on function public.can_write_board(text) from public, anon;
revoke execute on function public.get_board_access(text) from public, anon;
revoke execute on function public.list_my_boards(integer, integer) from public, anon;
revoke execute on function public.list_my_boards_page(integer, bigint, text) from public, anon;
revoke execute on function public.get_board_state(text) from public, anon;
revoke execute on function public.create_board(text, text, text, text, text, text, boolean, text) from public, anon;
revoke execute on function public.patch_board(text, jsonb) from public, anon;
revoke execute on function public.finalize_board_initialization(text) from public, anon;
revoke execute on function public.create_board_share_link(text, text, timestamptz) from public, anon;
revoke execute on function public.redeem_board_share_link(text) from public, anon;
revoke execute on function public.list_board_share_links(text) from public, anon;
revoke execute on function public.revoke_board_share_link(uuid) from public, anon;
revoke execute on function public.list_board_members(text) from public, anon;
revoke execute on function public.remove_board_member(text, uuid) from public, anon;
revoke execute on function public.apply_board_mutations(text, jsonb) from public, anon;
revoke execute on function public.board_asset_quota_available(text, bigint) from public, anon;
revoke execute on function public.element_shard_id(text) from public, anon;

revoke execute on function public.is_admin() from public;
revoke execute on function public.current_user_is_anonymous() from public;
revoke execute on function public.effective_board_permission(text) from public;
revoke execute on function public.can_manage_board(text) from public;
revoke execute on function public.can_read_board(text) from public;
revoke execute on function public.can_write_board(text) from public;
revoke execute on function public.get_board_access(text) from public;
revoke execute on function public.list_my_boards(integer, integer) from public;
revoke execute on function public.list_my_boards_page(integer, bigint, text) from public;
revoke execute on function public.get_board_state(text) from public;
revoke execute on function public.create_board(text, text, text, text, text, text, boolean, text) from public;
revoke execute on function public.patch_board(text, jsonb) from public;
revoke execute on function public.finalize_board_initialization(text) from public;
revoke execute on function public.create_board_share_link(text, text, timestamptz) from public;
revoke execute on function public.redeem_board_share_link(text) from public;
revoke execute on function public.list_board_share_links(text) from public;
revoke execute on function public.revoke_board_share_link(uuid) from public;
revoke execute on function public.list_board_members(text) from public;
revoke execute on function public.remove_board_member(text, uuid) from public;
revoke execute on function public.apply_board_mutations(text, jsonb) from public;
revoke execute on function public.board_asset_quota_available(text, bigint) from public;
revoke execute on function public.element_shard_id(text) from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_user_is_anonymous() to authenticated;
grant execute on function public.effective_board_permission(text) to authenticated;
grant execute on function public.can_manage_board(text) to authenticated;
grant execute on function public.can_read_board(text) to authenticated;
grant execute on function public.can_write_board(text) to authenticated;
grant execute on function public.get_board_access(text) to authenticated;
grant execute on function public.list_my_boards(integer, integer) to authenticated;
grant execute on function public.list_my_boards_page(integer, bigint, text) to authenticated;
grant execute on function public.get_board_state(text) to authenticated;
grant execute on function public.create_board(text, text, text, text, text, text, boolean, text) to authenticated;
grant execute on function public.patch_board(text, jsonb) to authenticated;
grant execute on function public.finalize_board_initialization(text) to authenticated;
grant execute on function public.create_board_share_link(text, text, timestamptz) to authenticated;
grant execute on function public.redeem_board_share_link(text) to authenticated;
grant execute on function public.list_board_share_links(text) to authenticated;
grant execute on function public.revoke_board_share_link(uuid) to authenticated;
grant execute on function public.list_board_members(text) to authenticated;
grant execute on function public.remove_board_member(text, uuid) to authenticated;
grant execute on function public.apply_board_mutations(text, jsonb) to authenticated;
grant execute on function public.board_asset_quota_available(text, bigint) to authenticated;
grant execute on function public.element_shard_id(text) to authenticated;

-- Private bucket restrictions suitable for Supabase Free storage.
update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array[
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      'application/pdf',
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'
    ]::text[]
where id = 'board-assets';

create or replace function public.storage_board_id(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[];
begin
  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) < 2 or v_parts[1] <> 'boards' then
    return null;
  end if;
  return v_parts[2];
exception when others then
  return null;
end;
$$;

revoke execute on function public.storage_board_id(text) from public, anon;
grant execute on function public.storage_board_id(text) to authenticated;

create or replace function public.storage_asset_path_valid(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    length(coalesce(p_name, '')) between 1 and 512
    and p_name ~ '^boards/[A-Za-z0-9_.:-]{1,160}/[A-Za-z0-9_.:-]{1,160}\.(png|jpg|jpeg|webp|gif|pdf|mp3|wav|ogg|webm)$'
$$;

revoke execute on function public.storage_asset_path_valid(text) from public, anon;
grant execute on function public.storage_asset_path_valid(text) to authenticated;

-- A conservative per-board cap protects the 1 GB Free project from accidental
-- media floods. Bucket-level file limits still enforce the individual 20 MB cap.
create or replace function public.storage_board_quota_available(p_name text, p_new_size bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(p_new_size, 0) between 0 and 20971520
    and (
      select coalesce(sum(
        case
          when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]+$'
            then (o.metadata ->> 'size')::bigint
          else 0
        end
      ), 0)
      from storage.objects o
      where o.bucket_id = 'board-assets'
        and public.storage_board_id(o.name) = public.storage_board_id(p_name)
    ) + greatest(coalesce(p_new_size, 0), 0) <= 262144000
$$;

revoke execute on function public.storage_board_quota_available(text, bigint) from public, anon;
grant execute on function public.storage_board_quota_available(text, bigint) to authenticated;

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
  and public.storage_board_quota_available(
    name,
    case
      when coalesce(metadata ->> 'size', '') ~ '^[0-9]+$'
        then (metadata ->> 'size')::bigint
      else 0
    end
  )
);

create policy board_assets_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'board-assets'
  and public.storage_asset_path_valid(name)
  and public.can_manage_board(public.storage_board_id(name))
);

-- Manual admin setup now uses the private table:
-- insert into private.admin_users (user_id)
-- select id from auth.users where email = 'YOUR_EMAIL@example.com'
-- on conflict (user_id) do nothing;

-- =====================================================================
-- SOURCE: supabase/migrations/202608060001_fix_share_link_pgcrypto.sql
-- =====================================================================
-- Keep share-link cryptography compatible with security-definer functions that
-- intentionally use an empty search_path. The pgcrypto extension is installed
-- in Supabase's trusted extensions schema.

create extension if not exists pgcrypto;

create or replace function public.create_board_share_link(
  p_board_id text,
  p_role text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_role not in ('viewer', 'editor') then
    raise exception 'Invalid share role';
  end if;
  if not public.can_manage_board(p_board_id) then
    raise exception 'Not authorized to create a sharing link' using errcode = '42501';
  end if;
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then
    raise exception 'Share-link expiry must be in the future';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.board_share_links (board_id, token_hash, role, expires_at, created_by)
  values (
    p_board_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_role,
    p_expires_at,
    v_uid
  )
  returning id into v_id;

  update public.boards
  set access_mode = 'shared',
      updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where id = p_board_id;

  return jsonb_build_object('id', v_id, 'rawToken', v_token, 'role', p_role, 'expiresAt', p_expires_at);
end;
$$;

create or replace function public.redeem_board_share_link(p_raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_link public.board_share_links;
  v_board public.boards;
  v_existing_role text;
  v_existing_expires timestamptz;
  v_effective_role text;
  v_effective_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_raw_token is null or length(p_raw_token) < 32 or length(p_raw_token) > 256 then
    raise exception 'Invalid sharing token';
  end if;

  select * into v_link
  from public.board_share_links l
  where l.token_hash = encode(extensions.digest(p_raw_token, 'sha256'), 'hex')
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > clock_timestamp())
  for update;

  if not found then raise exception 'Sharing link is invalid, expired, or revoked'; end if;
  select * into v_board from public.boards where id = v_link.board_id and status = 'ready';
  if not found then raise exception 'Board not found'; end if;

  if v_board.owner_uid <> v_uid::text and not public.is_admin() then
    select m.role, m.expires_at into v_existing_role, v_existing_expires
    from public.board_members m
    where m.board_id = v_link.board_id
      and m.user_id = v_uid
      and (m.expires_at is null or m.expires_at > clock_timestamp());

    if v_link.role = 'editor' then
      v_effective_role := 'editor';
      if v_existing_role = 'editor' then
        v_effective_expires := case
          when v_existing_expires is null or v_link.expires_at is null then null
          else greatest(v_existing_expires, v_link.expires_at)
        end;
      else
        v_effective_expires := v_link.expires_at;
      end if;
    elsif v_existing_role = 'editor' then
      v_effective_role := 'editor';
      v_effective_expires := v_existing_expires;
    else
      v_effective_role := 'viewer';
      v_effective_expires := case
        when v_existing_role = 'viewer' and (v_existing_expires is null or v_link.expires_at is null) then null
        when v_existing_role = 'viewer' then greatest(v_existing_expires, v_link.expires_at)
        else v_link.expires_at
      end;
    end if;

    insert into public.board_members (board_id, user_id, role, expires_at, created_by)
    values (v_link.board_id, v_uid, v_effective_role, v_effective_expires, v_link.created_by)
    on conflict (board_id, user_id) do update
    set role = excluded.role,
        expires_at = excluded.expires_at,
        created_by = excluded.created_by;
  end if;

  update public.board_share_links
  set last_redeemed_at = clock_timestamp(), redemption_count = redemption_count + 1
  where id = v_link.id;

  return jsonb_build_object(
    'boardId', v_link.board_id,
    'name', v_board.name,
    'permission', public.effective_board_permission(v_link.board_id)
  );
end;
$$;

revoke execute on function public.create_board_share_link(text, text, timestamptz) from public, anon;
revoke execute on function public.redeem_board_share_link(text) from public, anon;
grant execute on function public.create_board_share_link(text, text, timestamptz) to authenticated;
grant execute on function public.redeem_board_share_link(text) to authenticated;

-- =====================================================================
-- SOURCE: supabase/migrations/202608060002_fix_apply_board_mutations_jsonb_count.sql
-- =====================================================================
-- Fix cloud checkpoints for every board element type.
-- PostgreSQL has jsonb_array_length(), but no jsonb_object_length().
-- Count top-level object keys through pg_catalog.jsonb_object_keys() instead.

do $$
declare
  v_board_id_type text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
    into v_board_id_type
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'boards'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_board_id_type is distinct from 'text' then
    raise exception 'Expected public.boards.id to be text, found %', coalesce(v_board_id_type, 'missing');
  end if;
end
$$;

create or replace function public.apply_board_mutations(p_board_id text, p_mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.boards;
  v_mut jsonb;
  v_shard_id text;
  v_element_id text;
  v_action text;
  v_payload jsonb;
  v_type text;
  v_elements jsonb;
  v_tombstones jsonb;
  v_server jsonb;
  v_tombstone jsonb;
  v_server_updated bigint;
  v_tombstone_updated bigint;
  v_local_updated bigint;
  v_client_updated bigint;
  v_server_client text;
  v_tombstone_client text;
  v_local_client text;
  v_local_wins boolean;
  v_before integer;
  v_after integer;
  v_total_delta integer := 0;
  v_applied integer := 0;
  v_rejected integer := 0;
  v_shard_applied integer;
  v_next_revision bigint;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_cutoff bigint := ((extract(epoch from clock_timestamp()) * 1000)::bigint - 604800000);
  v_changed text[] := '{}';
  v_deleted text[] := '{}';
  v_return_shards jsonb := '{}'::jsonb;
  v_actor text := coalesce((select auth.uid())::text, 'unknown');
  v_key text;
begin
  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'p_mutations must be a JSON array';
  end if;
  if jsonb_array_length(p_mutations) > 500 then
    raise exception 'A checkpoint may contain at most 500 element mutations';
  end if;
  if pg_column_size(p_mutations) > 8 * 1024 * 1024 then
    raise exception 'Mutation checkpoint is too large';
  end if;
  if not public.can_write_board(p_board_id) then
    raise exception 'Not authorized to write this board' using errcode = '42501';
  end if;

  select * into v_board
  from public.boards
  where id = p_board_id
  for update;
  if not found then raise exception 'Board not found'; end if;

  v_next_revision := v_board.current_revision + 1;

  -- Validate every record before changing any shard.
  for v_mut in select value from jsonb_array_elements(p_mutations)
  loop
    if jsonb_typeof(v_mut) <> 'object' then
      raise exception 'Every mutation must be an object';
    end if;
    for v_key in select jsonb_object_keys(v_mut)
    loop
      if v_key not in ('elementId', 'shardId', 'action', 'data', 'updatedAt', 'updatedByClientId') then
        raise exception 'Unsupported mutation field: %', v_key;
      end if;
    end loop;

    v_element_id := v_mut ->> 'elementId';
    v_shard_id := v_mut ->> 'shardId';
    v_action := coalesce(v_mut ->> 'action', 'set');

    if coalesce(v_element_id, '') !~ '^[A-Za-z0-9_.:-]{1,160}$' then
      raise exception 'Invalid element id';
    end if;
    if coalesce(v_shard_id, '') !~ '^shard_([0-9]|1[0-5])$'
       or v_shard_id is distinct from public.element_shard_id(v_element_id) then
      raise exception 'Invalid shard id';
    end if;
    if jsonb_typeof(v_mut -> 'action') <> 'string' or v_action not in ('set', 'delete') then
      raise exception 'Invalid mutation action';
    end if;
    if v_mut ? 'updatedAt' and (
      jsonb_typeof(v_mut -> 'updatedAt') <> 'number'
      or coalesce(v_mut ->> 'updatedAt', '') !~ '^[0-9]{1,16}$'
    ) then
      raise exception 'Invalid client timestamp';
    end if;
    if v_mut ? 'updatedByClientId' and jsonb_typeof(v_mut -> 'updatedByClientId') <> 'string' then
      raise exception 'Invalid client id';
    end if;
    if length(coalesce(v_mut ->> 'updatedByClientId', '')) > 128 then
      raise exception 'Client id is too long';
    end if;

    if v_action = 'set' then
      v_payload := v_mut -> 'data';
      if jsonb_typeof(v_payload) <> 'object' then
        raise exception 'Set mutations require an object payload';
      end if;
      if pg_column_size(v_payload) > 1024 * 1024 then
        raise exception 'An element may not exceed 1 MB';
      end if;
      if v_payload ->> 'id' is distinct from v_element_id then
        raise exception 'Element payload id must equal elementId';
      end if;
      if v_payload::text ~ '"(__proto__|prototype|constructor)"[[:space:]]*:' then
        raise exception 'Element contains a forbidden property';
      end if;
      foreach v_key in array array['x', 'y', 'width', 'height', 'zIndex', 'fontSize', 'duration', 'strokeWidth']
      loop
        if v_payload ? v_key and (
          jsonb_typeof(v_payload -> v_key) <> 'number'
          or abs((v_payload ->> v_key)::numeric) > 10000000
        ) then
          raise exception 'Invalid numeric element field: %', v_key;
        end if;
      end loop;
      v_type := v_payload ->> 'type';
      if v_type not in ('sticky', 'shape', 'text', 'drawing', 'image', 'connector', 'audio', 'stamp', 'math', 'table') then
        raise exception 'Unsupported element type';
      end if;
      if length(coalesce(v_payload ->> 'text', '')) > 100000 then
        raise exception 'Element text is too long';
      end if;
      if v_type = 'drawing' then
        if jsonb_typeof(v_payload -> 'points') <> 'array' then
          raise exception 'Drawing points must be an array';
        end if;
        if jsonb_array_length(v_payload -> 'points') > 20000 then
          raise exception 'Drawing contains too many points';
        end if;
        if exists (
          select 1
          from jsonb_array_elements(v_payload -> 'points') as p(point)
          where jsonb_typeof(p.point) <> 'object'
             or jsonb_typeof(p.point -> 'x') <> 'number'
             or jsonb_typeof(p.point -> 'y') <> 'number'
             or abs((p.point ->> 'x')::numeric) > 10000000
             or abs((p.point ->> 'y')::numeric) > 10000000
        ) then
          raise exception 'Drawing contains invalid points';
        end if;
        if jsonb_typeof(v_payload -> 'width') <> 'number'
           or (v_payload ->> 'width')::numeric <= 0
           or (v_payload ->> 'width')::numeric > 200 then
          raise exception 'Drawing width is invalid';
        end if;
      end if;
      if v_type = 'table' then
        if jsonb_typeof(v_payload -> 'rows') <> 'number'
           or jsonb_typeof(v_payload -> 'cols') <> 'number'
           or (v_payload ->> 'rows')::numeric not between 1 and 200
           or (v_payload ->> 'cols')::numeric not between 1 and 200
           or (v_payload ->> 'rows')::numeric <> trunc((v_payload ->> 'rows')::numeric)
           or (v_payload ->> 'cols')::numeric <> trunc((v_payload ->> 'cols')::numeric) then
          raise exception 'Table dimensions are invalid';
        end if;
        if jsonb_typeof(v_payload -> 'data') <> 'array'
           or jsonb_array_length(v_payload -> 'data') > 200 then
          raise exception 'Table data is invalid';
        end if;
        if exists (
          select 1
          from jsonb_array_elements(v_payload -> 'data') as r(row_data)
          where jsonb_typeof(r.row_data) <> 'array'
             or jsonb_array_length(r.row_data) > 200
        ) then
          raise exception 'Table contains an invalid row';
        end if;
      end if;
      if length(coalesce(v_payload ->> 'src', '')) > 100000
         or length(coalesce(v_payload ->> 'audioUrl', '')) > 100000
         or length(coalesce(v_payload ->> 'signatureDataUrl', '')) > 100000 then
        raise exception 'Large inline media must use Storage';
      end if;
    end if;
  end loop;

  for v_shard_id in
    select distinct value ->> 'shardId'
    from jsonb_array_elements(p_mutations)
  loop
    v_shard_applied := 0;

    select s.elements, s.tombstones
      into v_elements, v_tombstones
    from public.board_shards s
    where s.board_id = p_board_id and s.shard_id = v_shard_id
    for update;

    if not found then
      v_elements := '{}'::jsonb;
      v_tombstones := '{}'::jsonb;
    end if;
    select count(*)::integer into v_before
    from pg_catalog.jsonb_object_keys(coalesce(v_elements, '{}'::jsonb));

    for v_mut in
      select value from jsonb_array_elements(p_mutations)
      where value ->> 'shardId' = v_shard_id
    loop
      v_element_id := v_mut ->> 'elementId';
      v_action := coalesce(v_mut ->> 'action', 'set');
      v_client_updated := coalesce(nullif(v_mut ->> 'updatedAt', '')::bigint, v_now);
      -- Bound client clocks. A forged far-future timestamp can no longer win forever.
      v_local_updated := least(v_now + 5000, greatest(v_now - 300000, v_client_updated));
      v_local_client := v_actor || ':' || left(coalesce(v_mut ->> 'updatedByClientId', ''), 96);
      v_server := v_elements -> v_element_id;
      v_tombstone := v_tombstones -> v_element_id;
      v_server_updated := coalesce(nullif(v_server ->> 'updatedAt', '')::bigint, 0);
      v_server_client := coalesce(v_server ->> 'updatedByClientId', '');
      v_tombstone_updated := coalesce(nullif(v_tombstone ->> 'updatedAt', '')::bigint, 0);
      v_tombstone_client := coalesce(v_tombstone ->> 'updatedByClientId', '');
      v_local_wins := true;

      if v_tombstone is not null and (
        v_local_updated < v_tombstone_updated or
        (v_local_updated = v_tombstone_updated and v_local_client <= v_tombstone_client)
      ) then v_local_wins := false; end if;

      if v_server is not null and (
        v_local_updated < v_server_updated or
        (v_local_updated = v_server_updated and v_local_client <= v_server_client)
      ) then v_local_wins := false; end if;

      if v_local_wins then
        v_applied := v_applied + 1;
        v_shard_applied := v_shard_applied + 1;
        if v_action = 'delete' then
          v_elements := v_elements - v_element_id;
          v_tombstones := jsonb_set(
            v_tombstones, array[v_element_id],
            jsonb_build_object('updatedAt', v_local_updated, 'updatedByClientId', v_local_client), true
          );
        else
          v_payload := v_mut -> 'data';
          v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_element_id), true);
          v_payload := jsonb_set(v_payload, '{updatedAt}', to_jsonb(v_local_updated), true);
          v_payload := jsonb_set(v_payload, '{updatedByClientId}', to_jsonb(v_local_client), true);
          v_elements := jsonb_set(v_elements, array[v_element_id], v_payload, true);
          v_tombstones := v_tombstones - v_element_id;
        end if;
      else
        v_rejected := v_rejected + 1;
      end if;
    end loop;

    v_return_shards := jsonb_set(v_return_shards, array[v_shard_id], v_elements, true);

    if v_shard_applied > 0 then
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        into v_tombstones
      from jsonb_each(v_tombstones)
      where coalesce(nullif(value ->> 'updatedAt', '')::bigint, 0) >= v_cutoff;

      select count(*)::integer into v_after
      from pg_catalog.jsonb_object_keys(coalesce(v_elements, '{}'::jsonb));
      v_total_delta := v_total_delta + (v_after - v_before);
      v_changed := array_append(v_changed, v_shard_id);

      if v_after = 0 and not exists (
        select 1
        from pg_catalog.jsonb_object_keys(coalesce(v_tombstones, '{}'::jsonb))
      ) then
        delete from public.board_shards
        where board_id = p_board_id and shard_id = v_shard_id;
        v_deleted := array_append(v_deleted, v_shard_id);
      else
        insert into public.board_shards (
          board_id, shard_id, revision, elements, tombstones, updated_at
        ) values (
          p_board_id, v_shard_id, v_next_revision, v_elements, v_tombstones, v_now
        )
        on conflict (board_id, shard_id) do update
        set revision = excluded.revision,
            elements = excluded.elements,
            tombstones = excluded.tombstones,
            updated_at = excluded.updated_at;
      end if;
    end if;
  end loop;

  if v_applied > 0 then
    update public.boards b
    set current_revision = v_next_revision,
        changed_shard_ids = v_changed,
        deleted_shard_ids = v_deleted,
        total_elements = greatest(0, b.total_elements + v_total_delta),
        updated_at = v_now,
        schema_version = 4,
        shard_layout_version = 3,
        shard_count = 16,
        data = b.data || jsonb_build_object(
          'currentRevision', v_next_revision,
          'changedShardIds', to_jsonb(v_changed),
          'deletedShardIds', to_jsonb(v_deleted),
          'totalElements', greatest(0, b.total_elements + v_total_delta),
          'updatedAt', v_now,
          'schemaVersion', 4,
          'shardLayoutVersion', 3,
          'shardCount', 16
        )
    where b.id = p_board_id;
  else
    v_next_revision := v_board.current_revision;
  end if;

  return jsonb_build_object(
    'revision', v_next_revision,
    'changedShardIds', to_jsonb(v_changed),
    'deletedShardIds', to_jsonb(v_deleted),
    'totalElements', greatest(0, v_board.total_elements + v_total_delta),
    'applied', v_applied,
    'rejected', v_rejected,
    'shards', v_return_shards
  );
end;
$$;

revoke all on function public.apply_board_mutations(text, jsonb) from public, anon;
grant execute on function public.apply_board_mutations(text, jsonb) to authenticated;

-- =====================================================================
-- SOURCE: supabase/migrations/202608060003_fix_board_asset_upload.sql
-- =====================================================================
-- Fix board image/audio/PDF uploads on the existing text-ID whiteboard schema.
-- The earlier storage INSERT policy depended on storage object metadata during
-- the INSERT check. Bucket limits already enforce MIME type and file size, so
-- this policy keeps authorization strict while avoiding that fragile check.

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

-- =====================================================================
-- SOURCE: supabase/migrations/202608070001_add_individual_member_view_only.sql
-- =====================================================================
-- Allow board owners/admins to switch one redeemed member between editor and
-- viewer without affecting the board-wide students_can_write master switch.
-- Existing membership expiry is preserved.

create or replace function public.update_board_member_role(
  p_board_id text,
  p_user_id uuid,
  p_role text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_uid text;
begin
  if not public.can_manage_board(p_board_id) then
    raise exception 'Not authorized to update board members' using errcode = '42501';
  end if;

  if p_role not in ('viewer', 'editor') then
    raise exception 'Board member role must be viewer or editor' using errcode = '22023';
  end if;

  select b.owner_uid into v_owner_uid
  from public.boards b
  where b.id = p_board_id;

  if v_owner_uid is null then
    raise exception 'Board not found' using errcode = 'P0002';
  end if;

  if p_user_id is null or p_user_id::text = v_owner_uid then
    raise exception 'The board owner role cannot be changed';
  end if;

  update public.board_members m
  set role = p_role
  where m.board_id = p_board_id
    and m.user_id = p_user_id;

  return found;
end;
$$;

revoke all on function public.update_board_member_role(text, uuid, text) from public, anon;
grant execute on function public.update_board_member_role(text, uuid, text) to authenticated;

commit;
