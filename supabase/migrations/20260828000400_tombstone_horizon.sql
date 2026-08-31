-- ============================================================================
-- Tombstone horizon and the purge job.
--
-- Tombstones cannot be kept forever — a row that is deleted once stays in the
-- table for the rest of the account's life otherwise, and every full resync
-- pays for it. But they cannot simply be dropped either: a device whose cursor
-- predates the purge never learns the row was deleted, and would happily push
-- it back.
--
-- So the purge publishes a HORIZON, and any device sitting behind it stops
-- trying to catch up incrementally and does a full resync instead. Rare,
-- correct, and much simpler than trying to reconcile a gap.
--
-- ── WHY THE HORIZON IS A SEQUENCE NUMBER, NOT A DATE ───────────────────────
--
-- The client's cursor is a sync_seq. Publishing the horizon as a timestamp
-- would force the client to compare two things measured in different units and
-- guess at the mapping between them — and the whole reason this design uses a
-- sequence is that timestamps from different clocks cannot be ordered safely.
-- The horizon is the highest sync_seq that has been purged, so the test on the
-- client is a plain integer comparison against the cursor it already holds.
-- ============================================================================

create table if not exists public.sync_meta (
  id                     boolean primary key default true check (id),
  tombstone_horizon_seq  bigint      not null default 0,
  purged_at              timestamptz,
  retention_days         int         not null default 90
);

insert into public.sync_meta (id) values (true) on conflict (id) do nothing;

alter table public.sync_meta enable row level security;

-- Every signed-in device must be able to read the horizon on each pull — it is
-- the check that tells them whether an incremental pull is still valid. It is
-- one row of non-identifying operational metadata, shared by all users.
drop policy if exists "read horizon" on public.sync_meta;
create policy "read horizon" on public.sync_meta
  for select to authenticated using (true);

revoke all on public.sync_meta from anon;
grant select on public.sync_meta to authenticated;

-- ============================================================================
-- The purge.
--
-- Hard-deletes tombstones older than the retention window and advances the
-- horizon to the highest sync_seq removed. Runs as the service role.
-- ============================================================================
create or replace function public.purge_tombstones()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tables text[] := array[
    'dogs', 'seizures', 'videos', 'seizure_edits', 'medications',
    'medication_reminders', 'medication_doses', 'daily_checkins', 'meals'
  ];
  v_table   text;
  v_cutoff  bigint;
  v_days    int;
  v_max     bigint;
  v_horizon bigint := 0;
begin
  select retention_days into v_days from public.sync_meta where id;

  -- deleted_at is epoch MILLISECONDS, matching the client. Everything else in
  -- this file is a timestamptz, so the conversion happens exactly here.
  v_cutoff := (extract(epoch from (now() - make_interval(days => v_days))) * 1000)::bigint;

  foreach v_table in array v_tables loop
    -- Children first: deleting a tombstoned parent would cascade its
    -- still-live children away. Ordering the array parent-last would be
    -- fragile, so instead the delete is scoped to rows whose own tombstone is
    -- old enough, and FK cascade only ever reaches rows that are themselves
    -- tombstoned, because a tombstoned parent's children are tombstoned in the
    -- same local transaction (see src/db/tombstone.ts).
    execute format(
      'with gone as (
         delete from public.%I
          where deleted_at is not null and deleted_at < $1
          returning sync_seq
       ) select max(sync_seq) from gone', v_table)
      into v_max using v_cutoff;

    if v_max is not null and v_max > v_horizon then
      v_horizon := v_max;
    end if;
  end loop;

  if v_horizon > 0 then
    update public.sync_meta
       set tombstone_horizon_seq = greatest(tombstone_horizon_seq, v_horizon),
           purged_at = now()
     where id;
  end if;

  return v_horizon;
end
$$;

revoke all on function public.purge_tombstones() from anon, authenticated;

-- ============================================================================
-- Schedule it. Requires the pg_cron extension (Database → Extensions in the
-- Supabase dashboard). If pg_cron is not available this block is skipped and
-- the function can be driven by any external scheduler instead — the purge is
-- idempotent, so running it twice is harmless and missing a night is too.
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('pawtrack-purge-tombstones')
      where exists (select 1 from cron.job where jobname = 'pawtrack-purge-tombstones');

    perform cron.schedule(
      'pawtrack-purge-tombstones',
      '17 3 * * *',                       -- 03:17 UTC daily, off the hour
      'select public.purge_tombstones()'
    );
  else
    raise notice
      'pg_cron not installed — schedule public.purge_tombstones() externally.';
  end if;
end
$$;
