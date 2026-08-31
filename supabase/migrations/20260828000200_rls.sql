-- ============================================================================
-- Row Level Security.
--
-- RLS IS THE ENTIRE SECURITY MODEL. The app ships the `anon` key, which is
-- public by design — anyone who installs the app has it, and anyone who wants
-- it can pull it out of the bundle. Nothing but these policies stands between
-- one owner's veterinary records and another's.
--
-- That is why 20260828000300_rls_smoke_test.sql exists and why it belongs in
-- CI. A policy is not the kind of thing to verify by reading it.
--
-- ── BOTH CLAUSES, ALWAYS ───────────────────────────────────────────────────
--
--   using      — which existing rows this user may SEE (select/update/delete)
--   with check — which rows this user may WRITE (insert/update)
--
-- Omitting `with check` is the classic mistake: reads are correctly fenced,
-- and the client can still INSERT a row with someone else's user_id in it, or
-- UPDATE one of its own rows to hand it to another account. Every policy below
-- carries both.
--
-- `user_id` defaults to auth.uid() on every table, so a client that simply
-- omits the column gets the right answer; the with-check is what stops one
-- that supplies the wrong answer deliberately.
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
    execute format('alter table public.%I enable row level security', t);

    -- FORCE applies RLS to the table owner too. Without it, anything that
    -- happens to connect as the owning role bypasses every policy above —
    -- including a SECURITY DEFINER function that was not written carefully.
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I
         for all
         to authenticated
         using      (user_id = (select auth.uid()))
         with check  (user_id = (select auth.uid()))', t
    );
  end loop;
end
$$;

-- The anon role has no business here at all. Only a signed-in user syncs.
-- (`authenticated` is granted the table privileges it needs by Supabase's
-- default grants; RLS narrows those to the user's own rows.)
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
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- Clients never advance the cursor sequence themselves.
--
-- The BEFORE trigger does it, and it is SECURITY DEFINER precisely so that it
-- still can after this revoke — see the note on stamp_sync_seq() in
-- 20260828000100_core_schema.sql. Without that pairing this line breaks every
-- insert on every table, which is what the RLS smoke test caught.
revoke all on sequence public.sync_seq_global from anon, authenticated;
