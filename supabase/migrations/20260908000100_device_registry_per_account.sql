-- ============================================================================
-- The device registry is keyed per ACCOUNT, not per handset.
--
-- ── THE BUG ────────────────────────────────────────────────────────────────
--
-- 20260828000250_devices.sql made `device_id` the primary key, globally. But
-- that same file is explicit that a device_id identifies the PHONE and is kept
-- in local sync_state ACROSS sign-outs — "it identifies the phone, not the
-- session". Those two facts cannot both hold: a global key means the first
-- account to sync from a handset owns that handset's only row, permanently.
--
-- The second account's touchThisDevice() upserts with `on conflict (device_id)`,
-- the conflict resolves to an UPDATE of a row that account cannot see under
-- the "own devices" policy, and Postgres refuses it:
--
--   SQLSTATE 42501: new row violates row-level security policy
--                   (USING expression) for table "user_devices"
--
-- Seen on a real handset, with the network up, on every sync:
--
--   WARN [sync] could not update device registry
--        new row violates row-level security policy (USING expression)
--        for table "user_devices"
--
-- ── WHY IT MATTERS MORE THAN A WARNING IN A LOG ────────────────────────────
--
-- The row is what makes a phone visible and revocable. Without it that handset
-- never appears on "Your devices", its `last_seen_at` never moves, and
-- enforceRevocation() finds nothing to honour — so the account CANNOT revoke
-- the one phone it most likely needs to, a shared or handed-on one. The
-- registry's whole purpose (see the header of the original migration: "the
-- security control is visibility and revocation the user chooses") is
-- unavailable to exactly the case it was designed for.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
--
-- One row per (account, phone). Every other site already scopes by user:
-- sync_push updates `where device_id = … and user_id = auth.uid()`, and the
-- client's reads are fenced by the policy, so nothing else changes shape.
-- `videos.origin_device_id` is a bare text column with no foreign key, so
-- dropping global uniqueness on device_id does not touch it.
--
-- The new key also LEADS with user_id, which keeps the FK-index assertion in
-- supabase/tests/run_local.sh satisfied for the auth.users cascade.
--
-- Covered by supabase/tests/devices_test.sql.
-- ============================================================================

do $$
declare
  pk_cols text;
begin
  select string_agg(a.attname, ',' order by k.ord)
    into pk_cols
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'public.user_devices'::regclass
     and c.contype = 'p';

  -- Idempotent, and a no-op on a database that already has the composite key.
  -- Checked by shape rather than by constraint name, because a rename would
  -- otherwise make this run again and drop a key that was already correct.
  if pk_cols is distinct from 'user_id,device_id' then
    alter table public.user_devices
      drop constraint if exists user_devices_pkey;

    -- No de-duplication step is needed: device_id was globally unique until
    -- this moment, so (user_id, device_id) is unique by construction.
    alter table public.user_devices
      add constraint user_devices_pkey primary key (user_id, device_id);
  end if;
end
$$;

-- The old single-column key was also the index that served lookups by phone.
-- The composite key leads with user_id, so a query filtering on device_id
-- alone — enforceRevocation()'s, once RLS has added its own user predicate —
-- no longer has one. Small table, but this is the read on the path that
-- decides whether a revoked phone stands down.
create index if not exists user_devices_device_idx
  on public.user_devices (device_id);
