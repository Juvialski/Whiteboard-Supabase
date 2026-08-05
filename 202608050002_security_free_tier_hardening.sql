-- Security and free-tier hardening for the existing collaborative whiteboard.
-- Apply after 202608030001_fresh_whiteboard.sql.

create extension if not exists pgcrypto;

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
  board_id uuid not null references public.boards(id) on delete cascade,
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
  board_id uuid not null references public.boards(id) on delete cascade,
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
select b.id, u.user_id, 'editor', b.owner_uid
from public.boards b
cross join lateral unnest(coalesce(b.editor_uids, '{}'::uuid[])) as u(user_id)
where u.user_id is not null and u.user_id <> b.owner_uid
on conflict (board_id, user_id) do update
set role = 'editor', expires_at = null;

insert into public.board_members (board_id, user_id, role, created_by)
select b.id, u.user_id, 'viewer', b.owner_uid
from public.boards b
cross join lateral unnest(coalesce(b.viewer_uids, '{}'::uuid[])) as u(user_id)
where u.user_id is not null and u.user_id <> b.owner_uid
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
set editor_uids = '{}'::uuid[],
    viewer_uids = '{}'::uuid[],
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

create or replace function public.effective_board_permission(p_board_id uuid)
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

  if v_board.owner_uid = v_uid then
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

create or replace function public.can_manage_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.effective_board_permission(p_board_id) in ('admin', 'owner')
$$;

create or replace function public.can_read_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.effective_board_permission(p_board_id) in ('admin', 'owner', 'editor', 'viewer')
$$;

create or replace function public.can_write_board(p_board_id uuid)
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

create or replace function public.get_board_access(p_board_id uuid)
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
  id uuid,
  name text,
  description text,
  created_at bigint,
  updated_at bigint,
  created_by text,
  owner_uid uuid,
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
    b.current_revision,
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
  p_before_id uuid default null
)
returns table (
  id uuid,
  name text,
  description text,
  created_at bigint,
  updated_at bigint,
  created_by text,
  owner_uid uuid,
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
    b.shard_count, b.current_revision, b.total_elements,
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

create or replace function public.get_board_state(p_board_id uuid)
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
  p_board_id uuid,
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
    coalesce(p_board_id, gen_random_uuid()),
    trim(p_name),
    left(coalesce(p_description, ''), 2000),
    v_now,
    v_now,
    left(coalesce(nullif(trim(p_created_by), ''), 'User'), 120),
    v_uid,
    'private',
    '{}'::uuid[],
    '{}'::uuid[],
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
create or replace function public.patch_board(p_board_id uuid, p_patch jsonb)
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

create or replace function public.finalize_board_initialization(p_board_id uuid)
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
  p_board_id uuid,
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

  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.board_share_links (
    board_id, token_hash, role, created_by, expires_at
  ) values (
    p_board_id,
    encode(digest(v_token, 'sha256'), 'hex'),
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
  where l.token_hash = encode(digest(p_raw_token, 'sha256'), 'hex')
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > clock_timestamp())
  for update;

  if not found then
    raise exception 'Invalid or expired share link' using errcode = '42501';
  end if;

  select b.* into v_board from public.boards b where b.id = v_link.board_id;
  if not found then raise exception 'Board not found'; end if;

  if v_board.owner_uid <> v_uid and not public.is_admin() then
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

create or replace function public.list_board_share_links(p_board_id uuid)
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
  v_board_id uuid;
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
create or replace function public.list_board_members(p_board_id uuid)
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

create or replace function public.remove_board_member(p_board_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_board(p_board_id) then
    raise exception 'Not authorized to remove board members' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = (select b.owner_uid from public.boards b where b.id = p_board_id) then
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
create or replace function public.apply_board_mutations(p_board_id uuid, p_mutations jsonb)
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
    v_before := jsonb_object_length(v_elements);

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
drop policy if exists board_members_select on public.board_members;
create policy board_members_select on public.board_members
for select to authenticated
using (user_id = (select auth.uid()) or public.can_manage_board(board_id));

drop policy if exists board_share_links_no_direct_access on public.board_share_links;
-- No direct policies: all operations go through owner-only RPCs.

-- Profiles: a user may edit only safe columns on their own row.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Boards are created and modified through allowlisted RPCs. Direct delete remains owner/admin only.
drop policy if exists boards_insert on public.boards;
drop policy if exists boards_update on public.boards;
create policy boards_insert on public.boards
for insert to authenticated
with check (
  owner_uid = (select auth.uid())
  and not public.current_user_is_anonymous()
);
create policy boards_update on public.boards
for update to authenticated
using (public.can_manage_board(id))
with check (public.can_manage_board(id));

-- Shards are read directly but written only by apply_board_mutations().
drop policy if exists board_shards_write on public.board_shards;

-- Assets are immutable after upload. Editors may insert assets within a
-- conservative per-board metadata quota, while only an owner/admin may delete
-- them during destructive board cleanup.
create or replace function public.board_asset_quota_available(
  p_board_id uuid,
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

drop policy if exists board_assets_insert on public.board_assets;
drop policy if exists board_assets_update on public.board_assets;
drop policy if exists board_assets_delete on public.board_assets;
create policy board_assets_insert on public.board_assets
for insert to authenticated
with check (
  public.can_write_board(board_id)
  and public.board_asset_quota_available(board_id, original_byte_size)
);
create policy board_assets_delete on public.board_assets
for delete to authenticated
using (public.can_manage_board(board_id));

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

revoke insert, update, delete on public.board_shards from authenticated;
grant select on public.board_shards to authenticated;

revoke insert, update on public.boards from authenticated;
grant select, delete on public.boards to authenticated;

revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

revoke all on public.board_members from anon, authenticated;
grant select on public.board_members to authenticated;
revoke all on public.board_share_links from anon, authenticated;

-- Keep required direct asset and presence operations; RLS still applies.
revoke update on public.board_assets from authenticated;
grant select, insert, delete on public.board_assets to authenticated;
grant select, insert, update, delete on public.presence to authenticated;

-- Restrict function execution, then expose only intentional authenticated RPCs.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.current_user_is_anonymous() from public, anon;
revoke execute on function public.effective_board_permission(uuid) from public, anon;
revoke execute on function public.can_manage_board(uuid) from public, anon;
revoke execute on function public.can_read_board(uuid) from public, anon;
revoke execute on function public.can_write_board(uuid) from public, anon;
revoke execute on function public.get_board_access(uuid) from public, anon;
revoke execute on function public.list_my_boards(integer, integer) from public, anon;
revoke execute on function public.list_my_boards_page(integer, bigint, uuid) from public, anon;
revoke execute on function public.get_board_state(uuid) from public, anon;
revoke execute on function public.create_board(uuid, text, text, text, text, text, boolean, text) from public, anon;
revoke execute on function public.patch_board(uuid, jsonb) from public, anon;
revoke execute on function public.finalize_board_initialization(uuid) from public, anon;
revoke execute on function public.create_board_share_link(uuid, text, timestamptz) from public, anon;
revoke execute on function public.redeem_board_share_link(text) from public, anon;
revoke execute on function public.list_board_share_links(uuid) from public, anon;
revoke execute on function public.revoke_board_share_link(uuid) from public, anon;
revoke execute on function public.list_board_members(uuid) from public, anon;
revoke execute on function public.remove_board_member(uuid, uuid) from public, anon;
revoke execute on function public.apply_board_mutations(uuid, jsonb) from public, anon;
revoke execute on function public.board_asset_quota_available(uuid, bigint) from public, anon;
revoke execute on function public.element_shard_id(text) from public, anon;

revoke execute on function public.is_admin() from public;
revoke execute on function public.current_user_is_anonymous() from public;
revoke execute on function public.effective_board_permission(uuid) from public;
revoke execute on function public.can_manage_board(uuid) from public;
revoke execute on function public.can_read_board(uuid) from public;
revoke execute on function public.can_write_board(uuid) from public;
revoke execute on function public.get_board_access(uuid) from public;
revoke execute on function public.list_my_boards(integer, integer) from public;
revoke execute on function public.list_my_boards_page(integer, bigint, uuid) from public;
revoke execute on function public.get_board_state(uuid) from public;
revoke execute on function public.create_board(uuid, text, text, text, text, text, boolean, text) from public;
revoke execute on function public.patch_board(uuid, jsonb) from public;
revoke execute on function public.finalize_board_initialization(uuid) from public;
revoke execute on function public.create_board_share_link(uuid, text, timestamptz) from public;
revoke execute on function public.redeem_board_share_link(text) from public;
revoke execute on function public.list_board_share_links(uuid) from public;
revoke execute on function public.revoke_board_share_link(uuid) from public;
revoke execute on function public.list_board_members(uuid) from public;
revoke execute on function public.remove_board_member(uuid, uuid) from public;
revoke execute on function public.apply_board_mutations(uuid, jsonb) from public;
revoke execute on function public.board_asset_quota_available(uuid, bigint) from public;
revoke execute on function public.element_shard_id(text) from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_user_is_anonymous() to authenticated;
grant execute on function public.effective_board_permission(uuid) to authenticated;
grant execute on function public.can_manage_board(uuid) to authenticated;
grant execute on function public.can_read_board(uuid) to authenticated;
grant execute on function public.can_write_board(uuid) to authenticated;
grant execute on function public.get_board_access(uuid) to authenticated;
grant execute on function public.list_my_boards(integer, integer) to authenticated;
grant execute on function public.list_my_boards_page(integer, bigint, uuid) to authenticated;
grant execute on function public.get_board_state(uuid) to authenticated;
grant execute on function public.create_board(uuid, text, text, text, text, text, boolean, text) to authenticated;
grant execute on function public.patch_board(uuid, jsonb) to authenticated;
grant execute on function public.finalize_board_initialization(uuid) to authenticated;
grant execute on function public.create_board_share_link(uuid, text, timestamptz) to authenticated;
grant execute on function public.redeem_board_share_link(text) to authenticated;
grant execute on function public.list_board_share_links(uuid) to authenticated;
grant execute on function public.revoke_board_share_link(uuid) to authenticated;
grant execute on function public.list_board_members(uuid) to authenticated;
grant execute on function public.remove_board_member(uuid, uuid) to authenticated;
grant execute on function public.apply_board_mutations(uuid, jsonb) to authenticated;
grant execute on function public.board_asset_quota_available(uuid, bigint) to authenticated;
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
returns uuid
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
  return v_parts[2]::uuid;
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
    and p_name ~ '^boards/[0-9a-fA-F-]{36}/[A-Za-z0-9_.:-]{1,160}\.(png|jpg|jpeg|webp|gif|pdf|mp3|wav|ogg|webm)$'
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
