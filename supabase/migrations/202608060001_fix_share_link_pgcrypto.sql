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
