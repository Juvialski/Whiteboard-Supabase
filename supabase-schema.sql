-- Fresh Supabase backend for the collaborative whiteboard.
-- Run this entire file once in the Supabase SQL Editor for a NEW project.

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
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled Board',
  description text not null default '',
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  created_by text not null default 'Unknown',
  owner_uid uuid not null references auth.users(id) on delete cascade,
  access_mode text not null default 'private' check (access_mode in ('private', 'shared', 'link-view', 'link-edit', 'public')),
  editor_uids uuid[] not null default '{}',
  viewer_uids uuid[] not null default '{}',
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
  board_id uuid not null references public.boards(id) on delete cascade,
  shard_id text not null,
  revision bigint not null default 0,
  elements jsonb not null default '{}'::jsonb,
  tombstones jsonb not null default '{}'::jsonb,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  primary key (board_id, shard_id)
);

create table if not exists public.board_assets (
  board_id uuid not null references public.boards(id) on delete cascade,
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
  id uuid primary key references auth.users(id) on delete cascade,
  profile_id text,
  name text not null default 'Guest User',
  email text,
  last_active bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  is_online boolean not null default true,
  role text not null default 'student',
  current_board_id uuid references public.boards(id) on delete set null,
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

create or replace function public.can_manage_board(p_board_id uuid)
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
      and (b.owner_uid = (select auth.uid()) or public.is_admin())
  )
$$;

create or replace function public.can_read_board(p_board_id uuid)
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
        or b.owner_uid = (select auth.uid())
        or (select auth.uid()) = any(b.editor_uids)
        or (select auth.uid()) = any(b.viewer_uids)
        or b.access_mode in ('link-view', 'link-edit', 'public')
      )
  )
$$;

create or replace function public.can_write_board(p_board_id uuid)
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
        or b.owner_uid = (select auth.uid())
        or (select auth.uid()) = any(b.editor_uids)
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
      or b.owner_uid = (select auth.uid())
      or (select auth.uid()) = any(b.editor_uids)
      or (select auth.uid()) = any(b.viewer_uids)
    )
  order by b.created_at desc
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0)
$$;

create or replace function public.get_board_state(p_board_id uuid)
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

create or replace function public.patch_board(p_board_id uuid, p_patch jsonb)
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
    owner_uid = case when p_patch ? 'ownerUid' then (p_patch ->> 'ownerUid')::uuid else b.owner_uid end,
    access_mode = case when p_patch ? 'accessMode' then p_patch ->> 'accessMode' else b.access_mode end,
    editor_uids = case when p_patch ? 'editorUids' then
      coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(p_patch -> 'editorUids')), '{}'::uuid[])
      else b.editor_uids end,
    viewer_uids = case when p_patch ? 'viewerUids' then
      coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(p_patch -> 'viewerUids')), '{}'::uuid[])
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

create or replace function public.apply_board_mutations(p_board_id uuid, p_mutations jsonb)
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

    v_before := jsonb_object_length(v_elements);

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

      v_after := jsonb_object_length(v_elements);
      v_total_delta := v_total_delta + (v_after - v_before);
      v_changed := array_append(v_changed, v_shard_id);

      if v_after = 0 and jsonb_object_length(v_tombstones) = 0 then
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
with check (owner_uid = (select auth.uid()));
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
using (id = (select auth.uid()) or public.is_admin());
create policy presence_write_self on public.presence
for insert to authenticated
with check (id = (select auth.uid()));
create policy presence_update_self on public.presence
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));
create policy presence_delete on public.presence
for delete to authenticated
using (id = (select auth.uid()) or public.is_admin());

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
revoke execute on function public.can_manage_board(uuid) from public, anon;
revoke execute on function public.can_read_board(uuid) from public, anon;
revoke execute on function public.can_write_board(uuid) from public, anon;
revoke execute on function public.list_my_boards(integer, integer) from public, anon;
revoke execute on function public.get_board_state(uuid) from public, anon;
revoke execute on function public.patch_board(uuid, jsonb) from public, anon;
revoke execute on function public.apply_board_mutations(uuid, jsonb) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_manage_board(uuid) to authenticated;
grant execute on function public.can_read_board(uuid) to authenticated;
grant execute on function public.can_write_board(uuid) to authenticated;
grant execute on function public.list_my_boards(integer, integer) to authenticated;
grant execute on function public.get_board_state(uuid) to authenticated;
grant execute on function public.patch_board(uuid, jsonb) to authenticated;
grant execute on function public.apply_board_mutations(uuid, jsonb) to authenticated;

-- Private Storage bucket for images, audio, signatures, and PDF pages.
insert into storage.buckets (id, name, public, file_size_limit)
values ('board-assets', 'board-assets', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create or replace function public.storage_board_id(p_name text)
returns uuid
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
  return v_parts[2]::uuid;
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

-- Give the first administrator access by replacing the email below after Google sign-in:
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = 'YOUR_EMAIL@example.com');
