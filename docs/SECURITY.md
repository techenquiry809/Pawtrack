# Security

What protects this data, where it is enforced, and what is deliberately *not*
a control. Audited 2 Sep 2026.

---

## The model in one line

> The app ships the `anon` key. It is public by design. **Row Level Security is
> the entire security boundary.**

Anyone who installs the app has that key, and anyone who wants it can pull it
out of the bundle. Nothing but the policies below stands between one owner's
veterinary records and another's. That is why
`supabase/tests/rls_smoke_test.sql` exists and why it belongs in CI — a policy
is not the kind of thing to verify by reading it.

---

## Row Level Security

**Status: verified on all 14 tables.**

The ten data tables — `dogs`, `seizures`, `videos`, `seizure_edits`,
`medications`, `medication_reminders`, `medication_doses`, `daily_checkins`,
`meals`, `user_settings` — are handled by a loop in
`20260828000200_rls.sql`:

```sql
alter table public.%I enable row level security;
alter table public.%I force  row level security;   -- applies to the owner too
create policy "own rows" on public.%I
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.%I from anon;
```

Both clauses on every table. `using` fences what may be **seen**; `with check`
fences what may be **written**. Omitting the second is the classic mistake:
reads look correctly fenced while the client can still INSERT a row carrying
someone else's `user_id`, or UPDATE one of its own rows to hand it to another
account.

`force row level security` matters as much: without it, anything connecting as
the table owner — including a carelessly written `SECURITY DEFINER` function —
bypasses every policy.

The remaining four:

| Table | Enforcement | Why this is right |
|---|---|---|
| `profiles` | RLS + `for all` policy, both clauses | Per-user row |
| `user_devices` | RLS + `for all` policy, both clauses | Per-user row |
| `sync_meta` | RLS + `for select ... using (true)`, `anon` revoked | Holds one global tombstone-horizon watermark, not user data. Postgres does not permit `with check` on a SELECT policy, and with no INSERT/UPDATE policy those commands are denied outright |
| `device_alerts` | RLS enabled, **no policy**, `revoke all from anon, authenticated` | Deny-by-default. Written by a `SECURITY DEFINER` trigger, read by the sender job. No policy is *stronger* than a policy here |

> **Auditing note.** A regex that greps for `create policy` reports ten of these
> tables as unprotected. They are not — the statements are built with
> `execute format()` inside a `do $$` loop. Read the migration, do not grep it.

---

## Keys and secrets

| Check | Result |
|---|---|
| `service_role` / `sb_secret_` key in the working tree | **None.** Every match is prose, a warning, or a local test-role grant in `supabase/tests/00_local_stub.sql` |
| Same, in full git history (`git log -p`) | **None.** No JWT-shaped (`eyJ…`) or `sb_secret_…` literal has ever been committed |
| Secrets in logs | **None.** All five `console.warn` calls in the auth path log an *error*, never a token or session object |

The anon/publishable key in `app.config.ts` is public by design and safe in the
bundle. The service-role key bypasses RLS entirely and must never appear in
`.env`, `app.config.ts`, or CI logs.

---

## Session storage

Sessions live in **`expo-secure-store`** — the iOS keychain and the Android
keystore. `AsyncStorage` appears nowhere in the codebase; it is an unencrypted
file on disk, and these are bearer tokens for veterinary health records.

**The Android 2048-byte limit is handled.** `SecureStoreAdapter` in
`src/services/supabase.ts` chunks values at `CHUNK_SIZE = 1800` across
`key.0`, `key.1`, … with a manifest at `key`. Without it the failure is silent
and one-sided: the write truncates, the session never persists, and users are
signed out on every launch — **on Android only**, so it survives every hour of
testing on a simulator.

---

## Rate limiting

### Server side — the real control

Supabase enforces limits at Auth → Rate Limits. **These values must be read
from the dashboard and recorded here; they could not be verified from the
repository.** Fill in the table below and date it:

| Limit | Default | In force | Checked |
|---|---|---|---|
| Sign-in / token attempts | 30 / 5 min per IP | _unverified_ | — |
| Password-reset emails | 30 / hour per project | _unverified_ | — |
| Sign-up emails | 30 / hour per project | _unverified_ | — |
| OTP / magic link | 30 / hour per project | _unverified_ | — |

Until this is filled in, the only enforced limits are Supabase's defaults.

### Client side — a UX affordance, not a control

`src/store/authThrottle.ts` adds a local backoff. **It is not security.** It
lives in memory, is cleared by killing the app, and is bypassed entirely by
anyone talking to the API directly.

It exists because a server limit cannot tell the person holding the phone what
is happening. Without it, a fourth wrong password produces the same red panel
as the third, then the server starts refusing and the app looks broken rather
than cautious.

| Behaviour | Value |
|---|---|
| Wrong passwords before backoff | 3 |
| Backoff curve | 15s, 30s, 60s, 120s, 240s, capped at **300s** |
| Reset-email cooldown | 60s, flat |
| Shown in the UI | Yes — the button reads `Try again in 12s`, counted down once a second |

Two carve-outs, both deliberate:

- **"Confirm your email first" does not count as a failed attempt.** That is a
  *correct* password on an unconfirmed account; throttling it would lock
  someone out of the screen telling them to go and click the link.
- **The cap is 300s, not an hour.** An owner locked out of their dog's seizure
  history is a worse outcome than a slow brute force the server is already
  refusing.

Do **not** move this counter into SQLite believing that persisting it makes it
a control. A local counter the attacker owns is theatre wherever it is stored.

---

## OAuth (Apple / Google)

The app uses the **native id-token flow**, not the web redirect. The token's
audience is validated **server-side by Supabase**, which is why
`webClientId` — the *web* client ID — is required even though there is no web
build: it is the audience Supabase checks against.

**Unverified from the repository:** that the iOS client ID is listed under
Supabase → Auth → Providers → Google → *Authorized Client IDs*. Confirm in the
dashboard.

**Known gap:** `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is currently unset, so
`GoogleSignin.configure({ webClientId: '' })` yields no usable id token and
Google sign-in cannot complete. Apple is unaffected.

---

## Account deletion

`src/services/sync/localData.ts` — verified correct.

`deleteAccount()` signs other devices out **first** (while a session still
exists to authorise it), calls the `delete_own_account` RPC so every `user_id`
column cascades from `auth.users`, then wipes this device: local rows **and**
video files, then clears the local session.

The file wipe is not a nicety. Video bytes never leave the phone by design, so
deleting the account without deleting them would leave the recordings behind
on a device whose owner has just asked for all of it to be gone.

Files are deleted **after** the rows, so a mid-way failure leaves an orphaned
file rather than a row pointing at bytes that are gone — the cheaper failure,
and the rule the repositories follow everywhere.

---

## Sign-out

Sign-out deliberately **does not wipe**. Every row carries a `user_id` and reads
filter on the active session, so a second person signing in on the same phone
sees their own data while the first user's records survive.

A non-empty outbox is **not** stranded silently: `app/account.tsx` reads
`pendingWriteCount()` and states how many records have not been backed up and
that they upload on next sign-in. "Remove from this phone" is the separate,
explicit action for handing a device on.
