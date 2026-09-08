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

Supabase enforces limits at Auth → Rate Limits. **Read from the dashboard and
recorded here 6 Sep 2026** (project `esprfpxkshkauougvqmf`, techenquiry809's
Project, `main` / production):

| Limit | Value | Scope |
|---|---|---|
| Sending emails | **2 / hour** | Per **project**, not per IP |
| Sending SMS | 30 / hour | Per project (unused — no phone auth) |
| Token refreshes | 150 / 5 min (1800 / hour) | Per IP |
| Token verifications (OTP + magic link) | 30 / 5 min (360 / hour) | Per IP |
| Anonymous sign-ins | 30 / hour | Per IP (unused — anonymous sign-in is off) |
| Sign-ups and sign-ins | 30 / 5 min (360 / hour) | Per IP |
| Web3 sign-ups and sign-ins | 30 / 5 min | Per IP (unused) |

The table this replaced assumed separate per-project allowances for
password-reset and sign-up mail. The dashboard does not split them: **all
outgoing auth email — signup confirmation codes, resend, and password-reset
codes together — draws from one project-wide pool of 2 per hour.** That is
Supabase's default for a project with no custom SMTP configured, and it is
almost certainly too low the moment more than one person is testing the OTP
flow: a second signup within the same hour as a first will not receive its
code, with no error surfaced to the owner beyond "check your inbox." Before
relying on the OTP flow for real users, configure a custom SMTP provider under
Auth → Emails, which lifts this to the provider's own limits.

The per-IP limits (token verification, sign-in) are generous relative to the
client-side backoff below and are not a practical concern.

### Email OTP — a setting that lives in two places

The code length is a **project** setting, and the app has to be told the same
number. They are set in different systems and nothing checks that they agree:

| | Where | Value |
|---|---|---|
| Server | Dashboard → Authentication → Sign In / Providers → Email → **Email OTP Length** | **6** |
| App | `OTP_LENGTH` in `src/constants/auth.ts` | **6** |

**Change one, change the other.** The project was briefly set to 8 while the
app drew 6 boxes, and the failure is close to undiagnosable from the outside:
every owner typed the first six digits of an eight-digit code, the server said
the code was wrong, and it was — nothing errored, nothing logged, and the
screen blamed the person holding the phone.

GoTrue accepts **6 to 10** and refuses anything outside that range, so 6 is the
shortest code this flow can have. Length is not what bounds guessing here
anyway: codes expire after an hour (Email OTP expiration, same settings page)
and verification is rate-limited per IP in the table above.

**Only one code is live at a time — but the two flows get there differently,
and the difference is a trap.** GoTrue holds a single outstanding token per
user per flow. Asking for another does not mean the same thing in both:

| Flow | On a second request | Is the earlier email still usable? |
|---|---|---|
| Password reset (`resetPasswordForEmail`) | mints a **new** recovery token, overwriting the old | **No** — that code is dead |
| Signup confirmation (`resend`) | re-sends the **existing** token ([supabase/auth#1300](https://github.com/supabase/auth/issues/1300)) | Yes — it is the same code |

So "your previous code has been invalidated" is true for reset and false for
signup, and no screen may say it. The only instruction correct in both cases
is **use the newest email**, which is what `app/(auth)/verify.tsx` says after a
successful resend — and why it clears the typed digits, since in the reset case
they have just been superseded.

It is also why `app/(auth)/forgot-password.tsx` deliberately offers no "I
already have a code" shortcut. That path reached the code screen without
sending, so it was only ever valid when nothing had been sent since — a
condition the screen cannot check and the owner cannot be expected to track.

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
| Reset-email cooldown | 60s, flat — **or the server's own figure when it states one** |
| Signup attempts before backoff | 2 |
| Signup backoff curve | 5s, 10s, 20s, 40s, capped at **120s** |
| Shown in the UI | Yes — the button reads `Try again in 12s`, counted down once a second |

The email cooldowns are a local guess at a limit that actually lives in the
Supabase dashboard, so the two drift the moment anyone changes it — and they
drift the way that looks like a bug: the button re-enables at 60s and the
server refuses. When GoTrue states its remaining window in a 429 body
(`…you can only request this after 47 seconds`), `serverStatedWaitMs()` in
`authThrottle.ts` adopts that number instead. An unparseable notice falls back
to the local constant and never to zero.

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

## Account enumeration

Two forms ask about an email address, and they answer differently **on
purpose**.

**Sign-in stays vague.** `That email and password do not match.` covers both a
wrong password and an address with no account. A message that distinguished
them would confirm which addresses belong to people managing a dog's epilepsy.

**Sign-up tells the truth.** `An account already exists for this email —
sign in instead.` This is a knowing exception, not an oversight.

Why the exception. With email confirmation required, `signUp()` on an existing
**confirmed** address does not return an error — GoTrue answers `200` with an
obfuscated user object, specifically so the endpoint cannot be enumerated. The
only distinguishing signal is `identities: []` (a real signup carries one); see
`isExistingAccountSignUp()` in `src/services/authErrors.ts`.

Treating that response as success is what the app used to do, and it produced
an unrecoverable screen: *"we've sent you a 6-digit code"* for an address that
was never sent one. The owner waits for mail that does not exist, and nothing
on that screen leads anywhere. Weighed against that, the cost of the vague
alternative falls on a **real owner in a dead end**, while the cost of honesty
falls on an attacker who has other ways to ask the same question.

What mitigates it instead:

- **Server-side rate limiting on `/auth/v1/signup`** — per-IP, unbypassable,
  and the only real control. See the table above.
- **A client-side signup backoff** (2 free attempts, then 5s→120s). Like every
  other client counter here, this is a speed bump for someone using the app,
  **not** protection against a script. A scan talks to the REST endpoint
  directly and never runs a line of it.

If enumeration resistance ever needs to be tightened, the number to change is
the server-side signup rate limit — not this.

---

## OAuth (Apple / Google)

The app uses the **native id-token flow**, not the web redirect. The token's
audience is validated **server-side by Supabase**, which is why
`webClientId` — the *web* client ID — is required even though there is no web
build: it is the audience Supabase checks against.

**Resolved 6 Sep 2026:** `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is now set in
`.env`, and the reversed iOS client ID's URL scheme is confirmed present in
`ios/PawTrack/Info.plist` after a clean `expo prebuild`.

**Known gap — this is the one actually blocking sign-in right now:** checked
Auth → Providers → Google on the dashboard directly (project
`esprfpxkshkauougvqmf`). **Google is toggled OFF, and the Client IDs field is
empty.** No amount of correct native config or JS code makes
`signInWithIdToken({ provider: 'google' })` succeed while the provider itself
is disabled — Supabase rejects the exchange before it ever checks an
audience. To fix: enable the toggle and add
`581894497679-dc89co4i9hlj36n96o0jajcpbcmf2s3q.apps.googleusercontent.com`
(the web client ID) to Client IDs — the iOS client ID
(`581894497679-lrritiife6pukllkogjt3au4arohj14g.apps.googleusercontent.com`)
can be added to the same comma-separated field too, though the web one is
what the native flow's token audience is actually checked against. This is a
dashboard change on a **production** project and was left undone rather than
made without asking.

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

### The two things sign-out must also clear

Filtering reads by `user_id` fences the *query*. It does nothing about state
already held elsewhere, and both gaps below were real:

**The in-memory store.** `appStore` caches `dogs` and `activeDogId`, and
nothing re-read them when the session changed. Signing out of A and into B on
one phone left A's dog rendering — name, breed, photo — until some unrelated
screen happened to call `refreshDogs()`. The route gate read the same stale
`dogs.length`, so a brand-new account skipped onboarding and landed on Home
showing the previous person's dog. `resetForAccountChange()` now drops the
cache and re-reads whenever the user id actually changes.

**The outbox.** Queued writes outlive the session that made them — sign-out
does not block on them, by design. `peek()` used to drain with a bare
`SELECT * FROM outbox`, so a write queued by account A went out on whatever
session was signed in when the phone next found signal. The push strips
`user_id` and lets the server stamp `auth.uid()`, so the row arrived as a
**correctly authenticated write by B of a row B never owned** — invisible to
RLS, because nothing about it is unauthorised.

Migration 13 adds `outbox.user_id`, captured at enqueue time from the session
that made the write, and `peek()` takes the owner from the session the push is
about to authenticate as. `NULL` is a real value meaning *queued while signed
out, belonging to no account yet*; those become pushable only by being claimed
(`src/services/sync/claim.ts`), never by whoever signs in next.

---

## An account is required

Signing in is the first thing the app does. There is no anonymous mode, no
"not now", and nothing in the app is reachable without a session — the route
gate in `app/_layout.tsx` sends a signed-out session to sign-in and re-asserts
that on every run rather than once per session.

The order is `sign in -> agree to the terms -> add your dog`, and each step
supplies something the next one needs. The account exists before consent
because consent is recorded **against** that account; consent comes before
onboarding because onboarding immediately collects a dog's name, age and
diagnosis, and taking a medical record before explaining the terms it is held
under is the wrong way round.

Two consequences worth stating plainly:

- **A build with no Supabase config is unusable**, by design. It cannot create
  an account, so it cannot get past the first screen. The sign-in screen says
  so rather than offering a "Continue" that leads straight back to it.
- **Nothing gates individual features any more.** The detailed report and the
  emergency plan used to check for a session and show a sign-in prompt. That
  check was removed outright, not hidden: a screen you cannot reach without a
  session has nothing to test.

---

## Consent

Recorded against the **user**, on `public.profiles`
(`terms_version`, `privacy_version`, `consented_at`), under the policy that
already fences that row. It used to be a device fact in local SQLite, which
could not answer "who accepted which version, and when", asked the same person
again on a second phone, and was erased by a device wipe.

Versions rather than a boolean. The two documents are versioned independently
in `src/constants/legal.ts`, and bumping either re-opens the gate on its own —
no migration, no backfill, and no way to leave people marked as having accepted
text they have never seen.

There is still a local copy. It is a **cache** of the server's answer, keyed by
user id, and it exists because the gate runs at launch on connections that are
often bad. Without it, an offline launch would either block an owner who has
already agreed or let them past on an assumption. Accepting writes the cache
first and pushes to the account after; a failed push stays pending and
`flushPendingConsent()` retries on the next sync, so nobody is held at a legal
screen because the network is down.

The cache is keyed per user precisely so it cannot tell the next person to sign
in on a shared phone that they have already agreed.

---

## Records written before accounts were required

Rows on an upgraded phone can still carry `user_id IS NULL` — written when the
app could be used without an account. `ownerScope()` stops matching them the
moment a session lands, so left alone they would look, to their owner, exactly
like a deleted history.

`adoptOrphanedLocalData()` hands them to the first account that signs in on
that phone, in one transaction, and queues them for push. It runs on the
session event and is guarded by a single existence probe per table, so a normal
install pays nothing for it.

It no longer asks. The old flow presented a merge screen because a phone with
no account and an account with its own dogs could belong to different people.
That cannot arise here: these rows predate the sign-in requirement, so they
were written by whoever holds this phone, and that is the person signing in.
The claim screen, its destructive "keep only what's in my account" branch, and
the banner that announced a silent merge are all gone.

The adoption is **additive only** — it matches `WHERE user_id IS NULL`, so no
row already in the account is rewritten, re-timestamped or re-queued. Video
**metadata** is adopted and pushed like any other row. The **files** are not,
and never have been: there is no upload path for them anywhere in the codebase.
