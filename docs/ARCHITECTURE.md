# Architecture

This document explains **what we chose, and why**. If you are picking this
project up later, read this first.

---

## The one rule that outranks everything

PawTrack is a **tracking and decision-support tool, not a diagnostic
tool.** The app must never claim a food, activity, medication or stressor
*caused* a seizure because a correlation showed up. Use "associated with",
"pattern observed", "possible association".

Concrete implications baked into the code:

| Rule | Where it is enforced |
|---|---|
| Analytics never shown below 3 seizures | `app/(tabs)/analytics.tsx` |
| Every association shows sample size + a causation disclaimer | analytics feature + vet report |
| Emergency plan content is **only** owner/vet entered | `EmergencyPlanSchema`, `app/emergency-plan.tsx` |
| Never suggest a dose or a missed-dose action | medication screens |
| Severity is labelled "owner-observed", never clinical | `SEVERITY_OPTIONS` in `src/types/domain.ts` |
| Never encourage touching the dog's mouth or restraining it | `app/seizure/live.tsx` safety note |

Treat a violation of any of these as a bug, not a style preference.

---

## Technology choices

### Navigation — **Expo Router** (file-based)

*What:* routes come from the file tree in `app/`, like Next.js.

*Why:* the alternative is React Navigation configured by hand. Expo Router is
built on React Navigation anyway, but gives us typed routes, deep linking for
free, and — the deciding factor — an obvious place for the emergency flow to
live *outside* the tab navigator. During a seizure the owner must not be able
to fat-finger their way into the Analytics tab.

```
app/
  (tabs)/          five-tab main app
  seizure/         full-screen emergency flow, no tab bar, no back gesture
  onboarding.tsx   shown only when no dog exists
```

### State — **Zustand**

*What:* a ~1KB store with selector-based subscriptions.

*Why:* Redux is ceremony we do not need. Plain React Context re-renders every
consumer on any change, which is wrong for a screen updating once per second.
Zustand lets the timer screen subscribe to exactly the fields it uses.

**Important:** we do **not** mirror the database into the store. Lists are
queried from repositories on screen focus. Only small always-needed values
(active dog, settings) live in `appStore`. One source of truth for seizure
records — the database.

Two stores:
- `src/store/appStore.ts` — dogs, active dog, settings.
- `src/store/activeSeizureStore.ts` — the in-progress seizure draft only.

### Local storage — **expo-sqlite** with versioned migrations

*What:* a real relational database, not a JSON blob.

*Why:* the previous web prototype stored everything as one JSON string. That
had three problems that matter for health data:

1. Every save rewrote the entire dataset — a partial write loses everything.
2. No way to query "seizures in the last 30 days" without loading all of it.
3. No safe path to multi-caregiver sync later.

Migrations use SQLite's built-in `user_version`. See `src/db/migrations.ts`.
**Never edit a migration that has already shipped** — add a new one. Editing a
shipped migration corrupts existing users' databases.

We enable `PRAGMA foreign_keys = ON` (so cascades fire) and
`journal_mode = WAL` (far more crash-resistant, which matters when the app may
be force-quit mid-seizure).

### Data access — the **repository pattern**

Screens never write SQL. They call functions in `src/db/*Repo.ts`. This is what
keeps business logic out of components and makes the data layer testable
without rendering anything.

### Validation — **Zod**

*What:* runtime schema validation, colocated with the TypeScript types.

*Why:* TypeScript disappears at runtime. This is health data a vet may make
decisions from — if a migration goes wrong or a backup is corrupt, we want a
loud catchable error, not a silently wrong duration on a report. Currently used
to guard settings on load; extend it to imported backups.

### Forms — **plain controlled components**

*Why no react-hook-form:* the forms here are chips and a handful of text
inputs. Adding a form library would be a dependency with no payoff. Revisit if
form complexity grows substantially.

### Styling — **StyleSheet + design tokens**

*Why no NativeWind/styled-components:* one extra build step and one extra
abstraction for no gain at this size. All colours, spacing and radii live in
`src/theme/tokens.ts`, ported 1:1 from the web app's CSS variables. **Never
hardcode a hex value in a component** — add it to tokens instead.

### Media — **expo-image-picker** (not a custom expo-camera UI)

*Why:* during a seizure the owner should get the familiar system camera they
already know, not a bespoke interface to learn under stress. `expo-camera` is
installed for a future in-app preview but is not on the critical path.

Video **bytes never go in the database.** Files are copied into the app's
document directory; only the path is stored. See `src/services/videoService.ts`.

> **SDK note:** Expo SDK 54+ replaced `FileSystem.copyAsync` with an
> object-oriented `File` / `Directory` / `Paths` API. This project uses the
> current API. Tutorials showing `FileSystem.documentDirectory` are written for
> older SDKs.

### Notifications — **expo-notifications**, local only

Medication reminders are scheduled on-device. There is **no push server and no
backend** — nothing about your dog's health leaves the phone.

---

## The seizure timer — read before touching

`src/store/activeSeizureStore.ts` and `src/hooks/useSeizureTimer.ts` are the
most safety-critical files in the app.

**The single rule: elapsed time is always `Date.now() - startedAt`.**

We never accumulate a counter on each tick. A tick-counter drifts, stops when
the OS suspends the JS thread, and silently *under-reports* duration — which
could mean an owner is not warned that they crossed five minutes.

The one-second interval exists **only to trigger a re-render**. It is not the
source of truth. The hook also recomputes immediately on app foreground, so a
phone that was in a pocket shows the true elapsed time the instant it wakes.

Also handled there:
- `useKeepAwake()` — the screen must not sleep while timing.
- Threshold haptics fire exactly once each (tracked in `firedThresholds`).
- `accessibilityLiveRegion` so screen readers announce the running timer.

**Known limitation, be honest about it:** if the OS fully terminates the app
mid-seizure, the JS timer dies with it. The start timestamp is what protects
you — reopening recomputes correctly. True background execution would need a
native module and is out of scope for now.

---

## Folder structure

```
app/                       Routes (Expo Router owns this folder)
  _layout.tsx              DB init, migrations, error/loading gate
  (tabs)/                  Home, Timeline, History, Patterns, More
  seizure/                 live -> post -> recovery emergency flow
  seizure-detail/[id].tsx  View + edit + retrospective create
  onboarding.tsx
  breed-picker.tsx
  daily-checkin.tsx
  emergency-plan.tsx

src/
  components/              Reusable UI primitives (ui.tsx, Placeholder.tsx)
  constants/breeds.ts      235 standardized breeds + search
  db/                      client, migrations, one repo per entity
  features/                Domain logic: analytics, report generation
  hooks/                   useSeizureTimer and friends
  services/                Device integrations (video, notifications)
  store/                   Zustand stores
  theme/tokens.ts          All colours, spacing, radii, font sizes
  types/domain.ts          Types + Zod schemas + option vocabularies
  utils/                   Pure helpers (time formatting)
docs/                      This file, TOOLSET.md, WORKFLOW.md, DEVLOG.md
```

**Why `features/` and `services/` are separate:** `features/` is pure logic you
can unit test with no device (pattern analysis, report HTML). `services/` wraps
device APIs (camera, notifications) that need a real phone.

---

## Data model summary

Full definitions with comments: `src/types/domain.ts`.

- **Dog** — profile, structured `Breed`, vet contacts, emergency plan.
- **Seizure** — absolute `start`/`end`, derived duration, `timingConfidence`
  (exact/approximate/unknown), `retrospective` flag, four observation groups,
  recovery, context, `createdAt`/`updatedAt`.
- **Video** — path on disk + metadata, linked to a seizure, cascade-deleted.
- **Medication** — schedule + the id of its repeating local notification.
- **DailyCheckin** — the control dataset; one row per dog per day.
- **Meal** — the one context entity already structured enough to compute
  meal-to-seizure intervals.

### Structured vocabularies

`MOVEMENT_OPTIONS`, `AWARENESS_OPTIONS` etc. are `as const` arrays that serve
double duty — the UI maps over them, TypeScript derives union types from them.

**Do not casually reword an existing option string.** They are stored verbatim
in the database; renaming one orphans historical records.

### Breed is structured, never free text

`{ breedId, breedName, breedSource, userEnteredDescription }`.

This exists so future analytics can group dogs reliably instead of drowning in
"Golden Retreiver" / "golden retriver" variants. `Mixed Breed` / `Unknown` /
`Other` pair with a free-text description, so we keep both the groupable value
and the owner's own words.

**Analytics caveat for whoever builds that later:** you may report *"most
frequently reported breeds in our dataset"*. You may **not** report prevalence
or risk — that needs population-level denominator data this app does not have.

---

## Accounts and multi-device sync

### The one principle everything follows

**SQLite on the phone stays the source of truth. Supabase is a sync target,
not a database the app reads from.**

Every screen reads local SQLite exactly as it did before. Nothing in `app/`
knows a network exists. A seizure gets recorded in a field with no signal, and
the durability design — the row inserted on the first tap, the monotonic
clock, the crash salvage — depends on a local write that cannot fail. A cloud
round trip anywhere in that path would undo it.

Sync is a background process that drains a queue. If it never runs, the app
still works completely. Accounts are **optional**: the sign-in screen is
offered once and can be declined forever (`src/services/authPrompt.ts`).

### The two-database model

| Syncs | Never syncs | Why not |
|---|---|---|
| `dogs`, `seizures`, `videos` (metadata), `seizure_edits`, `medications`, `medication_reminders`, `medication_doses`, `daily_checkins`, `meals`, settings | Video and thumbnail **files** | Deliberate. See below. |
| | `video_files.file_uri` / `thumb_uri` | A path is meaningless on another device, and iOS reassigns the container UUID (`src/services/fileStore.ts`). |
| | `medication_reminders.notification_id` | A handle from `expo-notifications` on device A **cannot be cancelled from device B**. Each device schedules and owns its own. |
| | `dogs.photo_uri` | Same as video paths. |
| | Active-dog selection | A per-device UI preference, not a fact about the dog. |

That `notification_id` row is the one most likely to be missed, and the bug it
causes is nasty: a reminder that cannot be turned off from the phone you are
holding.

`src/db/syncSchema.ts` is the single manifest. Adding a column and forgetting
it there means it does not sync — the safe direction to fail in.

### Videos: metadata syncs, bytes do not

The video **row** is clinical data. A vet report saying "a recording exists for
this seizure" is meaningful on a device that cannot play it, so the row syncs.
The **bytes** are local, so the paths must not.

A video is present on this device **iff** a `video_files` row exists. That is
the whole test, surfaced as `Video.isLocal`. On a second device the gallery
renders a designed "Recorded on Sam's iPhone" state — not a broken tile, and
not a hidden one.

**The deletion asymmetry is deliberate.** Deleting the video *row* is a
clinical edit and syncs everywhere. Deleting a *file* is device-local
housekeeping and does not — a phone freeing up space must not destroy the
record for everyone.

### Why the pull cursor is a sequence, not a timestamp

Every server row carries `sync_seq` from one global Postgres sequence. Two
phones 40 seconds apart would produce a *timestamp* cursor that silently skips
rows. A server-side sequence is monotonic by construction.

This is the same refusal to trust a wall clock that `src/utils/clock.ts` makes
about seizure duration, applied to replication.

### Deletes are tombstones, and they do not cascade for free

A hard DELETE cannot be replicated — the next pull would helpfully restore the
row. So every delete became `UPDATE … SET deleted_at`.

**The trap:** SQLite's `ON DELETE CASCADE` fires on a DELETE and *not* on an
UPDATE. The moment deletes went soft, every cascade in the schema silently
stopped working, with no error. `src/db/tombstone.ts` walks the subtree
explicitly. Covered by `src/db/outbox.test.ts`.

### Conflict resolution

Last-write-wins on `updated_at`, with three exceptions, all enforced
**server-side** in `sync_push` — a client-side rule is only as good as the
oldest app version still installed:

| Field group | Rule |
|---|---|
| `duration_sec` + `duration_confidence` | Confidence rank wins first (`high > clock_corrected > recovered > unreliable > legacy`); `updated_at` only breaks ties. A stale phone must never overwrite a stopwatch measurement with an estimate. |
| `deleted_at` | Delete always wins, and is terminal. A resurrected seizure record is worse than a lost edit. |
| `daily_checkins`, `medication_doses` | Merged on their natural key. Two phones logging the same dose is one dose. The server returns a remap so the client collapses its local duplicate. |

### Sessions: many devices, all active at once

Signing in on a second device **never** signs the first one out. The full
argument is at the top of `src/services/sync/devices.ts`; the short version is
that a single-session policy would make someone log in during a seizure, and
it does not even work — Supabase access tokens are stateless JWTs valid until
they expire regardless of what the server thinks.

The security control is visibility and revocation the owner chooses: a device
registry, a "Your devices" screen, and a new-device email. Revocation drains
the outbox **before** it clears the session, or revocation becomes a data-loss
path.

Session lifetime is deliberately indefinite. If you want protection against
someone picking up an unlocked phone, that is a **device lock, not a session
policy** — opt-in Face ID in `src/services/appLock.ts`, which cannot log
anyone out at the wrong moment.

### Testing the parts that cannot be reviewed

RLS is the entire security model (the app ships the public `anon` key), and
`sync_push` decides which version of a seizure record survives. Neither is
verifiable by reading it.

```
npm run test:db      # spins up a throwaway PostgreSQL cluster, applies the
                     # schema, asserts two schema invariants, runs the RLS and
                     # sync_push suites, tears down
```

Needs only a PostgreSQL install — no Docker, no Supabase CLI. The RLS suite
signs in as user B and tries six ways to reach user A's dog.

It has already caught three real bugs, all of which passed a reading of the
SQL:

1. **Revoking the sequence from `authenticated` broke every insert** — the
   stamping trigger is invoked as the *caller*, so it hit the revoke. Fixed by
   making `stamp_sync_seq()` SECURITY DEFINER with a pinned `search_path`.
2. **Eight foreign keys had no usable index.** Postgres does not index the
   referencing side. That turns `delete_own_account()` — one delete from
   `auth.users` cascading across nine tables — into a sequential scan of every
   table for every user. Note that a *partial* unique index does not count:
   `daily_checkins` and `medication_doses` looked covered and were not, because
   their indexes carry `where deleted_at is null` and a cascade must still
   reach tombstoned rows.
3. **`purge_tombstones()` was callable by `anon`.** Postgres grants EXECUTE on
   every new function to PUBLIC, and `anon` inherits from PUBLIC — so
   `revoke ... from anon, authenticated` was a no-op against the PUBLIC grant.
   An unauthenticated caller holding only the public key could run a
   SECURITY DEFINER maintenance sweep and advance the global tombstone horizon,
   forcing every device into a full resync. The revoke has to name `public`.

The last two are now **asserted on every run** rather than fixed once, because
adding a table or a function reintroduces them silently:

```
→ foreign key indexes
   ✓ every foreign key is indexed
→ security definer exposure
   ✓ no security definer function is reachable by anon
```

Both assertions were negative-tested — reintroduce either fault and the runner
exits 1.

### Least privilege on the Data API

`authenticated` is granted `select, insert, update` on the synced tables and
deliberately **not** `delete`. Nothing in the client hard-deletes a server row:
every user-facing delete is a tombstone (an UPDATE), and the two functions that
really delete are SECURITY DEFINER. So withholding DELETE costs nothing and
means a stolen access token cannot destroy a seizure record — the worst it can
do is tombstone one, which stays recoverable for the whole retention window.

---

## Known limitations (carried forward honestly)

1. **Seizure context fields are free text.** The intended upgrade is linking
   them to logged entities so intervals are computed rather than typed.
2. **No screens yet** for standalone food/sleep/exercise/symptom/exposure logs,
   vet document attachments, or reminders beyond medication.
3. **Video files still live only on the device.** That is a deliberate design
   choice, not a gap — but it does mean a lost phone loses its recordings,
   and the tile state exists to make that legible rather than surprising.
4. **Background execution is limited** — see the timer section above.
5. **Multi-caregiver is not built**, but the door is left open cheaply:
   `dog_id` is now on every synced table, and `dogs.user_id` is the *owner*
   rather than the only reader. Adding a `dog_members` join table plus an RLS
   policy migration gets there without restructuring tables.
6. **`meals` is a dead table.** It has a schema, a type and now sync coverage,
   but no repository and no screen writes it.
