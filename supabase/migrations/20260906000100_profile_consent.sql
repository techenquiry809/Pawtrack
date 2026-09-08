-- ============================================================================
-- Consent moves into the account.
--
-- ── WHAT CHANGED AND WHY ───────────────────────────────────────────────────
--
-- Agreement to the Terms and the Privacy Policy used to be a DEVICE fact,
-- recorded in local SQLite, because the app could be used with no account at
-- all. An account is now required before anything else happens, so the device
-- is the wrong place to record it:
--
--   * The same person on a second phone would be asked again, having already
--     agreed, and there would be no record connecting the two.
--   * A device wipe erased the only evidence that anyone had ever agreed.
--   * "Who accepted which version, and when" could not be answered at all —
--     which is the one question this record exists to answer.
--
-- So it belongs to the USER, next to the rest of their profile, under the same
-- RLS policy that already fences that row.
--
-- ── WHY THREE COLUMNS AND NOT A BOOLEAN ────────────────────────────────────
--
-- A boolean answers "did they agree?" but not "to what?". The two documents
-- are versioned independently (src/constants/legal.ts), and when either
-- changes, everyone must be asked again — a boolean would leave every existing
-- user marked as having accepted text they have never seen, with nothing able
-- to tell the difference. Storing the accepted VERSION of each makes the
-- re-prompt automatic and needs no backfill.
--
-- All three are NULLABLE. A profile row can be written by reconcileProfile()
-- before the consent screen has been answered, and a NOT NULL here would make
-- that insert fail — turning "we have not asked yet" into a broken sign-in.
-- NULL means exactly that: not asked, or not yet answered.
-- ============================================================================

alter table public.profiles
  add column if not exists terms_version   text,
  add column if not exists privacy_version text,
  -- Epoch milliseconds, matching created_at/updated_at on this table rather
  -- than introducing a second time representation into one row.
  add column if not exists consented_at    bigint;

comment on column public.profiles.terms_version is
  'Version string of the Terms of Service this user accepted. NULL = never asked or never answered. Compared against TERMS_VERSION in src/constants/legal.ts.';
comment on column public.profiles.privacy_version is
  'Version string of the Privacy Policy this user accepted. NULL = never asked or never answered.';
comment on column public.profiles.consented_at is
  'Epoch milliseconds when the versions above were accepted.';

-- No new policy and no new grant: these are columns on a table that already
-- has "own profile" (for all, using AND with check on user_id = auth.uid())
-- and already grants select/insert/update to `authenticated`. A column-level
-- grant here would be redundant at best and, if it drifted from the table
-- grant, actively confusing.
--
-- Deliberately NOT added to the sync manifest either. profiles is written
-- directly by the client under RLS, not through sync_push, so these columns
-- never travel through the outbox.
