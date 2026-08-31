-- ============================================================================
-- Per-phase symptom notes on a video.
--
-- What the owner saw before, during and after the seizure in THIS clip.
-- Distinct from the seizure's own structured observations: these describe the
-- FOOTAGE, and exist mainly for imported clips where there was never a live
-- capture and the seizure row is thin.
--
-- NOT NULL DEFAULT '' so an older client that omits them still writes a legal
-- row — see 20260828001000_push_forward_compat.sql for why a new NOT NULL
-- column without a default would strand every app version that predates it.
-- ============================================================================

alter table public.videos add column if not exists pre_note   text not null default '';
alter table public.videos add column if not exists ictal_note text not null default '';
alter table public.videos add column if not exists post_note  text not null default '';
