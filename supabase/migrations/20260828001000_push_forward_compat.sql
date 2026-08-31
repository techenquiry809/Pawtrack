-- ============================================================================
-- Make sync_push tolerate clients that do not know about a column yet.
--
-- ── THE BUG ────────────────────────────────────────────────────────────────
--
-- sync_apply_row built its column list from the TABLE, then fed the incoming
-- JSON through jsonb_populate_record. A key the client did not send came back
-- as NULL and was written as NULL — so adding `daily_checkins.mood_only`
-- (NOT NULL) instantly broke every app version that predated it: their pushes
-- hit a not-null violation, and because the whole batch is one transaction,
-- NOTHING they had queued could sync. Not one table — all of them.
--
-- That is the worst shape of failure this system can have. App updates are not
-- instant, phones sit on old versions for months, and the users hurt most
-- would be the ones syncing least often — exactly the ones with the biggest
-- outbox of unsent seizure records.
--
-- Caught by supabase/tests/sync_push_test.sql, whose payload was written
-- before mood_only existed and therefore behaved precisely like an old client.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
--
-- Only write the columns the client actually SENT. On an insert, anything
-- absent takes its column default; on an update, it keeps the value already
-- there. Both are the right answer for a client that has never heard of the
-- column, and neither can be expressed by listing every column unconditionally.
--
-- This also makes every FUTURE column addition safe by construction, which the
-- previous version was not — with ONE rule that still has to be followed.
--
-- ── THE RULE: A NEW NOT NULL COLUMN NEEDS A DEFAULT ────────────────────────
--
-- ON CONFLICT builds the proposed tuple and validates NOT NULL BEFORE it
-- detects the conflict, so an omitted column still has to produce a legal row.
-- A new NOT NULL column WITH a default is filled in and everything works; a new
-- NOT NULL column WITHOUT one would strand every older client exactly as
-- mood_only briefly did.
--
-- `created_at` and `updated_at` are NOT NULL with no default and are therefore
-- always required — which is fine, because they have existed since the first
-- migration and every client has always sent them.
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
  v_known       int;
begin
  if p_table !~ '^[a-z_]+$' then
    raise exception 'sync_apply_row: refusing suspicious table name %', p_table;
  end if;

  v_id := p_row->>'id';
  if v_id is null then
    raise exception 'sync_apply_row: row for % has no id', p_table;
  end if;

  -- Does the table exist at all? Checked separately from the column list
  -- below, because that list is now legitimately allowed to come back empty.
  select count(*) into v_known
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table;
  if v_known = 0 then
    raise exception 'sync_apply_row: unknown table %', p_table;
  end if;

  -- Client-owned columns THE CLIENT ACTUALLY SENT. `p_row ? column_name` is
  -- the whole forward-compatibility fix: an older app that has never heard of
  -- a column simply does not write it.
  select array_agg(column_name::text order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = p_table
     and column_name <> 'id'
     and not (column_name = any (public.sync_server_owned_columns()))
     and p_row ? column_name;

  v_cols := coalesce(v_cols, '{}'::text[]);

  foreach v_col in array v_cols loop
    v_sel := v_sel || format('r.%I', v_col);

    -- §9's duration rule, enforced HERE rather than in the client, because a
    -- client-side rule is only as good as the oldest app version installed.
    if p_table = 'seizures' and v_col in ('duration_sec', 'duration_confidence') then
      v_assign := v_assign || format(
        '%1$I = case when public.duration_confidence_rank(excluded.duration_confidence)'
        ||          ' >= public.duration_confidence_rank(seizures.duration_confidence)'
        ||          ' then excluded.%1$I else seizures.%1$I end', v_col);
    else
      v_assign := v_assign || format('%1$I = excluded.%1$I', v_col);
    end if;
  end loop;

  v_insert_cols := 'id, user_id'
    || case when array_length(v_cols, 1) is null then ''
            else ', ' || array_to_string(
                   array(select format('%I', c) from unnest(v_cols) c), ', ') end;
  v_select_cols := 'r.id, (select auth.uid())'
    || case when array_length(v_sel, 1) is null then ''
            else ', ' || array_to_string(v_sel, ', ') end;

  -- With nothing but an id to write, there is no assignment list and DO UPDATE
  -- would be a syntax error. Touching updated_at is the honest no-op: the row
  -- was pushed, and nothing about it changed.
  v_set_list := case
    when array_length(v_assign, 1) is null then 'updated_at = ' || quote_ident(p_table) || '.updated_at'
    else array_to_string(v_assign, ', ')
  end;

  declare
    v_where text := format(
      '%1$I.deleted_at is null and (excluded.deleted_at is not null'
      || ' or excluded.updated_at >= %1$I.updated_at)', p_table);
  begin
    -- Natural-key tables: two phones can create the same check-in day or dose
    -- slot with different ids. They are one record; resolve onto the index.
    if p_table in ('daily_checkins', 'medication_doses') then
      v_conflict := case p_table
        when 'daily_checkins'   then '(dog_id, check_in_date) where deleted_at is null'
        else '(medication_id, dose_date, scheduled_hhmm) where deleted_at is null'
      end;

      execute format('select exists (select 1 from public.%I where id = $1)', p_table)
        into v_exists using v_id;

      if not v_exists then
        execute format(
          'insert into public.%1$I (%2$s)
           select %3$s from jsonb_populate_record(null::public.%1$I, $1) r
           on conflict %4$s do update set %5$s where %6$s
           returning id',
          p_table, v_insert_cols, v_select_cols, v_conflict, v_set_list, v_where)
          into v_out using p_row;

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

    execute format(
      'insert into public.%1$I (%2$s)
       select %3$s from jsonb_populate_record(null::public.%1$I, $1) r
       on conflict (id) do update set %4$s where %5$s
       returning id',
      p_table, v_insert_cols, v_select_cols, v_set_list, v_where)
      into v_out using p_row;
  end;

  return coalesce(v_out, v_id);
end
$$;

revoke all on function public.sync_apply_row(text, jsonb) from public, anon;
grant execute on function public.sync_apply_row(text, jsonb) to authenticated;
