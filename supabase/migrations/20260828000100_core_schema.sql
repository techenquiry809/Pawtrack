-- ============================================================================
-- Pawtrack sync target — core schema.
--
-- This mirrors the app's local SQLite schema (migrations 1..9). SQLite on the
-- phone remains the source of truth; nothing here is ever read directly by a
-- screen. These tables exist only so a device can push what it has and pull
-- what it missed.
--
-- ── THREE DELIBERATE DEVIATIONS FROM A LITERAL MIRROR ──────────────────────
--
-- 1. `end` is a RESERVED word in PostgreSQL (CASE ... END, END TRANSACTION).
--    SQLite tolerates it unquoted; PostgreSQL does not, and `create table
--    (... end bigint ...)` fails outright. The column keeps its name so the
--    client's column manifest stays mechanical, but every reference to it in
--    this schema and in sync_push is quoted as "end". `position`, `timestamp`
--    and `start` are quoted for the same defensive reason.
--
-- 2. Epoch-millisecond columns stay `bigint`, not `timestamptz`.
--    Local SQLite stores every instant as INTEGER epoch ms. Converting on both
--    ends of every push and pull is a per-column rule that only has to be
--    wrong once to corrupt a seizure time. `deleted_at` is bigint for the same
--    reason, even though the spec drafted it as timestamptz — the purge job
--    converts with to_timestamp() at the single point where a date is needed.
--    `server_updated_at` IS timestamptz: it is server-owned and never round
--    trips to a client column.
--
-- 3. JSON columns stay `text`, not `jsonb`.
--    The client stores them as serialized text and hands them back verbatim.
--    jsonb would reformat and reorder keys on every round trip, so a row would
--    come back differing from the row that was sent while meaning the same
--    thing. Nothing server-side queries inside them, so there is no gain to
--    weigh against that.
--
-- Booleans DO become real `boolean` (SQLite has them as 0/1); the client's
-- column manifest declares the type and converts. That one conversion is worth
-- it because these columns are worth querying.
-- ============================================================================

-- ── The pull cursor ────────────────────────────────────────────────────────
-- ONE global sequence, not one per table and not a timestamp.
--
-- A timestamp cursor skips rows: two phones whose clocks differ by 40 seconds
-- can have a row committed with a `now()` that is already behind a cursor a
-- puller has advanced past, and that row is then never seen again. A sequence
-- is monotonic by construction and owned by a single process, so `sync_seq >
-- cursor` cannot skip. This is the same reasoning the app already applies to
-- seizure duration in src/utils/clock.ts: do not trust a wall clock with data
-- you cannot reconstruct.
create sequence if not exists public.sync_seq_global;

-- Stamps the two server-owned columns on every write. Clients never set these;
-- sync_push strips them from incoming payloads.
--
-- ── WHY THIS IS SECURITY DEFINER ───────────────────────────────────────────
--
-- A trigger function runs as the CALLING user by default, and the RLS
-- migration revokes the sequence from `authenticated` so a client cannot burn
-- cursor values by calling nextval() itself. Those two facts collide: with the
-- default (INVOKER), this function executes as `authenticated`, hits the
-- revoke, and EVERY insert fails with "permission denied for sequence".
--
-- Caught by supabase/tests/rls_smoke_test.sql, which is the argument for
-- having it: the failure is total and would have shown up as the first sync
-- any real device ever attempted.
--
-- DEFINER is safe here and narrowly so. The function takes no parameters,
-- reads nothing, returns nothing but NEW, and can only ever assign two
-- server-owned columns — there is no input for a caller to steer. search_path
-- is pinned so the sequence reference cannot be captured by a temp object.
create or replace function public.stamp_sync_seq()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.sync_seq          := nextval('public.sync_seq_global');
  new.server_updated_at := now();
  return new;
end
$$;

-- ============================================================================
-- dogs
-- ============================================================================
-- NOT synced: photo_uri. A file:// path from device A resolves to nothing on
-- device B, and iOS reassigns the container UUID on reinstall anyway (see
-- src/services/fileStore.ts). The column stays local-only.
create table if not exists public.dogs (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,

  name                text    not null,
  breed_id            text,
  breed_name          text    not null default '',
  breed_source        text    not null default '',
  breed_user_desc     text    not null default '',
  sex                 text    not null default '',
  age_years           real,
  weight_kg           real,
  dob                 text    not null default '',
  diagnosis_status    text    not null default 'undiagnosed',
  first_seizure_date  text    not null default '',
  seizure_type        text    not null default '',
  allergies           text    not null default '',
  diet                text    not null default '',
  vet_json            text    not null default '{}',
  emergency_vet_json  text    not null default '{}',
  emergency_plan_json text    not null default '{}',
  created_at          bigint  not null,
  updated_at          bigint  not null,

  deleted_at          bigint,
  sync_seq            bigint  not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists dogs_user_seq_idx on public.dogs (user_id, sync_seq);

-- ============================================================================
-- seizures
-- ============================================================================
create table if not exists public.seizures (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  dog_id              text not null references public.dogs(id) on delete cascade,

  "start"             bigint  not null,
  "end"               bigint,
  duration_sec        integer not null default 0,
  timing_confidence   text    not null default 'exact',
  retrospective       boolean not null default false,
  pre_ictal_obs       text    not null default '[]',
  pre_ictal_note      text    not null default '',
  ictal_obs           text    not null default '[]',
  awareness           text,
  autonomic           text    not null default '[]',
  "position"          text,
  post_behavior       text    not null default '[]',
  severity_owner      text,
  recovery_start      bigint,
  recovery_end        bigint,
  recovery_sec        integer,
  context_json        text    not null default '{}',
  notes               text    not null default '',
  time_since_prev_sec integer,

  -- Record lifecycle, from local migration 3. 'in_progress' rows DO sync:
  -- a phone that dies mid-seizure and never comes back should not take the
  -- partial record with it. Readers filter on status, exactly as they do
  -- locally.
  status              text    not null default 'complete',
  duration_confidence text    not null default 'legacy',
  last_touched_at     bigint,
  tz_offset_min       integer,

  created_at          bigint  not null,
  updated_at          bigint  not null,

  deleted_at          bigint,
  sync_seq            bigint  not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists seizures_user_seq_idx on public.seizures (user_id, sync_seq);
create index if not exists seizures_dog_start_idx on public.seizures (dog_id, "start" desc);

-- ============================================================================
-- videos — clinical metadata only. The bytes never leave the phone.
-- ============================================================================
-- NOT synced: file_uri, thumb_uri. Those live in the local-only `video_files`
-- table (local migration 9). A video is present on this device iff a
-- video_files row exists; that is the whole test.
--
-- The row itself IS clinical data — "a recording exists for this seizure" is
-- meaningful to a vet even on a device that cannot play it — so the row syncs
-- and device B renders a designed "stored on the phone that recorded it" state
-- rather than a broken tile.
--
-- dog_id is denormalized from the parent seizure. It is not in the local
-- schema; migration 9 adds it there too. Two reasons: it lets a tombstone
-- cascade and an RLS policy reach a video without joining through seizures,
-- and it is the column a future dog_members join would key on.
create table if not exists public.videos (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  dog_id              text not null references public.dogs(id) on delete cascade,
  seizure_id          text not null references public.seizures(id) on delete cascade,

  "source"            text    not null,
  "timestamp"         bigint  not null,
  imported_at         bigint  not null default 0,
  capture_confidence  text    not null default 'device',
  duration_sec        integer,
  note                text    not null default '',

  -- Which physical phone recorded this. Joins to user_devices so a tile can
  -- say "Recorded on Sam's iPhone" instead of printing a UUID, and gives a
  -- future device-to-device transfer something to target.
  origin_device_id    text,

  -- Not in the local schema before migration 9. The videos table had no
  -- row-mutation timestamp at all, which left last-write-wins with nothing to
  -- compare.
  created_at          bigint  not null,
  updated_at          bigint  not null,

  deleted_at          bigint,
  sync_seq            bigint  not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists videos_user_seq_idx on public.videos (user_id, sync_seq);
create index if not exists videos_seizure_idx on public.videos (seizure_id);

-- ============================================================================
-- seizure_edits — the audit trail
-- ============================================================================
-- Append-only in practice: rows are written by updateSeizure() and never
-- edited. It still carries updated_at and deleted_at so it moves through the
-- same generic sync machinery as everything else rather than needing a special
-- case, and so a tombstoned seizure can tombstone its edit history with it.
create table if not exists public.seizure_edits (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  dog_id              text not null references public.dogs(id) on delete cascade,
  seizure_id          text not null references public.seizures(id) on delete cascade,

  edited_at           bigint not null,
  summary             text   not null,

  updated_at          bigint not null,
  deleted_at          bigint,
  sync_seq            bigint not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists seizure_edits_user_seq_idx on public.seizure_edits (user_id, sync_seq);
create index if not exists seizure_edits_seizure_idx on public.seizure_edits (seizure_id, edited_at desc);

-- ============================================================================
-- medications
-- ============================================================================
-- NOT synced: scheduled_time and notification_id. Both have been dead since
-- local migration 4 moved reminders to their own table, and notification_id is
-- device-local by the same argument as medication_reminders.notification_id
-- below.
create table if not exists public.medications (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  dog_id              text not null references public.dogs(id) on delete cascade,

  name                text   not null,
  dose                text   not null default '',
  unit                text   not null default '',
  frequency           text   not null default '',
  prescriber          text   not null default '',

  created_at          bigint not null,
  updated_at          bigint not null,

  deleted_at          bigint,
  sync_seq            bigint not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists medications_user_seq_idx on public.medications (user_id, sync_seq);
create index if not exists medications_dog_idx on public.medications (dog_id);

-- ============================================================================
-- medication_reminders
-- ============================================================================
-- NOT synced: notification_id.
--
-- This is the single easiest column to sync by accident and the bug it causes
-- is the nastiest in the whole design. notification_id is a handle returned by
-- expo-notifications on ONE device. Device B cannot cancel device A's handle,
-- so a synced value produces a reminder that cannot be turned off from the
-- phone in your hand. Each device schedules and owns its own notification for
-- a shared reminder row.
create table if not exists public.medication_reminders (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  dog_id              text not null references public.dogs(id) on delete cascade,
  medication_id       text not null references public.medications(id) on delete cascade,

  -- Local wall-clock 'HH:MM', 24h. A clock time, never an instant, so 8am
  -- stays 8am after the owner changes timezone.
  time_hhmm           text    not null,
  enabled             boolean not null default true,

  created_at          bigint  not null,
  updated_at          bigint  not null,

  deleted_at          bigint,
  sync_seq            bigint  not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists medication_reminders_user_seq_idx
  on public.medication_reminders (user_id, sync_seq);

-- The same time twice on one medication is always a mistake. Partial, so a
-- tombstoned reminder does not block re-adding that time later.
create unique index if not exists medication_reminders_med_time_idx
  on public.medication_reminders (medication_id, time_hhmm)
  where deleted_at is null;

-- ============================================================================
-- medication_doses
-- ============================================================================
create table if not exists public.medication_doses (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  dog_id              text not null references public.dogs(id) on delete cascade,
  medication_id       text not null references public.medications(id) on delete cascade,

  dose_date           text   not null,
  scheduled_hhmm      text   not null default '',
  status              text   not null,
  recorded_at         bigint not null,
  note                text   not null default '',

  created_at          bigint not null,
  -- Added by local migration 9; the table had only created_at/recorded_at.
  updated_at          bigint not null,

  deleted_at          bigint,
  sync_seq            bigint not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists medication_doses_user_seq_idx
  on public.medication_doses (user_id, sync_seq);
create index if not exists medication_doses_dog_date_idx
  on public.medication_doses (dog_id, dose_date desc);

-- Two phones logging the same dose is ONE dose. This unique key is what
-- sync_push resolves onto — see §9 of the spec.
create unique index if not exists medication_doses_slot_idx
  on public.medication_doses (medication_id, dose_date, scheduled_hhmm)
  where deleted_at is null;

-- ============================================================================
-- daily_checkins
-- ============================================================================
create table if not exists public.daily_checkins (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  dog_id              text not null references public.dogs(id) on delete cascade,

  "timestamp"         bigint  not null,
  -- LOCAL calendar day 'YYYY-MM-DD' at the moment of capture. Deliberately
  -- capture-local and left that way: a check-in at 11pm belongs to the day the
  -- owner thinks it does. A user who travels can produce two rows for "the
  -- same" day; that is the accepted cost of the day key meaning what the owner
  -- meant.
  check_in_date       text    not null default '',
  sleep_hrs           real,
  appetite            text    not null default 'normal',
  water               text    not null default 'normal',
  energy              integer not null default 3,
  stress              integer not null default 2,
  med_on_time         boolean not null default true,
  gi                  text    not null default 'none',
  unusual             text    not null default '',
  backfilled          boolean not null default false,

  created_at          bigint  not null,
  updated_at          bigint  not null,

  deleted_at          bigint,
  sync_seq            bigint  not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists daily_checkins_user_seq_idx
  on public.daily_checkins (user_id, sync_seq);

-- One check-in per dog per local day. Merge, never duplicate — sync_push
-- resolves onto this key rather than inserting a second row.
create unique index if not exists daily_checkins_dog_date_idx
  on public.daily_checkins (dog_id, check_in_date)
  where deleted_at is null;

-- ============================================================================
-- meals
-- ============================================================================
-- NOTE: this table is currently DEAD in the app. It has a schema (MealSchema
-- in src/types/domain.ts) and a local table, but no repository and no screen
-- reads or writes it. It is mirrored here so that the day a meal log ships,
-- sync already covers it and no schema migration is needed on live data.
create table if not exists public.meals (
  id                  text primary key,
  user_id             uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  dog_id              text not null references public.dogs(id) on delete cascade,

  "timestamp"         bigint  not null,
  description         text    not null default '',
  is_new_food         boolean not null default false,

  created_at          bigint  not null,
  -- Added by local migration 9; the table had only created_at.
  updated_at          bigint  not null,

  deleted_at          bigint,
  sync_seq            bigint  not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists meals_user_seq_idx on public.meals (user_id, sync_seq);

-- ============================================================================
-- user_settings — one row per user
-- ============================================================================
-- Settings are a single validated JSON blob locally (app_state 'settings',
-- parsed by SettingsSchema). Keeping that shape means adding a setting never
-- requires a server migration.
--
-- NOT synced into this: the active-dog selection. That is a per-device UI
-- preference, not a fact about the dog — an iPad showing Lucy should not flip
-- to Max because the phone did.
create table if not exists public.user_settings (
  user_id             uuid primary key default auth.uid()
                        references auth.users(id) on delete cascade,
  settings_json       text   not null default '{}',

  updated_at          bigint not null,
  deleted_at          bigint,
  sync_seq            bigint not null,
  server_updated_at   timestamptz not null default now()
);
create index if not exists user_settings_user_seq_idx
  on public.user_settings (user_id, sync_seq);

-- ============================================================================
-- Attach the sequence trigger to every synced table
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'dogs', 'seizures', 'videos', 'seizure_edits', 'medications',
    'medication_reminders', 'medication_doses', 'daily_checkins', 'meals',
    'user_settings'
  ]
  loop
    execute format(
      'drop trigger if exists stamp_sync_seq_%1$s on public.%1$I', t
    );
    execute format(
      'create trigger stamp_sync_seq_%1$s
         before insert or update on public.%1$I
         for each row execute function public.stamp_sync_seq()', t
    );
  end loop;
end
$$;
