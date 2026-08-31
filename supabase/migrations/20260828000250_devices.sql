-- ============================================================================
-- Device registry.
--
-- Ordered BEFORE sync_push because that function updates last_seen_at.
--
-- ── WHY THIS TABLE EXISTS AT ALL ───────────────────────────────────────────
--
-- Because the answer to "should signing in on a second device sign the first
-- one out?" is no, and this is what you build instead.
--
-- Forcing a sign-out on an offline-first medical app is actively dangerous.
-- The phone in the owner's pocket — the one they grab when the dog starts
-- convulsing — would be showing a login screen because they signed in on an
-- iPad an hour ago. And a device kicked while holding an undrained outbox
-- takes unsynced seizure records with it.
--
-- It also does not work. Supabase access tokens are stateless JWTs that stay
-- valid until they expire no matter what the server thinks; you can revoke a
-- REFRESH token instantly, but the access token keeps working for up to its
-- TTL. Enforcing true single-session would mean a server round trip on every
-- request, which is exactly the network coupling this architecture exists to
-- avoid.
--
-- So: many devices, one account, all active at once. The security control is
-- visibility and revocation the user chooses — this table, the "Your devices"
-- screen, and the new-device alert below.
-- ============================================================================

create table if not exists public.user_devices (
  -- Generated once at first launch and kept in local sync_state ACROSS
  -- sign-outs: it identifies the phone, not the session.
  device_id      text primary key,
  user_id        uuid not null default auth.uid()
                   references auth.users(id) on delete cascade,

  display_name   text not null,               -- "Sam's iPhone"
  platform       text not null,               -- 'ios' | 'android'
  app_version    text not null,

  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),

  -- Set when the user revokes this device from another one. The device also
  -- clears its own session when it next sees this, but only AFTER draining its
  -- outbox — see src/services/sync/devices.ts.
  revoked_at     timestamptz
);

create index if not exists user_devices_user_seen_idx
  on public.user_devices (user_id, last_seen_at desc);

alter table public.user_devices enable row level security;
alter table public.user_devices force row level security;

drop policy if exists "own devices" on public.user_devices;
create policy "own devices" on public.user_devices
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.user_devices from anon;

-- ============================================================================
-- New-device alerts.
--
-- This is the ACTUAL protection against a stolen credential, and it costs one
-- trigger. Single-session policies are usually reaching for this and getting
-- it wrong: they lock out the legitimate second device and still tell the
-- owner nothing when someone else signs in.
--
-- The trigger only records the alert. Sending is a separate concern — an edge
-- function or scheduled job drains this table — because a trigger that makes
-- an outbound HTTP call turns "your phone synced" into "your phone synced, if
-- the mail provider was up".
-- ============================================================================
create table if not exists public.device_alerts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_id    text not null,
  display_name text not null,
  platform     text not null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create index if not exists device_alerts_unsent_idx
  on public.device_alerts (created_at) where sent_at is null;

alter table public.device_alerts enable row level security;
-- Deliberately no policy for `authenticated`: rows are written by the trigger
-- (which runs as the definer below) and read only by the sender job using the
-- service role. A client has no reason to read or write its own alert log.
revoke all on public.device_alerts from anon, authenticated;

create or replace function public.alert_on_new_device()
returns trigger
language plpgsql
-- DEFINER here is correct and narrow: the insert targets a table the calling
-- user has no grants on at all, and the function neither reads nor returns
-- anything belonging to another account.
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only alert when the account ALREADY had a device. The first device on a
  -- new account is the sign-up itself, and mailing someone about that is
  -- noise that teaches them to ignore the useful one.
  if exists (
    select 1 from public.user_devices
     where user_id = new.user_id
       and device_id <> new.device_id
  ) then
    insert into public.device_alerts (user_id, device_id, display_name, platform)
    values (new.user_id, new.device_id, new.display_name, new.platform);
  end if;
  return new;
end
$$;

drop trigger if exists alert_on_new_device_trg on public.user_devices;
create trigger alert_on_new_device_trg
  after insert on public.user_devices
  for each row execute function public.alert_on_new_device();
