-- High-concurrency Free-Tier Optimizations:
-- 1. Single-pass get_board_access to eliminate repeated boards/members reads
-- 2. Batch asset metadata hydration in get_board_state to avoid N+1 asset queries
-- 3. Administrator-only expired member and share link cleanup RPC

begin;

-- Single-pass board authorization check
create or replace function public.get_board_access(p_board_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_board public.boards;
  v_permission text := 'none';
  v_role text;
  v_can_write boolean := false;
begin
  if p_board_id is null or length(p_board_id) > 160 then
    raise exception 'Board not found or access denied' using errcode = '42501';
  end if;

  if v_uid is null then
    raise exception 'Board not found or access denied' using errcode = '42501';
  end if;

  select b.* into v_board
  from public.boards b
  where b.id = p_board_id;

  if not found then
    raise exception 'Board not found or access denied' using errcode = '42501';
  end if;

  if public.is_admin() then
    v_permission := 'admin';
  elsif v_board.owner_uid = v_uid::text then
    v_permission := 'owner';
  else
    select m.role into v_role
    from public.board_members m
    where m.board_id = p_board_id
      and m.user_id = v_uid
      and (m.expires_at is null or m.expires_at > clock_timestamp())
    limit 1;

    if v_role in ('viewer', 'editor') then
      v_permission := v_role;
    else
      v_permission := 'none';
    end if;
  end if;

  if v_permission = 'none' then
    raise exception 'Board not found or access denied' using errcode = '42501';
  end if;

  v_can_write := (v_permission in ('admin', 'owner'))
    or (v_permission = 'editor' and coalesce(v_board.students_can_write, false));

  return jsonb_build_object(
    'boardId', v_board.id,
    'name', v_board.name,
    'permission', v_permission,
    'canRead', true,
    'canWrite', v_can_write,
    'canManage', v_permission in ('admin', 'owner'),
    'ownerUid', v_board.owner_uid,
    'accessMode', v_board.access_mode,
    'studentsCanWrite', v_board.students_can_write
  );
end;
$$;

-- Batch asset metadata included in get_board_state payload
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
  v_assets jsonb;
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

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at asc), '[]'::jsonb)
    into v_assets
  from public.board_assets a
  where a.board_id = p_board_id;

  return jsonb_build_object(
    'board', v_board,
    'shards', v_shards,
    'assets', v_assets
  );
end;
$$;

-- Admin-only cleanup function for expired memberships and share links.
create or replace function public.cleanup_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_obtained boolean;
  v_deleted_members integer := 0;
  v_deleted_links integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can run cleanup maintenance' using errcode = '42501';
  end if;

  v_lock_obtained := pg_try_advisory_lock(hashtext('cleanup_expired_records'));
  if not v_lock_obtained then
    return jsonb_build_object('status', 'skipped_concurrent_run');
  end if;

  begin
    delete from public.board_members
    where expires_at is not null and expires_at < clock_timestamp();
    get diagnostics v_deleted_members = row_count;

    delete from public.board_share_links
    where expires_at is not null and expires_at < clock_timestamp();
    get diagnostics v_deleted_links = row_count;

    perform pg_advisory_unlock(hashtext('cleanup_expired_records'));
  exception
    when others then
      perform pg_advisory_unlock(hashtext('cleanup_expired_records'));
      raise;
  end;

  return jsonb_build_object(
    'status', 'completed',
    'expired_members_cleaned', v_deleted_members,
    'expired_links_cleaned', v_deleted_links
  );
end;
$$;

revoke all on function public.get_board_access(text) from public, anon;
grant execute on function public.get_board_access(text) to authenticated;

revoke all on function public.get_board_state(text) from public, anon;
grant execute on function public.get_board_state(text) to authenticated;

revoke all on function public.cleanup_expired_records() from public, anon;
grant execute on function public.cleanup_expired_records() to authenticated;

commit;
