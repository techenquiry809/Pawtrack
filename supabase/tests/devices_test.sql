-- ============================================================================
-- One phone, two accounts.
--
-- ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
--
-- `device_id` identifies the PHONE, not the session: it is generated once and
-- kept in local sync_state across sign-outs, deliberately (see the header of
-- supabase/migrations/20260828000250_devices.sql). But it was also the table's
-- primary key, GLOBALLY — so the first account to sync from a handset owned
-- that handset's only row, forever.
--
-- The second account's `touchThisDevice()` then upserts on `device_id`, the
-- ON CONFLICT path resolves to an UPDATE of a row it cannot see, and Postgres
-- refuses it:
--
--   new row violates row-level security policy (USING expression)
--   for table "user_devices"
--
-- Observed in the wild, on a real handset, with the network up:
--
--   WARN [sync] could not update device registry
--        new row violates row-level security policy (USING expression)
--        for table "user_devices"
--
-- The consequence is not cosmetic. `touchThisDevice` is how a device announces
-- itself and keeps `last_seen_at` honest, and `enforceRevocation` reads the
-- row this account owns for this phone. With no such row, the phone is absent
-- from "Your devices" and CANNOT BE REVOKED — the one security control the
-- registry exists to provide, for the account most likely to need it (a shared
-- or handed-on phone).
--
-- Runs inside a transaction that is rolled back, like the other tests here.
-- ============================================================================

begin;

set local role postgres;

do $$
declare
  user_a  uuid := '00000000-0000-4000-a000-0000000000da';
  user_b  uuid := '00000000-0000-4000-b000-0000000000db';
  -- ONE handset. Both accounts sync from it, which is the whole point.
  phone   text := 'device-shared-handset';
  checks  int := 0;
  seen    int;
  owner   uuid;
  stamp   timestamptz;
begin
  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'a@devices.test', '', now(), now(), now(), '{}', '{}'),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'b@devices.test', '', now(), now(), now(), '{}', '{}')
  on conflict (id) do nothing;

  /* ── 1. Account A syncs from the phone ────────────────────────────────── */
  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_a, 'role', 'authenticated')::text,
                     true);
  set local role authenticated;

  insert into public.user_devices (device_id, user_id, display_name, platform, app_version)
  values (phone, user_a, 'The Phone', 'android', '1.0.0')
  on conflict (user_id, device_id) do update
    set display_name = excluded.display_name,
        last_seen_at = now();

  select count(*) into seen from public.user_devices where device_id = phone;
  if seen <> 1 then
    raise exception 'DEVICES FAIL: A''s first sync did not register the phone (saw %)', seen;
  end if;
  checks := checks + 1;

  /* ── 2. A signs out; B signs in ON THE SAME PHONE ─────────────────────── */
  reset role;
  set local role postgres;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_b, 'role', 'authenticated')::text,
                     true);
  set local role authenticated;

  /*
   * THE REGRESSION. Before the composite key this raised:
   *   new row violates row-level security policy (USING expression)
   * because the conflict target `device_id` alone resolved to A's row.
   */
  begin
    insert into public.user_devices (device_id, user_id, display_name, platform, app_version)
    values (phone, user_b, 'The Phone', 'android', '1.0.0')
    on conflict (user_id, device_id) do update
      set display_name = excluded.display_name,
          last_seen_at = now();
  exception when others then
    raise exception 'DEVICES FAIL: B could not register the shared phone: % (%)',
      sqlerrm, sqlstate;
  end;
  checks := checks + 1;

  /* ── 3. B sees its own row, and ONLY its own ──────────────────────────── */
  select count(*) into seen from public.user_devices;
  if seen <> 1 then
    raise exception 'DEVICES FAIL: B sees % device rows, expected exactly its own', seen;
  end if;

  select user_id into owner from public.user_devices where device_id = phone;
  if owner <> user_b then
    raise exception 'DEVICES FAIL: B''s visible row is owned by %, not B', owner;
  end if;
  checks := checks + 1;

  /* ── 4. A's row survived. B must not have overwritten or stolen it ────── */
  reset role;
  set local role postgres;

  select count(*) into seen from public.user_devices where device_id = phone;
  if seen <> 2 then
    raise exception
      'DEVICES FAIL: expected one row per account for the phone, found %', seen;
  end if;
  checks := checks + 1;

  /* ── 5. Revocation is per account, not per handset ─────────────────────
   *
   * The reason the registry exists. A revoking the phone must not touch B's
   * access from the same phone, and — more importantly — B must be ABLE to
   * revoke it at all, which is exactly what the missing row prevented.
   */
  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_b, 'role', 'authenticated')::text,
                     true);
  set local role authenticated;

  update public.user_devices set revoked_at = now() where device_id = phone;

  select revoked_at into stamp
    from public.user_devices where device_id = phone and user_id = user_b;
  if stamp is null then
    raise exception 'DEVICES FAIL: B could not revoke its own registration';
  end if;
  checks := checks + 1;

  reset role;
  set local role postgres;
  select revoked_at into stamp
    from public.user_devices where device_id = phone and user_id = user_a;
  if stamp is not null then
    raise exception 'DEVICES FAIL: B''s revocation reached across into A''s row';
  end if;
  checks := checks + 1;

  /* ── 6. sync_push keeps last_seen_at warm for the RIGHT account ─────────
   *
   * Both rows are first backdated to a sentinel. `now()` is the TRANSACTION
   * timestamp and does not advance inside this block, so "is it recent" can
   * discriminate nothing here — only an explicit before/after value can.
   */
  update public.user_devices set last_seen_at = timestamptz '2020-01-01 00:00:00Z'
   where device_id = phone;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', user_b, 'role', 'authenticated')::text,
                     true);
  set local role authenticated;

  perform public.sync_push(jsonb_build_object('device_id', phone, 'rows', '[]'::jsonb));

  reset role;
  set local role postgres;

  -- B's own registration is refreshed …
  select last_seen_at into stamp
    from public.user_devices where device_id = phone and user_id = user_b;
  if stamp = timestamptz '2020-01-01 00:00:00Z' then
    raise exception 'DEVICES FAIL: B''s push did not refresh B''s own last_seen_at';
  end if;
  checks := checks + 1;

  -- … and A's, on the same handset, is left exactly where it was.
  select last_seen_at into stamp
    from public.user_devices where device_id = phone and user_id = user_a;
  if stamp <> timestamptz '2020-01-01 00:00:00Z' then
    raise exception 'DEVICES FAIL: B''s push bumped A''s last_seen_at';
  end if;
  checks := checks + 1;

  raise notice 'DEVICES PASS: all % one-phone-two-accounts checks behaved correctly.', checks;
end
$$;

rollback;
