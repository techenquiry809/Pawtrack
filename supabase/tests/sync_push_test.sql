-- ============================================================================
-- sync_push: the conflict rules, end to end.
--
-- These are the rules that decide which of two phones' versions of a seizure
-- record survives. They are enforced server-side rather than in the client for
-- one reason: a client-side rule is only as good as the OLDEST app version
-- still installed, and an owner on a two-year-old build would quietly
-- overwrite a stopwatch measurement with a guess.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sync_push_test.sql
--
-- Runs inside a transaction that is rolled back. Raises on the first failure,
-- so a non-zero exit is the CI signal.
-- ============================================================================

begin;
set local role postgres;

do $$
declare
  user_a uuid := '00000000-0000-4000-a000-0000000000aa';
  user_b uuid := '00000000-0000-4000-b000-0000000000bb';
  result jsonb;
  got    text;
  n      int;
  seq_1  bigint;
  seq_2  bigint;
begin
  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'a@push.test', '', now(), now(), now(), '{}', '{}'),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'b@push.test', '', now(), now(), now(), '{}', '{}')
  on conflict (id) do nothing;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_a, 'role', 'authenticated')::text,
                     true);
  set local role authenticated;

  -- ── 1. A basic push lands a dog and its seizure ─────────────────────────
  result := public.sync_push(jsonb_build_object(
    'device_id', 'dev-1',
    'tables', jsonb_build_object(
      'dogs', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
        jsonb_build_object(
          'id', 'dog1', 'name', 'Lucy', 'breed_id', null, 'breed_name', '',
          'breed_source', '', 'breed_user_desc', '', 'sex', '',
          'age_years', null, 'weight_kg', null, 'dob', '',
          'diagnosis_status', 'undiagnosed', 'first_seizure_date', '',
          'seizure_type', '', 'allergies', '', 'diet', '',
          'vet_json', '{}', 'emergency_vet_json', '{}',
          'emergency_plan_json', '{}',
          'created_at', 100, 'updated_at', 100, 'deleted_at', null))),
      'seizures', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
        jsonb_build_object(
          'id', 'seiz1', 'dog_id', 'dog1', 'start', 1000, 'end', 1060,
          'duration_sec', 60, 'timing_confidence', 'exact',
          'retrospective', false, 'pre_ictal_obs', '[]', 'pre_ictal_note', '',
          'ictal_obs', '[]', 'awareness', null, 'autonomic', '[]',
          'position', null, 'post_behavior', '[]', 'severity_owner', null,
          'recovery_start', null, 'recovery_end', null, 'recovery_sec', null,
          'context_json', '{}', 'notes', '', 'time_since_prev_sec', null,
          'status', 'complete', 'duration_confidence', 'high',
          'last_touched_at', 1060, 'tz_offset_min', 0,
          'created_at', 1000, 'updated_at', 1000, 'deleted_at', null)))
    )));

  if (result->>'applied')::int <> 2 then
    raise exception 'PUSH FAIL (1): expected 2 rows applied, got %', result->>'applied';
  end if;

  select count(*) into n from public.seizures where id = 'seiz1';
  if n <> 1 then raise exception 'PUSH FAIL (1): seizure did not land'; end if;

  -- ── 2. user_id comes from auth.uid(), never from the payload ────────────
  -- A client claiming to write on someone else's behalf must be ignored, not
  -- obeyed. `user_id` is stripped before the insert and set from the JWT.
  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'dogs', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'dog2', 'user_id', user_b, 'name', 'Forged',
        'breed_id', null, 'breed_name', '', 'breed_source', '',
        'breed_user_desc', '', 'sex', '', 'age_years', null,
        'weight_kg', null, 'dob', '', 'diagnosis_status', 'undiagnosed',
        'first_seizure_date', '', 'seizure_type', '', 'allergies', '',
        'diet', '', 'vet_json', '{}', 'emergency_vet_json', '{}',
        'emergency_plan_json', '{}',
        'created_at', 100, 'updated_at', 100, 'deleted_at', null))))));

  select user_id::text into got from public.dogs where id = 'dog2';
  if got <> user_a::text then
    raise exception
      'PUSH FAIL (2): payload user_id was honoured — got %, expected %', got, user_a;
  end if;

  -- ── 3. Last-write-wins: a stale edit does not overwrite a newer one ──────
  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'dogs', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'dog1', 'name', 'Newer', 'breed_id', null, 'breed_name', '',
        'breed_source', '', 'breed_user_desc', '', 'sex', '',
        'age_years', null, 'weight_kg', null, 'dob', '',
        'diagnosis_status', 'undiagnosed', 'first_seizure_date', '',
        'seizure_type', '', 'allergies', '', 'diet', '', 'vet_json', '{}',
        'emergency_vet_json', '{}', 'emergency_plan_json', '{}',
        'created_at', 100, 'updated_at', 500, 'deleted_at', null))))));

  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'dogs', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'dog1', 'name', 'Stale', 'breed_id', null, 'breed_name', '',
        'breed_source', '', 'breed_user_desc', '', 'sex', '',
        'age_years', null, 'weight_kg', null, 'dob', '',
        'diagnosis_status', 'undiagnosed', 'first_seizure_date', '',
        'seizure_type', '', 'allergies', '', 'diet', '', 'vet_json', '{}',
        'emergency_vet_json', '{}', 'emergency_plan_json', '{}',
        'created_at', 100, 'updated_at', 200, 'deleted_at', null))))));

  select name into got from public.dogs where id = 'dog1';
  if got <> 'Newer' then
    raise exception 'PUSH FAIL (3): stale write won — name is %', got;
  end if;

  -- ── 4. THE DURATION GUARD ───────────────────────────────────────────────
  -- A phone that never had a stopwatch reading must not overwrite one that
  -- did, even though its edit is newer. Confidence rank wins first;
  -- updated_at only breaks ties among equals.
  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'seizures', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'seiz1', 'dog_id', 'dog1', 'start', 1000, 'end', 1200,
        'duration_sec', 200, 'timing_confidence', 'approximate',
        'retrospective', true, 'pre_ictal_obs', '[]', 'pre_ictal_note', '',
        'ictal_obs', '[]', 'awareness', null, 'autonomic', '[]',
        'position', null, 'post_behavior', '[]', 'severity_owner', null,
        'recovery_start', null, 'recovery_end', null, 'recovery_sec', null,
        'context_json', '{}', 'notes', 'edited on the other phone',
        'time_since_prev_sec', null, 'status', 'complete',
        'duration_confidence', 'unreliable', 'last_touched_at', 9999,
        'tz_offset_min', 0, 'created_at', 1000, 'updated_at', 9999,
        'deleted_at', null))))));

  select duration_sec::text into got from public.seizures where id = 'seiz1';
  if got <> '60' then
    raise exception
      'PUSH FAIL (4): an estimate overwrote a measured duration — got %s, expected 60', got;
  end if;

  select duration_confidence into got from public.seizures where id = 'seiz1';
  if got <> 'high' then
    raise exception 'PUSH FAIL (4): duration_confidence was downgraded to %', got;
  end if;

  -- ...but the REST of that newer row is accepted. The guard protects two
  -- columns, not the whole record — losing a note to protect a duration would
  -- be its own kind of data loss.
  select notes into got from public.seizures where id = 'seiz1';
  if got <> 'edited on the other phone' then
    raise exception 'PUSH FAIL (4): the rest of the row was rejected too';
  end if;

  -- ── 5. Delete wins over a concurrent edit, whatever its updated_at ───────
  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'dogs', jsonb_build_array(jsonb_build_object('op', 'delete', 'row',
      jsonb_build_object(
        'id', 'dog2', 'name', 'Forged', 'breed_id', null, 'breed_name', '',
        'breed_source', '', 'breed_user_desc', '', 'sex', '',
        'age_years', null, 'weight_kg', null, 'dob', '',
        'diagnosis_status', 'undiagnosed', 'first_seizure_date', '',
        'seizure_type', '', 'allergies', '', 'diet', '', 'vet_json', '{}',
        'emergency_vet_json', '{}', 'emergency_plan_json', '{}',
        'created_at', 100, 'updated_at', 1, 'deleted_at', 12345))))));

  select deleted_at::text into got from public.dogs where id = 'dog2';
  if got is distinct from '12345' then
    raise exception 'PUSH FAIL (5): the delete did not apply — deleted_at is %', got;
  end if;

  -- ── 6. A tombstone is TERMINAL ──────────────────────────────────────────
  -- An offline device that never heard about the delete pushes the row back.
  -- It must not come alive again: a resurrected seizure record is worse than
  -- a lost edit.
  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'dogs', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'dog2', 'name', 'Resurrected', 'breed_id', null,
        'breed_name', '', 'breed_source', '', 'breed_user_desc', '',
        'sex', '', 'age_years', null, 'weight_kg', null, 'dob', '',
        'diagnosis_status', 'undiagnosed', 'first_seizure_date', '',
        'seizure_type', '', 'allergies', '', 'diet', '', 'vet_json', '{}',
        'emergency_vet_json', '{}', 'emergency_plan_json', '{}',
        'created_at', 100, 'updated_at', 99999, 'deleted_at', null))))));

  select name into got from public.dogs where id = 'dog2';
  if got <> 'Forged' then
    raise exception 'PUSH FAIL (6): a tombstoned row was resurrected as %', got;
  end if;

  -- ── 7. Natural-key merge: two phones, one check-in day ──────────────────
  -- Both created a check-in for the same dog on the same local day with
  -- DIFFERENT ids. They are one check-in. The second must be merged onto the
  -- first and its canonical id reported back so the client can collapse its
  -- local duplicate.
  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'daily_checkins', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'chk_phone', 'dog_id', 'dog1', 'timestamp', 500,
        'check_in_date', '2026-08-01', 'sleep_hrs', 8, 'appetite', 'normal',
        'water', 'normal', 'energy', 3, 'stress', 2, 'med_on_time', true,
        'gi', 'none', 'unusual', '', 'backfilled', false,
        'created_at', 500, 'updated_at', 500, 'deleted_at', null))))));

  result := public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'daily_checkins', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'chk_ipad', 'dog_id', 'dog1', 'timestamp', 600,
        'check_in_date', '2026-08-01', 'sleep_hrs', 9, 'appetite', 'normal',
        'water', 'normal', 'energy', 4, 'stress', 1, 'med_on_time', true,
        'gi', 'none', 'unusual', 'from the ipad', 'backfilled', false,
        'created_at', 600, 'updated_at', 600, 'deleted_at', null))))));

  select count(*) into n
    from public.daily_checkins
   where dog_id = 'dog1' and check_in_date = '2026-08-01';
  if n <> 1 then
    raise exception
      'PUSH FAIL (7): the same day was stored % times — the control dataset '
      'would double-count it', n;
  end if;

  if result->'remaps'->0->>'id' is distinct from 'chk_phone'
     or result->'remaps'->0->>'sent_id' is distinct from 'chk_ipad' then
    raise exception
      'PUSH FAIL (7): expected a remap chk_ipad -> chk_phone, got %',
      result->'remaps';
  end if;

  -- The merged row took the newer content.
  select unusual into got from public.daily_checkins where id = 'chk_phone';
  if got <> 'from the ipad' then
    raise exception 'PUSH FAIL (7): the merge kept stale content (%)', got;
  end if;

  -- ── 8. sync_seq strictly advances, and clients cannot set it ────────────
  select sync_seq into seq_1 from public.dogs where id = 'dog1';

  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'dogs', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'dog1', 'name', 'Newest', 'sync_seq', 1, 'breed_id', null,
        'breed_name', '', 'breed_source', '', 'breed_user_desc', '',
        'sex', '', 'age_years', null, 'weight_kg', null, 'dob', '',
        'diagnosis_status', 'undiagnosed', 'first_seizure_date', '',
        'seizure_type', '', 'allergies', '', 'diet', '', 'vet_json', '{}',
        'emergency_vet_json', '{}', 'emergency_plan_json', '{}',
        'created_at', 100, 'updated_at', 100000, 'deleted_at', null))))));

  select sync_seq into seq_2 from public.dogs where id = 'dog1';
  if seq_2 <= seq_1 then
    raise exception
      'PUSH FAIL (8): sync_seq did not advance (% -> %) — a pull cursor would '
      'never see this edit', seq_1, seq_2;
  end if;

  -- ── 9. An unauthenticated push is refused ───────────────────────────────
  reset role;
  set local role postgres;
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;

  begin
    perform public.sync_push('{"tables":{}}'::jsonb);
    raise exception 'PUSH FAIL (9): an unauthenticated push was accepted';
  exception when others then
    if sqlerrm not like '%not authenticated%' then
      raise exception 'PUSH FAIL (9): wrong error for anonymous push: %', sqlerrm;
    end if;
  end;

  -- ── 10. AN OLD CLIENT THAT HAS NEVER HEARD OF A COLUMN ──────────────────
  -- This payload omits `mood_only`, exactly as an app version predating it
  -- would. Before sync_apply_row filtered on what was actually sent, this hit
  -- a not-null violation and took the WHOLE batch down — meaning a phone on an
  -- old build could never sync anything again, including a backlog of seizure
  -- records. Column additions must not strand old clients.
  reset role;
  set local role postgres;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_a, 'role', 'authenticated')::text,
                     true);
  set local role authenticated;

  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'daily_checkins', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'chk_oldclient', 'dog_id', 'dog1', 'timestamp', 700,
        'check_in_date', '2026-08-02', 'sleep_hrs', 7, 'appetite', 'normal',
        'water', 'normal', 'energy', 3, 'stress', 2, 'med_on_time', true,
        'gi', 'none', 'unusual', '', 'backfilled', false,
        'created_at', 700, 'updated_at', 700, 'deleted_at', null))))));

  select count(*) into n
    from public.daily_checkins where check_in_date = '2026-08-02';
  if n <> 1 then
    raise exception
      'PUSH FAIL (10): a payload missing a newer column did not land (% rows)', n;
  end if;

  select mood_only::text into got
    from public.daily_checkins where check_in_date = '2026-08-02';
  if got <> 'false' then
    raise exception
      'PUSH FAIL (10): omitted column should take its DEFAULT, got %', got;
  end if;

  -- ...and an omitted column must not wipe a value already on the row.
  --
  -- NOTE the payload still carries created_at/updated_at. ON CONFLICT builds
  -- the proposed tuple and validates NOT NULL BEFORE it detects the conflict,
  -- so a column that is NOT NULL with no DEFAULT must always be present. That
  -- is not a limitation in practice — those two have existed since the first
  -- migration and every client sends them — but a future NOT NULL column added
  -- without a default WOULD strand old clients, so give one a default.
  perform public.sync_push(jsonb_build_object('tables', jsonb_build_object(
    'daily_checkins', jsonb_build_array(jsonb_build_object('op', 'upsert', 'row',
      jsonb_build_object(
        'id', 'chk_oldclient', 'dog_id', 'dog1', 'timestamp', 700,
        'check_in_date', '2026-08-02', 'energy', 5,
        'created_at', 700, 'updated_at', 8000))))));

  select energy::text into got from public.daily_checkins where id = 'chk_oldclient';
  if got <> '5' then
    raise exception 'PUSH FAIL (10): the partial push did not apply (energy %)', got;
  end if;

  select sleep_hrs::text into got from public.daily_checkins where id = 'chk_oldclient';
  if got is distinct from '7' then
    raise exception
      'PUSH FAIL (10): a column absent from the payload was wiped (sleep_hrs %)', got;
  end if;

  reset role;
  raise notice 'SYNC_PUSH PASS: all 10 conflict-rule checks behaved correctly.';
end
$$;

rollback;
