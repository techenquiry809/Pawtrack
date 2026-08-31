-- ============================================================================
-- RLS cross-user smoke test.
--
-- Signs in as user B and tries, six different ways, to reach user A's dog.
-- Every one of them must fail. If any succeeds this script raises and the
-- transaction aborts, so a non-zero exit is the CI signal.
--
--   supabase db execute --file supabase/tests/rls_smoke_test.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_smoke_test.sql
--
-- Runs entirely inside a transaction that is ROLLED BACK at the end, so it is
-- safe against a database with real data in it — though you should still point
-- it at a local `supabase start` instance rather than production.
--
-- WHY THIS IS A TEST AND NOT A REVIEW
--
-- The app ships the public `anon` key. These policies are the only thing
-- separating one owner's veterinary records from another's, and the failure
-- mode of a missing `with check` is invisible: reads look correctly fenced
-- while writes are wide open. That is not a property you confirm by reading a
-- policy — case 3 below is exactly the bug, and it passes a read-only review.
-- ============================================================================

begin;

-- Superusers bypass RLS, which is what lets this block set up and tear down
-- rows on tables that are FORCE ROW LEVEL SECURITY.
set local role postgres;

do $$
declare
  user_a uuid := '00000000-0000-4000-a000-00000000000a';
  user_b uuid := '00000000-0000-4000-b000-00000000000b';
  seen   int;
  ok     boolean;
begin
  -- ── Fixtures ────────────────────────────────────────────────────────────
  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'a@rls.test', '', now(), now(), now(), '{}', '{}'),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'b@rls.test', '', now(), now(), now(), '{}', '{}')
  on conflict (id) do nothing;

  -- A's dog and one seizure on it, written as A.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_a, 'role', 'authenticated')::text,
                     true);
  set local role authenticated;

  insert into public.dogs (id, name, created_at, updated_at)
  values ('dog_a', 'Lucy', 1, 1);

  insert into public.seizures (id, dog_id, "start", created_at, updated_at)
  values ('seiz_a', 'dog_a', 1000, 1, 1);

  -- Sanity: A can see A's own rows. If this fails the policy is too tight and
  -- every later assertion would pass for the wrong reason.
  select count(*) into seen from public.dogs where id = 'dog_a';
  if seen <> 1 then
    raise exception
      'RLS SMOKE FAIL (sanity): user A cannot read their own dog (saw % rows)', seen;
  end if;

  -- ── Now become user B ───────────────────────────────────────────────────
  reset role;
  set local role postgres;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_b, 'role', 'authenticated')::text,
                     true);
  set local role authenticated;

  -- 1. SELECT another user's dog.
  select count(*) into seen from public.dogs where id = 'dog_a';
  if seen <> 0 then
    raise exception
      'RLS SMOKE FAIL (1/6): user B can SELECT user A''s dog (saw % rows)', seen;
  end if;

  -- 2. SELECT another user's seizure. Checked separately from the dog because
  --    a policy can easily be applied to one table and forgotten on another.
  select count(*) into seen from public.seizures where id = 'seiz_a';
  if seen <> 0 then
    raise exception
      'RLS SMOKE FAIL (2/6): user B can SELECT user A''s seizure (saw % rows)', seen;
  end if;

  -- 3. INSERT a row owned by someone else.
  --    THE `with check` TEST. Without that clause this succeeds and B can
  --    plant rows inside A's account.
  ok := false;
  begin
    insert into public.dogs (id, user_id, name, created_at, updated_at)
    values ('dog_b_forged', user_a, 'Forged', 1, 1);
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then
    raise exception
      'RLS SMOKE FAIL (3/6): user B can INSERT a dog owned by user A';
  end if;

  -- 4. UPDATE another user's row. Invisible to B, so this must touch nothing
  --    rather than error.
  update public.dogs set name = 'Hijacked' where id = 'dog_a';
  get diagnostics seen = row_count;
  if seen <> 0 then
    raise exception
      'RLS SMOKE FAIL (4/6): user B UPDATEd % of user A''s dog rows', seen;
  end if;

  -- 5. DELETE another user's row.
  delete from public.dogs where id = 'dog_a';
  get diagnostics seen = row_count;
  if seen <> 0 then
    raise exception
      'RLS SMOKE FAIL (5/6): user B DELETEd % of user A''s dog rows', seen;
  end if;

  -- 6. Re-assign one's OWN row to another user.
  --    The subtler half of `with check`: B owns this row, so `using` permits
  --    the update; only the check constraint stops the handover.
  insert into public.dogs (id, name, created_at, updated_at)
  values ('dog_b', 'Max', 1, 1);

  ok := false;
  begin
    update public.dogs set user_id = user_a where id = 'dog_b';
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then
    raise exception
      'RLS SMOKE FAIL (6/6): user B can re-assign their own dog to user A';
  end if;

  reset role;
  raise notice 'RLS SMOKE PASS: all 6 cross-user attempts were correctly denied.';
end
$$;

-- Nothing above is meant to persist.
rollback;
