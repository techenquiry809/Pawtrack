-- ============================================================================
-- Account profile.
--
-- The details collected at manual signup: who this person is and how to reach
-- them. Distinct from `user_settings`, which holds app preferences.
--
-- ── WHY A TABLE AND NOT user_metadata ──────────────────────────────────────
--
-- Supabase exposes `raw_user_meta_data` on the JWT as `auth.jwt()`, and it is
-- USER-EDITABLE — a signed-in client can rewrite its own metadata. That makes
-- it unsafe for anything an authorization decision reads, and awkward for
-- anything else, since it cannot be queried or constrained.
--
-- A real table gets RLS, NOT NULL, and a foreign key. The only thing that
-- belongs in metadata is data nobody trusts.
--
-- ── COLLECT AS LITTLE AS POSSIBLE ──────────────────────────────────────────
--
-- Only full_name is required. Phone and emergency contact are optional and the
-- signup form says so.
--
-- This app already holds veterinary health records; every additional personal
-- field is one more thing to lose in a breach and one more thing to hand over
-- under a data request. The emergency contact earns its place because this is
-- a seizure app and "who else can help with this dog" is genuinely useful. A
-- postal address, a date of birth, a job title would not.
--
-- The email address is deliberately NOT stored here. It already exists on
-- auth.users, and a second copy is a second thing to keep in sync and a second
-- thing to get wrong.
-- ============================================================================

create table if not exists public.profiles (
  -- The primary key IS the foreign key, so this is one row per user and the
  -- PK index already covers the cascade from auth.users.
  user_id                  uuid primary key default auth.uid()
                             references auth.users(id) on delete cascade,

  full_name                text   not null,
  phone                    text   not null default '',
  emergency_contact_name   text   not null default '',
  emergency_contact_phone  text   not null default '',

  created_at               bigint not null,
  updated_at               bigint not null
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Same least-privilege stance as every other table: no DELETE. A profile row
-- goes away with the account, via the cascade — never by a client request.
grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;
