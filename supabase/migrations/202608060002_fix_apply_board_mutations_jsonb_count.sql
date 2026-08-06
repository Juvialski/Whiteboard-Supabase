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
