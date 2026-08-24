# Architecture

This document explains **what we chose, and why**. If you are picking this
project up later, read this first.

---

## The one rule that outranks everything

Paws Journal is a **tracking and decision-support tool, not a diagnostic
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

## Known limitations (carried forward honestly)

1. **Single device, no sync, no accounts.** Multi-caregiver support (owner /
   editor / viewer, tracking who entered each record) is not built. The schema
   has no user concept yet. This is the biggest gap for a real household.
2. **Seizure context fields are free text.** The intended upgrade is linking
   them to logged entities so intervals are computed rather than typed.
3. **No screens yet** for standalone food/sleep/exercise/symptom/exposure logs,
   vet document attachments, or reminders beyond medication.
4. **No cloud backup.** Videos live only on the device.
5. **Background execution is limited** — see the timer section above.
