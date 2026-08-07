-- Allow board owners/admins to switch one redeemed member between editor and
-- viewer without affecting the board-wide students_can_write master switch.
-- Existing membership expiry is preserved.

begin;

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
