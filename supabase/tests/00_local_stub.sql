-- ============================================================================
-- Local-only stand-in for the parts of a Supabase project the migrations need.
--
-- ── DO NOT RUN THIS AGAINST A SUPABASE PROJECT ─────────────────────────────
--
-- A real project already has all of this, and `create or replace` on auth.uid()
-- there would overwrite the platform's own function. This file exists so the
-- schema and its tests can run against a PLAIN PostgreSQL instance — a
-- throwaway cluster from initdb, or a postgres container in CI — without
-- needing the Supabase stack.
--
--   initdb -D /tmp/pgdata -U postgres --auth=trust
--   pg_ctl -D /tmp/pgdata -o "-k /tmp/pgsock" -l /tmp/pg.log start
--   psql -h /tmp/pgsock -U postgres -f supabase/tests/00_local_stub.sql
--   for f in supabase/migrations/*.sql; do psql ... -f "$f"; done
--   psql ... -f supabase/tests/rls_smoke_test.sql
--   psql ... -f supabase/tests/sync_push_test.sql
--
-- See run_local.sh, which does all of that.
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  instance_id        uuid,
  aud                text,
  role               text,
  email              text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb
);

/**
 * Deliberately byte-faithful to Supabase's own definition.
 *
 * The nullif() guards come BEFORE the ::uuid cast. That is not a detail: with
 * a naive `current_setting(...)::json->>'sub'`, an unset or empty claim throws
 * a JSON parse error instead of returning NULL — so `auth.uid() is null`, the
 * check every policy and sync_push relies on, would raise rather than return
 * false. A stub that got this wrong would fail tests the real platform passes.
 */
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- Supabase's default grants, which the migrations then narrow with RLS.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;
grant select on auth.users   to authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
