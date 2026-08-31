-- ============================================================================
-- Privilege hardening.
--
-- Two problems, both invisible in the migration that created them.
-- ============================================================================


-- ── 1. REVOKING FROM A ROLE DOES NOT REVOKE FROM PUBLIC ────────────────────
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- `anon` / `authenticated` inherit from PUBLIC. So this, in
-- 20260828000400_tombstone_horizon.sql:
--
--     revoke all on function public.purge_tombstones() from anon, authenticated;
--
-- did nothing at all. It removed grants those roles never held individually
-- and left the PUBLIC grant untouched. The function's ACL still read `=X/postgres`
-- — the bare `=` being PUBLIC — and an UNAUTHENTICATED caller holding only the
-- public anon key could run it.
--
-- purge_tombstones() is SECURITY DEFINER and hard-deletes tombstoned rows
-- across every table for every user, then advances the global tombstone
-- horizon. Damage is bounded — it only removes rows already past the retention
-- window, and only accelerates work the nightly job would do anyway — but
-- advancing the horizon forces every device whose cursor falls behind it into
-- a full resync. That is an unauthenticated party causing every phone on the
-- service to re-download its entire history.
--
-- The correct revoke names PUBLIC. Note that delete_own_account() was already
-- written as `from anon, public` and was therefore never exposed; the
-- difference between the two lines is the whole bug.
revoke all on function public.purge_tombstones() from public, anon, authenticated;

-- The two SECURITY DEFINER trigger functions carry the same default PUBLIC
-- grant. Postgres refuses to invoke a trigger function directly ("trigger
-- functions can only be called as triggers"), so neither is reachable — but a
-- SECURITY DEFINER function in an exposed schema should not be left callable
-- on the strength of a parser check. Revoking costs nothing and does not
-- affect the triggers: trigger execution does not test EXECUTE against the
-- user running the DML.
revoke all on function public.stamp_sync_seq() from public, anon, authenticated;
revoke all on function public.alert_on_new_device() from public, anon, authenticated;


-- ── 2. BE EXPLICIT ABOUT DATA API ACCESS ───────────────────────────────────
--
-- Table access for `anon` / `authenticated` has been relying on Supabase's
-- default privileges. That usually works, and when it does not the failure is
-- a bare "permission denied for table dogs" on a device's very first sync,
-- with RLS looking like the culprit when it is not involved at all. Being
-- explicit removes a whole category of confusing support ticket.
--
-- ── WHY NO DELETE ──────────────────────────────────────────────────────────
--
-- Deliberately select/insert/update only. Nothing in the client ever hard
-- deletes a server row:
--
--   * every user-facing delete is a tombstone, which is an UPDATE
--   * purge_tombstones() and delete_own_account() are SECURITY DEFINER and run
--     with their own privileges
--   * discardUnclaimedData() operates on local SQLite only
--
-- So withholding DELETE costs nothing and buys a real property: a stolen or
-- misused access token cannot destroy a seizure record. The worst it can do is
-- tombstone one, which is recoverable for the whole retention window and is
-- replicated as a normal row that other devices can be reconciled against.
do $$
declare
  t text;
begin
  foreach t in array array[
    'dogs', 'seizures', 'videos', 'seizure_edits', 'medications',
    'medication_reminders', 'medication_doses', 'daily_checkins', 'meals',
    'user_settings', 'user_devices'
  ]
  loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
    -- Re-assert the anon revoke. Only a signed-in user syncs, and RLS would
    -- return nothing to anon in any case, but a table reachable by anon is a
    -- table one forgotten policy away from being readable by anon.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- device_alerts stays fully private: written by a trigger, read only by the
-- alert sender using the service role.
revoke all on public.device_alerts from anon, authenticated;

-- The tombstone horizon is one row of non-identifying operational metadata
-- that every signed-in device must read on each pull.
grant select on public.sync_meta to authenticated;
revoke all on public.sync_meta from anon;
