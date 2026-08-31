-- ============================================================================
-- Check-ins created by a single mood tap.
--
-- Home's "How is <dog>'s day?" row now saves the moment a face is tapped, so it
-- can create today's row rather than only edit an existing one.
--
-- The columns it cannot fill honestly are the problem: `stress` is NOT NULL
-- DEFAULT 2 and appetite/water/gi default to 'normal', so a row conjured from
-- one tap would assert ratings the owner never gave. These rows are the
-- CONTROL DATASET the seizure analysis measures against — a fabricated one is
-- worse than an absent one.
--
-- This flag marks the row as "the energy value is real, nothing else here is".
-- Readers exclude it from anything that consumes the other fields.
-- ============================================================================

alter table public.daily_checkins
  add column if not exists mood_only boolean not null default false;
