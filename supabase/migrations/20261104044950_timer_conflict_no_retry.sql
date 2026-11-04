-- A stale revision is a business conflict, not a serialization failure.
-- PostgREST 14 retries SQLSTATE 40001 indefinitely. Keep the message and rollback behavior.
create or replace function public.transition_board_timer(
  p_board_id text, p_expected_revision bigint, p_action text, p_value integer default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_timer public.board_timers;
  v_now timestamptz;
  v_elapsed bigint;
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'Timer write access denied' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('start', 'pause', 'reset', 'duration', 'mode', 'adjust', 'visibility') then
    raise exception 'Invalid timer action' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Expected timer revision required' using errcode = '22023';
  end if;
  if p_action = 'duration' and (p_value is null or p_value not between 0 and 86400)
    or p_action in ('mode', 'visibility') and (p_value is null or p_value not in (0, 1))
    or p_action = 'adjust' and (p_value is null or p_value not between -86400 and 86400) then
    raise exception 'Invalid timer value' using errcode = '22023';
  end if;
  insert into public.board_timers(board_id) values (p_board_id) on conflict do nothing;
  select * into v_timer from public.board_timers where board_id = p_board_id for update;
  if not public.can_write_board(p_board_id) then
    raise exception 'Timer write access denied' using errcode = '42501';
  end if;
  if v_timer.revision <> p_expected_revision then
    raise exception 'Timer changed in another client. Refresh and retry.' using errcode = 'P0001';
  end if;
  -- Capture time AFTER the lock: a concurrent writer may have held it for seconds.
  v_now := clock_timestamp();
  if v_timer.running then
    v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_timer.started_at)) * 1000)::bigint);
    v_timer.baseline_ms := case when v_timer.mode = 'timer'
      then greatest(0, v_timer.baseline_ms - v_elapsed)
      else least(31536000000, v_timer.baseline_ms + v_elapsed) end;
    v_timer.started_at := v_now;
    if v_timer.mode = 'timer' and v_timer.baseline_ms = 0 then
      v_timer.completed := true;
      v_timer.running := false;
      v_timer.started_at := null;
    end if;
  end if;
  case p_action
    when 'start' then
      if not v_timer.completed and v_timer.baseline_ms > 0 or v_timer.mode = 'stopwatch' then
        v_timer.running := true; v_timer.started_at := v_now;
      end if;
    when 'pause' then
      v_timer.running := false; v_timer.started_at := null;
    when 'reset' then
      v_timer.running := false; v_timer.started_at := null; v_timer.completed := false;
      v_timer.baseline_ms := case when v_timer.mode = 'timer' then v_timer.total_seconds * 1000::bigint else 0 end;
      v_timer.run_id := v_timer.run_id + 1;
    when 'duration' then
      v_timer.mode := 'timer'; v_timer.total_seconds := p_value;
      v_timer.baseline_ms := p_value * 1000::bigint; v_timer.running := false;
      v_timer.started_at := null; v_timer.completed := false; v_timer.run_id := v_timer.run_id + 1;
    when 'mode' then
      v_timer.mode := case when p_value = 0 then 'timer' else 'stopwatch' end;
      v_timer.baseline_ms := case when p_value = 0 then v_timer.total_seconds * 1000::bigint else 0 end;
      v_timer.running := false; v_timer.started_at := null;
      v_timer.completed := false; v_timer.run_id := v_timer.run_id + 1;
    when 'adjust' then
      -- Completion remains latched until reset, duration editing, or mode selection.
      if not v_timer.completed then
        v_timer.baseline_ms := least(31536000000, greatest(0, v_timer.baseline_ms + p_value * 1000::bigint));
        if v_timer.mode = 'timer' then
          v_timer.baseline_ms := least(86400000, v_timer.baseline_ms);
          v_timer.total_seconds := least(86400, greatest(v_timer.total_seconds, ceil(v_timer.baseline_ms / 1000.0)::integer));
          if v_timer.running and v_timer.baseline_ms = 0 then
            v_timer.completed := true; v_timer.running := false; v_timer.started_at := null;
          end if;
        end if;
      end if;
    when 'visibility' then v_timer.visible := p_value = 1;
  end case;
  update public.board_timers set mode = v_timer.mode, running = v_timer.running,
    baseline_ms = v_timer.baseline_ms, total_seconds = v_timer.total_seconds,
    started_at = v_timer.started_at, visible = v_timer.visible, completed = v_timer.completed,
    run_id = v_timer.run_id, revision = revision + 1,
    updated_at = v_now, updated_by = (select auth.uid())
  where board_id = p_board_id;
  return public.get_board_timer(p_board_id);
end;
$$;
