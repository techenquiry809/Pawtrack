-- ============================================================================
-- sync_push — the one RPC every device pushes through.
--
-- ── WHY ONE CALL AND NOT ONE PER ROW ───────────────────────────────────────
-- A user coming back from a week in a signal blackspot with 300 queued rows
-- should make one request, not 300. A plpgsql function body is a single
-- transaction, which also gives us the property §13 asks for: a device revoked
-- mid-sync cannot half-write a batch.
--
-- ── WHY CURRENT-STATE UPSERTS AND NOT DIFFS ────────────────────────────────
-- Diffs require ordered, exactly-once delivery. Current-state upserts are
-- idempotent, and idempotent is what survives a retry on a flaky train. The
-- client pushes the whole row as it stands locally.
--
-- ── WHY A DELETE IS JUST A ROW ─────────────────────────────────────────────
-- A hard DELETE cannot be replicated: the next pull would helpfully restore
-- the row from a device that had not heard about it. So every local delete is
-- an UPDATE setting deleted_at, and reaches this function as an ordinary row
-- that happens to have deleted_at set. `op` in the payload is advisory only —
-- the row's own deleted_at is authoritative.
--
-- ── SECURITY INVOKER, DELIBERATELY ─────────────────────────────────────────
-- This function runs with the CALLER's privileges, so every statement inside
-- it is still subject to RLS. Making it SECURITY DEFINER would let one
-- account's push write into another's rows and would quietly undo
-- 20260828000200_rls.sql. If you ever need DEFINER here, you need it for a
-- reason that should be written down first.
-- ============================================================================

-- Rank for §9's duration rule. A stale phone must never overwrite a stopwatch
-- measurement with an estimate.
create or replace function public.duration_confidence_rank(c text)
returns int
language sql
immutable
as $$
  select case c
    when 'high'            then 4
    when 'clock_corrected' then 3
    when 'recovered'       then 2
    when 'unreliable'      then 1
    when 'legacy'          then 0
    else -1                       -- unknown value from a future client
  end
$$;

-- Columns the server owns. A client may send them; they are ignored.
create or replace function public.sync_server_owned_columns()
returns text[]
language sql
immutable
as $$ select array['user_id', 'sync_seq', 'server_updated_at']::text[] $$;

-- ============================================================================
-- The generic single-row apply.
--
-- Returns the CANONICAL id of the row that ended up holding this data, which
-- is not always the id that was sent — see the natural-key branch below.
-- ============================================================================
create or replace function public.sync_apply_row(
  p_table text,
  p_row   jsonb
)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cols        text[];
  v_insert_cols text;
  v_select_cols text;
  v_set_list    text;
  v_conflict    text;
  v_id          text;
  v_out         text;
  v_exists      boolean;
  v_col         text;
  v_assign      text[] := '{}';
  v_sel         text[] := '{}';
begin
  if p_table !~ '^[a-z_]+$' then
    raise exception 'sync_apply_row: refusing suspicious table name %', p_table;
  end if;

  v_id := p_row->>'id';
  if v_id is null then
    raise exception 'sync_apply_row: row for % has no id', p_table;
  end if;

  -- Client-owned columns of this table, in ordinal order. Derived from the
  -- catalog rather than hard-coded so adding a column to a table does not
  -- require editing this function and cannot be silently forgotten.
  select array_agg(column_name::text order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = p_table
     and column_name <> 'id'
     and not (column_name = any (public.sync_server_owned_columns()));

  if v_cols is null then
    raise exception 'sync_apply_row: unknown table %', p_table;
  end if;

  foreach v_col in array v_cols loop
    v_sel := v_sel || format('r.%I', v_col);

    -- §9's duration rule, enforced HERE rather than in the client, because a
    -- client-side rule is only as good as the oldest app version still
    -- installed. Confidence rank wins outright; updated_at only breaks ties
    -- among equals (>= below).
    if p_table = 'seizures' and v_col in ('duration_sec', 'duration_confidence') then
      v_assign := v_assign || format(
        '%1$I = case when public.duration_confidence_rank(excluded.duration_confidence)'
        ||          ' >= public.duration_confidence_rank(seizures.duration_confidence)'
        ||          ' then excluded.%1$I else seizures.%1$I end', v_col);
    else
      v_assign := v_assign || format('%1$I = excluded.%1$I', v_col);
    end if;
  end loop;

  v_insert_cols := 'id, user_id, ' || array_to_string(
                     array(select format('%I', c) from unnest(v_cols) c), ', ');
  v_select_cols := 'r.id, (select auth.uid()), ' || array_to_string(v_sel, ', ');
  v_set_list    := array_to_string(v_assign, ', ');

  -- ── The conflict predicate, shared by every branch ──────────────────────
  --
  --   1. A tombstone is TERMINAL. Once deleted_at is set the row accepts
  --      nothing further: a resurrected seizure record is worse than a lost
  --      edit, and without this an offline device that never heard about the
  --      delete would undelete it on its next push.
  --   2. A delete beats any concurrent edit, whatever its updated_at.
  --   3. Otherwise last-write-wins on updated_at.
  --
  -- `>=` and not `>` so a re-push of an identical row is a no-op update rather
  -- than being silently rejected, which keeps the call idempotent.
  declare
    v_where text := format(
      '%1$I.deleted_at is null and (excluded.deleted_at is not null'
      || ' or excluded.updated_at >= %1$I.updated_at)', p_table);
  begin
    -- ── Natural-key tables ────────────────────────────────────────────────
    -- Two phones, both offline, can each create a check-in for the same dog
    -- and the same local day with DIFFERENT ids. They are one check-in. The
    -- unique index is the constraint and we resolve onto it, keeping whichever
    -- row reached the server first and returning its id so the client can
    -- collapse its local duplicate.
    if p_table in ('daily_checkins', 'medication_doses') then
      v_conflict := case p_table
        when 'daily_checkins'   then '(dog_id, check_in_date) where deleted_at is null'
        else '(medication_id, dose_date, scheduled_hhmm) where deleted_at is null'
      end;

      execute format('select exists (select 1 from public.%I where id = $1)', p_table)
        into v_exists using v_id;

      -- A row already carrying this id takes the ordinary primary-key path;
      -- otherwise the insert below would trip the PK before it ever reached
      -- the natural-key conflict target.
      if not v_exists then
        execute format(
          'insert into public.%1$I (%2$s)
           select %3$s from jsonb_populate_record(null::public.%1$I, $1) r
           on conflict %4$s do update set %5$s where %6$s
           returning id',
          p_table, v_insert_cols, v_select_cols, v_conflict, v_set_list, v_where)
          into v_out using p_row;

        -- DO UPDATE whose WHERE rejected the write returns no row. The
        -- existing server row won; report its id, not a null.
        if v_out is null then
          execute format(
            'select id from public.%I where %s',
            p_table,
            case p_table
              when 'daily_checkins' then 'dog_id = $1->>''dog_id'' and check_in_date = $1->>''check_in_date'' and deleted_at is null'
              else 'medication_id = $1->>''medication_id'' and dose_date = $1->>''dose_date'' and scheduled_hhmm = $1->>''scheduled_hhmm'' and deleted_at is null'
            end)
            into v_out using p_row;
        end if;

        return coalesce(v_out, v_id);
      end if;
    end if;

    -- ── The ordinary primary-key path ─────────────────────────────────────
    execute format(
      'insert into public.%1$I (%2$s)
       select %3$s from jsonb_populate_record(null::public.%1$I, $1) r
       on conflict (id) do update set %4$s where %5$s
       returning id',
      p_table, v_insert_cols, v_select_cols, v_set_list, v_where)
      into v_out using p_row;
  end;

  -- Again: a rejected DO UPDATE returns nothing. That is a successful
  -- outcome — the server's copy was newer, or the row is tombstoned — so the
  -- client should still clear this from its outbox.
  return coalesce(v_out, v_id);
end
$$;

-- ============================================================================
-- The batch entry point.
--
-- payload:
--   { "device_id": "…",
--     "tables": { "dogs": [ {"op":"upsert","row":{…}}, … ], … } }
--
-- returns:
--   { "ok": true,
--     "applied": 42,
--     "remaps": [ {"table":"daily_checkins","sent_id":"x","id":"y"}, … ] }
--
-- `remaps` is the client's instruction to collapse a local duplicate that lost
-- a natural-key race. Ignoring it leaves two rows for one day on that device.
-- ============================================================================
create or replace function public.sync_push(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- FK order. A child must never be written before its parent, and a parent's
  -- tombstone must land before the children that reference it.
  v_order text[] := array[
    'dogs',
    'seizures', 'medications', 'daily_checkins', 'meals',
    'videos', 'seizure_edits', 'medication_reminders', 'medication_doses',
    'user_settings'
  ];
  v_table   text;
  v_entry   jsonb;
  v_row     jsonb;
  v_sent    text;
  v_got     text;
  v_applied int   := 0;
  v_remaps  jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'sync_push: not authenticated';
  end if;

  foreach v_table in array v_order loop
    for v_entry in
      select * from jsonb_array_elements(coalesce(payload->'tables'->v_table, '[]'::jsonb))
    loop
      v_row  := v_entry->'row';
      v_sent := v_row->>'id';
      v_got  := public.sync_apply_row(v_table, v_row);
      v_applied := v_applied + 1;

      if v_got is distinct from v_sent then
        v_remaps := v_remaps || jsonb_build_object(
          'table', v_table, 'sent_id', v_sent, 'id', v_got);
      end if;
    end loop;
  end loop;

  -- Keep the device registry warm in the same transaction as the push, so
  -- "last synced" on the Your Devices screen cannot drift from reality.
  if payload ? 'device_id' then
    update public.user_devices
       set last_seen_at = now()
     where device_id = payload->>'device_id'
       and user_id = (select auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'applied', v_applied, 'remaps', v_remaps);
end
$$;

revoke all on function public.sync_push(jsonb) from anon;
grant execute on function public.sync_push(jsonb) to authenticated;
revoke all on function public.sync_apply_row(text, jsonb) from anon;
grant execute on function public.sync_apply_row(text, jsonb) to authenticated;
