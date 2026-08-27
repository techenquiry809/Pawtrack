# Paws Journal — Build Manual

A study reference for the whole codebase: every package, the layer architecture,
all domain types, and the SQLite schema.

Companion to `ARCHITECTURE.md` (the *why* behind decisions), `TOOLSET.md`
(installing things) and `WORKFLOW.md` (day-to-day process). This file is the
*inventory*.

| | |
|---|---|
| **Framework** | Expo SDK 57 (`~57.0.16`) |
| **Runtime** | React Native 0.86.2, React 19.2.3 |
| **Language** | TypeScript `~6.0.3`, strict mode |
| **Storage** | SQLite on device, 8 migrations |
| **Backend** | None — nothing leaves the phone |
| **Bundle ID** | `com.pawsjournal.app` |

---

## 1. The stack, in one read

Five decisions define this app. Everything in `package.json` follows from one of them.

1. **React Native, not a web view.** Components compile to real native views — a
   `<View>` becomes a `UIView` on iOS and a `ViewGroup` on Android. You write
   JavaScript; the user touches native widgets.

2. **Expo, not bare React Native.** Expo is the framework wrapped around React
   Native. It ships the native modules (camera, SQLite, notifications) pre-built
   and version-matched, plus the config system (`app.config.ts`) that generates
   the iOS and Android projects for you.

3. **TypeScript in strict mode.** Plus `noUncheckedIndexedAccess` (array access
   returns `T | undefined`) and `noImplicitOverride`. The `@/*` path alias maps
   to `./src/*`.

4. **SQLite on device, no server.** Nothing about the dog leaves the phone. That
   removes accounts, auth, an API, and a privacy policy about data transfer — and
   makes the migration system the most safety-critical file in the repo.

5. **File-based routing.** A file in `app/` *is* a route.
   `app/(tabs)/history.tsx` is the History tab; `app/seizure-detail/[id].tsx` is
   a dynamic route. `typedRoutes` is on, so `router.push()` paths are type-checked.

> **Mental model.** React Native is the renderer. Expo is the toolbox and the
> build system. Expo Router is the navigator. Zustand holds what's on screen right
> now. SQLite holds what's true. Zod polices the border between the last two.

---

## 2. Every package in the project

Status tells you whether the package has real importers in `app/` or `src/`
today — worth knowing, because an unused native module still costs build time and
can still cost you an app review.

### Core framework

| Package | Version | What it does | Status |
|---|---|---|---|
| `expo` | `~57.0.16` | The framework. Native runtime, module registry, config pipeline. | Core |
| `react` | `19.2.3` | Component model, hooks, state. | Core |
| `react-native` | `0.86.2` | Renders components to native views; supplies `View`, `Text`, `StyleSheet`, `Pressable`, `FlatList`. | Core |
| `react-dom` | `19.2.3` | Only needed if the app is ever run on web. Kept for parity with React. | Peer |
| `typescript` | `~6.0.3` | Dev dependency. Compile-time types; never ships in the bundle. | Core |
| `@types/react` | `~19.2.2` | Type definitions for React. Dev dependency. | Core |

### Navigation

| Package | Version | What it does | Status |
|---|---|---|---|
| `expo-router` | `^57.0.16` | File-based routing, nested layouts (`_layout.tsx`), typed paths, deep linking. | Core |
| `react-native-screens` | `~4.26.0` | Backs each route with a real native screen container, so transitions and memory behave natively. | Peer |
| `react-native-safe-area-context` | `~5.7.0` | Reports notch and home-indicator insets. Used by the floating glass tab bar. | In use |
| `expo-linking` | `^57.0.7` | Deep links on the `pawsjournal://` scheme. Required by the router, not imported directly. | Peer |
| `expo-constants` | `^57.0.14` | Reads `app.config.ts` values at runtime. Router dependency. | Peer |
| `react-native-reanimated` | `4.5.1` | Animations that run on the UI thread. Pulled in as a router/screens peer; no direct imports yet. | Peer |
| `react-native-worklets` | `0.10.1` | The worklet runtime Reanimated 4 is built on. Never imported by hand. | Peer |

### Data and state

| Package | Version | What it does | Status |
|---|---|---|---|
| `expo-sqlite` | `^57.0.1` | The database. One connection opened in `src/db/client.ts`, WAL journal mode, foreign keys on. | Core |
| `zustand` | `^5.0.15` | Two small stores: `appStore` (active dog, settings) and `activeSeizureStore` (the in-progress seizure draft). | In use |
| `zod` | `^4.4.3` | Runtime validation at the DB boundary. Every domain type in `src/types/domain.ts` is inferred from a Zod schema. | In use |

### Device and native capabilities

| Package | Version | What it does | Status |
|---|---|---|---|
| `expo-image-picker` | `^57.0.13` | Launches the system camera to record a seizure video, and the library to attach an existing one. Also the dog profile photo. | In use |
| `expo-file-system` | `^57.0.5` | Copies captured media into the app's document directory. Paths stored relative — see migration 7. | In use |
| `expo-notifications` | `^57.0.14` | Local-only medication reminders. No push server exists. | In use |
| `expo-haptics` | `^57.0.1` | Vibration at the 3- and 5-minute seizure thresholds. Redundant channel so colour is never the only signal. | In use |
| `expo-keep-awake` | `^57.0.1` | Holds the screen on during a live seizure. Safety-relevant, not a convenience. | In use |
| `expo-camera` | `^57.0.4` | In-app camera preview. Installed, but **zero importers** — capture goes through the system camera instead. | No importers |
| `expo-print` | `^57.0.1` | Will render the vet report to PDF. Installed ahead of the feature. | Not wired |
| `expo-sharing` | `^57.0.15` | Will open the OS share sheet to send that PDF. Installed ahead of the feature. | Not wired |

### UI and presentation

| Package | Version | What it does | Status |
|---|---|---|---|
| `expo-glass-effect` | `~57.0.1` | Native liquid-glass material. Drives the floating tab bar and primary buttons, with a fallback via `useGlassSupport()`. | In use |
| `expo-blur` | `~57.0.2` | Blur surfaces where the glass effect is unavailable. | In use |
| `expo-linear-gradient` | `~57.0.1` | Gradient fills — header wash, chart backgrounds. | In use |
| `@expo/vector-icons` | `^15.0.2` | Icon set, wrapped once in `src/components/Icon.tsx` so glyph names live in one place. | In use |
| `expo-status-bar` | `~57.0.1` | Controls status-bar style per screen. | In use |
| `expo-font` | `~57.0.1` | Custom font loading. Present as a dependency of the icon set. | Peer |

---

## 3. What is deliberately absent

Knowing what a codebase refuses is as instructive as knowing what it uses.

| Not installed | Reason |
|---|---|
| `redux` / `mobx` | Zustand covers the two pieces of shared state at a fraction of the ceremony. No reducers, no providers. |
| `nativewind` / `styled-components` | Extra build step for no gain at this size. Styling is `StyleSheet` plus the tokens in `src/theme/tokens.ts`. |
| `react-hook-form` | The forms are chip toggles and a handful of text inputs. Plain controlled components are enough. |
| `moment` / `date-fns` / `dayjs` | Native `Date` and `Intl` handle formatting and arithmetic, DST included. Date maths lives in `src/utils/time.ts` and `clock.ts`. |
| `axios` | There is no backend to call. |
| An ORM (Drizzle, WatermelonDB) | Hand-written SQL in repositories keeps the migration path explicit, which matters more than query ergonomics for health records. |

> **The native-config rule this repo follows.** Native configuration lands in the
> same change as the feature that needs it, never ahead of it. Apple checks that
> declared permissions correspond to functionality that actually exists (guideline
> 5.1.1), and Google Play treats an over-broad Data Safety declaration as a policy
> violation in the other direction. That is why `expo-camera` has no plugin entry
> despite being installed.

---

## 4. The layer stack

Data moves down this stack on a write and back up on a read. The rule that makes
it work: **a layer may only talk to the one directly below it.** A screen that
imports `getDb()` has broken the architecture.

| # | Layer | Path | What lives here |
|---|---|---|---|
| 1 | **Screens** | `app/` | 18 route files. They render, collect input, and call stores or repositories. No SQL, no business rules. |
| 2 | **Components** | `src/components/` | 12 presentational pieces — `FloatingTabBar`, `LiquidGlassButton`, `CheckinCalendar`, `ProfileHeader`, `RecordSeizureFab`, `UnfinishedSeizurePrompt`. Props in, JSX out. |
| 3 | **Stores** | `src/store/` | `appStore` holds the active dog, dog list and settings, hydrating from SQLite on launch. `activeSeizureStore` holds the in-flight seizure draft with a pending-writes queue. |
| 4 | **Services** | `src/services/` | Side effects that aren't database work: `videoService`, `dogPhotoService`, `fileStore` (relative ⇄ absolute paths), `medicationReminders` (schedule / cancel / reschedule on timezone change), `saveActiveSeizure` (draft-to-record commit). |
| 5 | **Features** | `src/features/` | Pure computation over already-loaded records, no I/O. `analytics` derives time-of-day bands, duration stats, frequency comparisons and sleep/stress associations, each gated behind a confidence level. `timeline` merges seizures, doses and check-ins into day-grouped sections. |
| 6 | **Repositories** | `src/db/*Repo.ts` | The only place SQL is written. `dogRepo`, `seizureRepo` (607 lines — open, patch, finalize, salvage, discard), `checkinRepo`, `medicationRepo`. Each maps SQL rows to domain objects and back. |
| 7 | **Client & migrations** | `src/db/client.ts`, `migrations.ts` | One lazily-opened connection, the `toSqlBool` / `fromSqlObject` / `fromSqlArray` mapping helpers, and the versioned migration runner. |

---

## 5. Folder map

```
app/                         # every file here is a route
  _layout.tsx                # root layout: DB init, store hydration
  onboarding.tsx             # first-run dog setup
  breed-picker.tsx           # modal, structured breed selection
  dog-profile.tsx
  daily-checkin.tsx
  medication-edit.tsx
  emergency-plan.tsx
  report.tsx                 # vet report
  (tabs)/                    # route group — parens = no URL segment
    _layout.tsx              # the floating glass tab bar
    index.tsx                # Today
    history.tsx
    checkin.tsx
    more.tsx
  seizure/                   # the capture flow, in phase order
    _layout.tsx
    live.tsx                 # the running timer
    post.tsx                 # post-ictal observations
    recovery.tsx             # recovery timing, then save
  seizure-detail/
    [id].tsx                 # dynamic route

src/
  components/                # 12 presentational components
  constants/  breeds.ts      # generated by scripts/build-breeds.ts
  db/         client.ts migrations.ts dogRepo.ts seizureRepo.ts
              checkinRepo.ts medicationRepo.ts
  features/   analytics/ timeline/
  hooks/      useSeizureTimer.ts
  services/   videoService dogPhotoService fileStore
              medicationReminders saveActiveSeizure
  store/      appStore.ts activeSeizureStore.ts
  theme/      tokens.ts glass.ts chrome.ts
  types/      domain.ts      # the whole domain model, one file
  utils/      clock.ts time.ts nav.ts

docs/         ARCHITECTURE · TOOLSET · WORKFLOW · DEVLOG · STACK
ios/                         # generated native project — do not hand-edit
app.config.ts                # the single source of native config
```

---

## 6. Data types

Everything lives in `src/types/domain.ts`. The pattern throughout: define a Zod
schema, then derive the TypeScript type from it with `z.infer` — one definition
serving both compile time and runtime.

```ts
// The pattern, in three lines
export const MedicationSchema = z.object({
  name: z.string().min(1).max(120),
  dose: z.string().max(60),
});
export type Medication = z.infer<typeof MedicationSchema>;
```

### The eight entities

| Type | What it is |
|---|---|
| `Dog` | The subject. Name, structured breed, sex, DOB, weight, diagnosis status, allergies, diet, two vet contacts, emergency plan. |
| `Seizure` | The core record. 30+ fields across lifecycle, timing, pre-ictal, ictal, post-ictal, recovery, context and notes. |
| `Video` | Media attached to a seizure. Stores a path, never bytes — the file lives in the document directory. |
| `Medication` | What the vet prescribed, as the owner typed it. The app never suggests a dose. |
| `MedicationReminder` | A local wall-clock time in its own table, because anticonvulsants are dosed 2–3× daily. |
| `MedicationDose` | What actually happened — a different question from what was prescribed. Owner-reported only. |
| `DailyCheckin` | The control dataset. Without non-seizure days, every "association" is measured against nothing. |
| `Meal` | The one context entity that is already structured rather than free text. |

### Union types (derived from `as const` arrays)

Each vocabulary is declared once as a frozen array. The UI maps over it to render
chips; TypeScript derives the union from the same source with `(typeof X)[number]`.
Add an option in one place and both update.

| Type | Values | Note |
|---|---|---|
| `SeizureStatus` | `'in_progress' \| 'complete' \| 'abandoned'` | Lifecycle of the *record*, not a clinical field. Only `complete` rows reach history or a report. |
| `DurationConfidence` | `'high' \| 'clock_corrected' \| 'recovered' \| 'unreliable' \| 'legacy'` | How far `durationSec` can be trusted on this row. |
| `TimingConfidence` | `'exact' \| 'approximate' \| 'unknown'` | How much the owner trusts their own timestamps. |
| `DiagnosisStatus` | `'undiagnosed' \| 'suspected' \| 'diagnosed'` | Where the dog is in the diagnostic process. |
| `DoseStatus` | `'given' \| 'late' \| 'missed'` | Owner-reported outcome for one scheduled dose. |
| `ActiveStage` | `'live' \| 'post' \| 'recovery'` | Which phase of the capture flow the draft is in. |
| `MovementObservation` | 9 options — `'Stiffening'`, `'Paddling'`, `'Jerking'`, … | Ictal movements. |
| `AwarenessObservation` | 5 options — `'Appears unconscious'`, `'Partially aware'`, … | Consciousness during the event. |
| `AutonomicObservation` | 6 options — `'Drooling/salivation'`, `'Urinated'`, … | Autonomic signs. |
| `PositionObservation` | 5 options — `'Standing'`, `'Sitting'`, `'Lying on side'`, … | Body position at onset. |
| `PreIctalObservation` | 12 options — `'Restlessness'`, `'Anxiety'`, `'Hiding'`, … | Warning signs before onset. |
| `PostBehaviorObservation` | 14 options — `'Confused'`, `'Disoriented'`, `'Very sleepy'`, … | Post-ictal behaviour. |
| `OwnerSeverity` | `'Mild-looking' \| 'Moderate-looking' \| 'Severe-looking' \| 'Unsure'` | Explicitly owner-observed, never a clinical grade. The UI must say so. |
| `Confidence` | `'early' \| 'possible' \| 'repeated' \| 'strong'` | Analytics gate — how much weight a derived pattern may be given. |
| `TimelineEventKind` | `'seizure' \| 'medication' \| 'checkin'` | What kind of event a timeline row represents. |
| `ThresholdLevel` | `'none' \| 'warn' \| 'critical'` | Where the running timer sits against the warn/critical thresholds. |

### Composite and support types

| Type | What it is |
|---|---|
| `Breed` | Structured, never free text — `breedId`, `breedName`, `breedSource`, plus a 200-char owner description. |
| `SeizureContext` | Eight free-text factors: food, sleep, exercise, medication, stress, environment, illness, exposure. A known limitation, documented as one. |
| `VetContact`, `EmergencyPlan` | Owner- or vet-entered only. The app must never generate, suggest or autofill any field. |
| `SeizureFinalize` | The finalize gate. A Zod `superRefine` that **refuses** bad durations rather than correcting them. |
| `SeizureWithVideos` | `Seizure & { videos: Video[] }` — the joined shape for detail screens. |
| `Settings` | Warn/critical minute thresholds, cluster window and count, haptics on/off. Configurable because care plans differ. |
| `StartMark`, `ResolvedDuration` | From `src/utils/clock.ts`. The monotonic + wall-clock pair used to derive an honest duration. |

> **Read `SeizureFinalizeSchema` closely.** Every rule in it is a *refusal*, never
> a correction: a null duration cannot be high confidence, and a zero-second
> seizure is rejected as a mis-tap. A silently repaired duration is
> indistinguishable from a measured one in an export — a refusal produces a
> question, a correction produces a false fact.

---

## 7. SQLite schema and migrations

Ten tables. Version tracked in SQLite's built-in `user_version` pragma; each
migration runs inside a transaction that *also* writes the version bump, so a
crash mid-migration cannot leave a half-applied schema.

### Tables

| Table | Holds | Key indexes |
|---|---|---|
| `dogs` | One row per dog. Breed flattened into four columns; vet, emergency vet and plan stored as JSON. | Primary key only |
| `seizures` | The core record. Observation arrays as JSON strings, context as a JSON object. | `(dog_id, start DESC)` |
| `seizure_edits` | Append-only audit trail of edits to a record. | `(seizure_id, edited_at DESC)` |
| `videos` | Media references. Relative paths, never bytes. | `(seizure_id)` |
| `medications` | Prescriptions as entered by the owner. | `(dog_id)` |
| `medication_reminders` | Local wall-clock reminder slots, one row each. | unique `(medication_id, time)` |
| `medication_doses` | What actually happened, per day per slot. | unique per slot; `(dog_id, dose_date DESC)` |
| `daily_checkins` | The control dataset — one per dog per calendar day. | unique `(dog_id, check_in_date)` |
| `meals` | Structured feeding log. | `(dog_id, timestamp DESC)` |
| `app_state` | Key/value store for settings and the active dog id. | Primary key only |

### Migration history

| # | Name | What it changed and why |
|---|---|---|
| 1 | initial schema | Seven tables. Replaced the web prototype's single JSON blob, which rewrote the whole dataset on every save and could not be queried. |
| 2 | seizure edit audit trail | Added `seizure_edits` without touching the seizures table. |
| 3 | seizure record durability | Added `status`, `duration_confidence`, `last_touched_at`, `tz_offset_min`. Makes SQLite the source of truth from the first tap, so a force-quit mid-seizure cannot lose the record. |
| 4 | check-in day key, reminders, doses | Added `check_in_date` with a unique index, plus the two medication tables. |
| 5 | dog photo | Added `photo_uri` to dogs. |
| 6 | backfilled check-ins | Added a `backfilled` flag — recalled from memory is weaker evidence than recorded that evening, and the analytics engine needs to know which it has. |
| 7 | relative file paths | Rewrote stored media paths to drop the absolute prefix. iOS reassigns the app container UUID on reinstall, so every absolute path written before this pointed at a container that no longer exists. |

### Connection pragmas

```sql
PRAGMA foreign_keys = ON;    -- off by default; ON DELETE CASCADE needs it
PRAGMA journal_mode = WAL;   -- crash-resistant writes, better concurrency
```

> **Never edit a shipped migration.** Add a new one. Editing a migration that has
> already run on someone's phone corrupts their database — their `user_version`
> already says it ran, so the fix never applies.

---

## 8. Patterns worth studying

Six ideas in this codebase that transfer to any app you build next.

### SQLite has no boolean and no array

Booleans are stored as `0`/`1`, arrays and objects as JSON strings. The conversion
lives in exactly one file so it cannot drift between repositories. The subtle part
is reading it back: `'{}'` is valid JSON and is the column *default*, so a naive
parse returns an object where every field is `undefined` — which TypeScript
happily accepts and which throws on the first property read.

```ts
// Merging onto a complete default makes a partial object impossible
export function fromSqlObject<T extends object>(value: string | null, defaults: T): T {
  const raw = fromSqlJson<Partial<T> | null>(value, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...defaults };
  return { ...defaults, ...raw };
}
```

### One `as const` array, two consumers

A vocabulary is declared once. The UI maps over the array to render chips; the
type system derives the union from the same array. There is no second list to
forget to update — and because the strings are stored verbatim in the database,
renaming one would orphan historical records, which the type system now makes
visible.

### The repository pattern

SQL exists only inside `src/db/*Repo.ts`. Screens call `listSeizures(dogId)`, not
a query. This is what makes the schema changeable: migration 7 rewrote every
stored path and no screen needed editing.

### Validate at the boundary, not everywhere

Zod runs where data *enters* the program — coming out of SQLite, or out of an
imported backup. Once a value is a validated `Seizure`, the rest of the code
trusts the TypeScript type and does not re-check. For a local-only app the
justification is specific: this is health data a vet may act on, so a corrupt row
should raise a loud catchable error rather than a silently wrong duration.

### Never trust a UI tick counter for elapsed time

Duration is always derived from an absolute start timestamp and recomputed when
the app returns to the foreground — never accumulated from a `setInterval`. That
is also why the app declares no `UIBackgroundModes`: suspending JavaScript costs
nothing, and declaring a background audio mode you do not use is a documented App
Review rejection (guideline 2.5.4).

### Write the row before you have the data

`openSeizure()` inserts an `in_progress` row on the very first tap.
`patchSeizure()` updates it as the owner moves through phases.
`finalizeSeizure()` flips it to `complete`. If the app dies mid-seizure,
`findUnfinishedSeizure()` and `salvageSeizure()` recover it — using
`last_touched_at` rather than "now", because the owner may find the orphaned row
the next morning and "now" would report a six-hour seizure.

---

## 9. Commands

The distinction that matters day to day: **a JavaScript change needs only Metro;
a native change needs a rebuild.**

### Everyday

```bash
npm start              # expo start — Metro dev server; press i / a to open
npm run start:clear    # same, with the bundler cache wiped
npm run typecheck      # tsc --noEmit — run this before every commit
npm run doctor         # expo-doctor — checks package versions match the SDK
```

### Native builds

```bash
npm run ios            # expo run:ios — compiles native project, installs, launches
npm run android        # expo run:android

npx expo run:ios --device "iPhone 17 Pro"   # pick a simulator explicitly
cd ios && pod install && cd ..              # after adding a native dependency
```

**When do you actually need a rebuild?** Only when native code changes: a new
native module, an edit to the `plugins` array or `infoPlist` in `app.config.ts`,
a permissions change, or anything under `ios/`. Editing a `.tsx` or `.ts` file is
a Fast Refresh — save the file and the simulator updates itself.

### Cloud builds and release

```bash
npx eas build --profile development --platform ios   # your own dev client
npx eas build --profile production --platform ios    # .ipa, built on Expo's Macs
npx eas submit --platform ios                        # upload to App Store Connect
npx eas update                                       # JS-only fix, no store review
```

EAS Build compiles on Expo's machines, which is how an iOS build happens without
a Mac. A local `expo run:ios` needs Xcode; a local `expo run:android` needs
Android Studio.

---

*Palette and terminology in the companion HTML version are taken from the app's
own `src/theme/tokens.ts`.*

---

## Addendum — video library (migration 8)

Three packages were added after this document was first written:

| Package | What it does |
|---|---|
| `expo-media-library` | Saves a seizure video into the phone's Photos app, in a "Paws Journal" album. Requested `writeOnly`. |
| `expo-video` | Playback on the video detail screen. Replaces the deprecated `expo-av` Video component. |
| `expo-video-thumbnails` | Extracts a poster frame at import time for the gallery grid. |

Migration 8 added `imported_at`, `capture_confidence` and `thumb_uri` to
`videos`, and a new `CaptureConfidence` union
(`'device' | 'owner_stated' | 'unknown'`) records how the app knows when a video
was taken. `src/db/videoRepo.ts` is now the single owner of the videos table.

See [Video library, gallery, and the UI pass](VIDEO_AND_DESIGN.md) for the full
rationale.
