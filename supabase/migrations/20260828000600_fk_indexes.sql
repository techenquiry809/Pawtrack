-- ============================================================================
-- Indexes on foreign key columns.
--
-- Postgres does NOT index a foreign key column for you. It indexes the
-- referenced side (that is the primary key) and leaves the referencing side
-- bare, so every JOIN across it and — the part that bites here — every
-- ON DELETE CASCADE has to sequentially scan the child table.
--
-- ── WHY THIS IS NOT THEORETICAL FOR THIS SCHEMA ────────────────────────────
--
-- Three paths in this app fire real cascades over real volumes:
--
--   1. delete_own_account() deletes one row from auth.users and lets the
--      cascade take out that user's ENTIRE dataset across nine tables. With
--      the referencing columns unindexed, that is nine sequential scans of
--      every row in each table — everyone's rows, not just the leaving user's
--      — while holding locks. It is the slowest possible way to honour a
--      GDPR deletion request, and it gets slower with every user who stays.
--
--   2. claim.ts's discardUnclaimedData() hard-deletes unclaimed rows with the
--      foreign keys live.
--
--   3. Deleting a dog on the server cascades to seizures, videos, edits,
--      medications, reminders, doses, check-ins and meals.
--
-- ── WHY THE PARTIAL UNIQUE INDEXES DO NOT COUNT ────────────────────────────
--
-- daily_checkins already has a unique index leading with dog_id, and
-- medication_doses one leading with medication_id — but both carry
-- `where deleted_at is null`. A partial index only covers rows matching its
-- predicate, so the planner cannot use it to find the tombstoned rows a
-- cascade still has to delete. They look like coverage in a schema diagram
-- and are not coverage at all.
--
-- Found with the detection query at the bottom of this file, not by reading
-- the schema — which is the point: the gap is invisible to inspection and
-- obvious to the catalog.
-- ============================================================================

-- Children of dogs. dog_id was denormalised onto these three by local
-- migration 9 so tombstones could cascade without a join; that made them
-- foreign keys, and foreign keys need this.
create index if not exists videos_dog_idx
  on public.videos (dog_id);

create index if not exists seizure_edits_dog_idx
  on public.seizure_edits (dog_id);

create index if not exists medication_reminders_dog_idx
  on public.medication_reminders (dog_id);

create index if not exists meals_dog_idx
  on public.meals (dog_id);

-- Full, not partial — see the note above. The existing
-- daily_checkins_dog_date_idx is `where deleted_at is null` and cannot serve
-- a cascade that has to reach tombstoned rows.
create index if not exists daily_checkins_dog_idx
  on public.daily_checkins (dog_id);

-- Children of medications. Same reasoning: medication_doses_slot_idx is
-- partial and does not cover tombstones.
create index if not exists medication_reminders_med_idx
  on public.medication_reminders (medication_id);

create index if not exists medication_doses_med_idx
  on public.medication_doses (medication_id);

-- device_alerts is written by a trigger and drained by the alert sender using
-- the service role. Its user_id cascade fires on account deletion like every
-- other table's.
create index if not exists device_alerts_user_idx
  on public.device_alerts (user_id);

-- ============================================================================
-- The check, kept next to the fix.
--
-- Run this after adding a table or a column. It returns rows only when a
-- foreign key has no index that can actually serve it:
--
--   indkey[0] — the FK column must LEAD the index. A composite index on
--               (a, b) does nothing for a lookup on b alone.
--   indpred is null — a partial index does not cover the rows outside its
--               predicate, so it cannot be relied on for a cascade.
--
--   select conrelid::regclass::text as tbl, a.attname as fk_column
--     from pg_constraint c
--     join pg_attribute a
--       on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
--    where c.contype = 'f'
--      and c.connamespace = 'public'::regnamespace
--      and not exists (
--        select 1 from pg_index i
--         where i.indrelid = c.conrelid
--           and a.attnum = i.indkey[0]
--           and i.indpred is null
--      )
--    order by 1, 2;
--
-- It should return zero rows. It returned eight before this migration.
-- ============================================================================
