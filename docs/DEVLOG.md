# Development record

Running log of decisions, state and remaining work. Update this at each
milestone so anyone (including future you) can resume without re-deriving
context.

---

---

---

## Milestone 4 — Breed picker (current state)

**Date:** 2026-08-25
**Status:** `app/breed-picker.tsx` built; catalogue upgraded with aliases,
ranked search and quick picks

### Why this screen is not cosmetic

Median age of onset for canine idiopathic epilepsy is around 2.5 years, and
predisposition is documented for a specific set of breeds. Breed lands on a vet
report beside a date of birth and a seizure history, so it is clinical context.

### Layout decisions

- **Search is not first, and not autofocused.** With 235 rows the instinct is
  search-first, but raising the keyboard on mount hides two-thirds of the screen
  and forces typing on someone who may be holding a dog one-handed. Order is
  pinned answers → quick picks → search → full list.
- **"I don't know" is a first-class answer**, same visual weight as Labrador
  Retriever. An owner who has just watched their dog seize must never be blocked
  by a question about pedigree.
- Quick picks are ordered by documented epilepsy prevalence, not general
  popularity — the population installing a seizure tracker is not the general
  dog population. The ordering is invisible to the user.

### The deliberate omission

`EPILEPSY_PREDISPOSED` is stored in `src/constants/breeds.ts` and **never
rendered**. Badging "epilepsy-prone" beside Beagle during onboarding alarms an
owner who has no diagnosis and edges the app toward implying one — the clearest
possible violation of the rule at the top of `docs/ARCHITECTURE.md`. It earns
its keep silently, by ordering the quick picks. A test asserts the screen never
imports it.

### Provenance — the count was wrong, and the shape tells us what to do

The list holds 235 breeds tagged `curated-v1`, a number that matches no
registry (FCI ~350, AKC ~277). Its SHAPE, though, is unambiguously AKC:

- Belgian Shepherd is split into Malinois / Sheepdog / Tervuren — AKC practice;
  the FCI treats them as one breed with four varieties.
- Poodle is split into Standard / Miniature / Toy — likewise AKC.

**So regenerate from AKC, not FCI.** Rebuilding on FCI nomenclature would merge
those entries and orphan every stored `breed_id` pointing at one.
`scripts/build-breeds.ts` is written for this and reports which slugs would
disappear rather than removing them. Vendoring a dataset is still an open
decision — check the source licence first (breed names are facts, but a compiled
database can carry sui generis database rights in the EU).

**Known data defect:** `cocker-spaniel`, `american-cocker-spaniel` and
`english-cocker-spaniel` all exist. AKC recognises only the first (which IS the
American) and the third. Merge on regeneration, with a migration — not by hand.

### Verified

- Accent folding: typing "Lowchen" finds Löwchen; likewise both Basset Griffon
  Vendéens. This is why `normalize()` strips combining marks.
- Prefix ranking: "col" → Collie, Bearded Collie, Border Collie (not Cocker).
- Aliases resolve: alsatian, sausage dog, westie, sheltie, corgi, mutt,
  "no idea", tervuren.
- All 12 quick picks and all 15 predisposed slugs resolve against BREED_LIST;
  a `__DEV__` guard fails loudly if one ever does not.
- Rendered on the iPhone 17 simulator: pinned answers, quick picks, no keyboard
  raised, no predisposition badges.

### Bug found and fixed during the build

A search matching nothing returned zero rows, and the pinned answers are hidden
while searching — so the empty state told the owner to "choose Something else
above" when nothing was above. The one screen that must never dead-end, did.
The empty state now renders the three pinned answers inline.

### Also

- `userEnteredDescription` capped at 200 chars in `BreedSchema`. It is the only
  owner-controlled string here and it is destined for a generated vet report —
  when that ships as HTML through expo-print it must ALSO be escaped at render.
  A length cap does not close an injection vector.
- `scripts/` excluded from the app tsconfig: it is Node tooling, and adding
  `@types/node` would change `setTimeout`'s return type across the RN codebase.

---

## Milestone 3 — Seizure durability

**Date:** 2026-08-25
**Status:** SQLite owns the seizure record from the first tap

### The change

The draft used to live in memory until `recovery.tsx` committed it, which made
the Zustand store the source of truth for the whole duration of a seizure — an
exception to the app's own rule that SQLite holds one copy of a record. A
force-quit or OS memory kill in that window lost the seizure entirely, and since
the owner is often holding the camera open at that moment, the kill is expected
behaviour rather than an edge case.

The exception is now removed rather than patched around:

```
openSeizure()      first tap — row exists, status = 'in_progress'
patchSeizure()     every phase transition and observation change
finalizeSeizure()  recovery screen — status = 'complete', now visible
```

A row that survives a crash is found on the next launch **and on every return to
the foreground** (the case that actually matters — iOS kills backgrounded apps)
and handed back to the owner by `UnfinishedSeizurePrompt`.

### Schema — migration v3 (`user_version` 2 → 3)

| Column | Purpose |
|---|---|
| `status` | `in_progress` / `complete` / `abandoned`. Lifecycle of the record, never a clinical field. `DEFAULT 'complete'` backfills existing rows — get that wrong and every historical seizure disappears. |
| `duration_confidence` | `high` / `clock_corrected` / `recovered` / `unreliable` / `legacy` |
| `last_touched_at` | Last phase transition, so a recovered row gets an honest end time instead of "now" |
| `tz_offset_min` | Minutes ahead of UTC at capture, so a past record survives the owner travelling |
| `idx_seizures_status_start` | Serves the orphan lookup and every history query |

### Monotonic clock guard — `src/utils/clock.ts`

`Date.now()` reads the wall clock, which the OS can move backwards via an NTP
sync or a timezone change. In most apps that is cosmetic; here it corrupts a
figure a vet may adjust a dose from. Durations now prefer `performance.now()`,
which only counts forward, and record how far the result can be trusted.

`startedAtMono` is deliberately never persisted — its origin is session-specific,
so its absence after relaunch is precisely how an orphan is detected.

### Verified

- `tsc --noEmit` clean · `expo-doctor` 21/21
- **Migration replayed as a real upgrade** against SQLite: a v2-era row seeded
  before v3 ran came out `complete` / `legacy` and stayed visible in history.
- **Lifecycle replayed**: open → patch → finalize; the `status = 'in_progress'`
  guard rejects a late write to a finalized row; salvage derives 38s from
  `last_touched_at` rather than hours from "now"; discard is soft; neither
  partial nor abandoned rows reach a history query.
- **Clock guard unit-tested** with a controllable wall clock: a one-hour jump
  backwards *and* forwards both still yield 60s / `clock_corrected`; a missing
  monotonic clock self-reports `unreliable`; a 9-hour duration is refused as
  null rather than recorded.
- Every `FROM seizures` audited — all SQL is confined to `seizureRepo.ts`, and
  every list/aggregate read filters `status = 'complete'`. `getSeizure(id)` is
  the one deliberate exception, because recovery must see a partial row.

### Also in this milestone

- **`app/emergency-plan.tsx` built.** Until now the emergency-vet buttons on the
  live screen could never work, because there was nowhere in the app to enter a
  phone number. Treatment fields carry no placeholder text — a suggestive
  example reads as the app recommending something.
- **Plugin hygiene.** `expo-camera` and `expo-notifications` plugin entries
  removed (no importers), along with the unused `POST_NOTIFICATIONS` and
  policy-restricted `SCHEDULE_EXACT_ALARM` Android permissions.

### Two corrections to the durability spec as written

1. **The camera usage strings must stay.** The spec said to delete purpose
   strings that exist "solely to serve" the removed plugins. `NSCameraUsageDescription`
   looks like it belongs to `expo-camera`, but it is required by
   `expo-image-picker`, which *is* used — `videoService.launchCameraAsync()`.
   iOS hard-crashes an app that touches the camera without a usage string, so
   following that step literally would crash seizure video recording.
2. **Removing a plugin entry does not unlink the pod.** `ExpoCamera` is still in
   `Podfile.lock` after the change, because Expo autolinks native modules from
   `package.json` independently of the `plugins` array. Permissions are correct
   now, which is what App Review checks — but to remove the native weight the
   package itself has to be uninstalled.

### Still open

- `UnfinishedSeizurePrompt` deliberately has **no "Finish it now" action**.
  `app/seizure-detail/[id].tsx` is still a placeholder, so routing there would
  leave the row `in_progress` and the prompt would reappear on every foreground,
  forever. Add the action in the same PR as the detail editor.
- Group A (crash), B (clock) and C (emergency control) were verified at the SQL
  and unit level. Running them as on-device manual tests still needs doing,
  A3 especially — an OS kill while backgrounded.

---

## Milestone 2 — Critical path closed + bug fix pass

**Date:** 2026-08-25
**Status:** the seizure record → save → dashboard loop works end to end

### The blocker this milestone removed

`app/seizure/post.tsx` and `app/seizure/recovery.tsx` were placeholders with no
navigation and no save. `live.tsx` sent the owner to `/seizure/post` when they
stopped the timer, and the emergency stack has no tab bar and no back gesture —
so the flow **dead-ended**: the seizure could not be saved, and the only way out
of the app was a force-quit. Both screens are now built, and `recovery.tsx`
commits the record.

### Bugs found and fixed

| # | Bug | Where | Why it mattered |
|---|---|---|---|
| 1 | `npm install` failed outright (ERESOLVE: `react-dom@19.2.8` peers `react@19.2.8`, root pinned `react@19.2.3`); the committed lockfile encoded the same conflict, so `npm ci` failed too | `package.json`, `package-lock.json` | Nobody could install the project |
| 2 | Seizure flow dead-ended at a placeholder — no save, no way back | `app/seizure/{post,recovery}.tsx` | Total data loss for every recorded seizure |
| 3 | `useActiveSeizure((s) => s.draft?.firedThresholds ?? [])` returned a fresh array each call | `src/hooks/useSeizureTimer.ts` | Zustand v5 compares snapshots with `Object.is`; a new array every render means "Maximum update depth exceeded" the moment the draft is cleared |
| 4 | `startedAt = draft?.startedAt ?? Date.now()` changed every render | `app/seizure/live.tsx` | Restarted the timer's interval continuously whenever the draft was null |
| 5 | Cluster-check effect depended on the whole `draft` object | `app/seizure/live.tsx` | Re-ran the DB query on every chip tap during a seizure, despite the comment saying "once, when the screen mounts" |
| 6 | `PRAGMA user_version` was written *after* the migration transaction committed | `src/db/migrations.ts` | A crash in that gap replays the migration against tables that already exist — the app would then fail to start, permanently. `user_version` is transactional, so it now lives inside the transaction |
| 7 | `getDb()` cached a rejected promise forever | `src/db/client.ts` | One transient open failure disabled the database for the whole process |
| 8 | Emergency-vet button gated on `Linking.canOpenURL('tel:…')` | `app/seizure/live.tsx` | Android 11+ returns `false` without a `<queries>` manifest entry, so the button would refuse to dial during an emergency. Now it calls and only reports a real failure |
| 9 | Discarding a live seizure orphaned recorded videos on disk | `app/seizure/live.tsx` | Videos are copied to permanent storage on capture; nothing referenced or could delete them afterwards |
| 10 | `formatDuration` rounded the seconds remainder, producing `1m 60s` | `src/utils/time.ts` | Reads as a bug on a vet report |
| 11 | Today's check-in window was `startOfDay(now) + DAY_MS` | `src/db/checkinRepo.ts`, `src/utils/time.ts` | A local day is 23 or 25 hours on a DST change, so a late check-in could be missed or duplicated. Now uses `startOfNextDay()` |
| 12 | `UIBackgroundModes: ['audio']` declared with no audio playback | `app.config.ts` | Does not keep the timer running (it never needed to — absolute timestamps), and is an App Review rejection under guideline 2.5.4 |
| 13 | `react-native-safe-area-context` / `react-native-screens` floated above the versions Expo SDK 57 was tested against | `package.json` | Untested native module versions; `npx expo-doctor` now passes 21/21 |
| 14 | `activeSeizureStore.ts` claimed it persisted the draft to storage; it never did | `src/store/activeSeizureStore.ts` | A false claim in the most safety-critical file. Comment corrected and the gap is listed below |
| 15 | The native iOS build failed to compile: `react-native-reanimated@4.6.0` arrived via an unpinned `*` peer of expo-router and pulled `react-native-worklets@0.12.1`, but `expo-modules-core@57.0.13` needs `0.10.x` — `WorkletRuntime::executeSync` no longer exists in 0.12 | `package.json` | `npx expo run:ios` / any EAS dev build died with xcodebuild error 65. Both are now pinned to the SDK 57 versions (4.5.1 / 0.10.1) |

### Verified
- `npx tsc --noEmit` → **0 errors**
- `npx expo export --platform ios` → bundles successfully
- `npx expo-doctor` → **21/21 checks pass**
- **Ran on an iOS simulator (iPhone 17) for the first time.** Native build
  compiles with 0 errors, the app launches, onboarding renders, a dog profile
  saves, and the Home dashboard renders that dog with live stats.
- **SQLite verified against a real device filesystem** — the simulator's
  `Documents/SQLite/paws-journal.db` came back with `user_version = 2`,
  `journal_mode = wal`, all 8 tables, all 6 indexes, and a correctly written
  `app_state.activeDogId`. This closes three of Milestone 1's "not yet
  verified" items.
- The migration DDL and every repository statement replayed against a real
  SQLite engine: `end` (a keyword) works as a column name, both `ON DELETE
  CASCADE` chains fire, the `app_state` upsert works, and `PRAGMA user_version`
  is confirmed transactional.

### New files
```
src/services/saveActiveSeizure.ts   Draft -> database, videos attached after
app/seizure/post.tsx                Post-seizure questions (was a placeholder)
app/seizure/recovery.tsx            Recovery timer + the save step
```

### Top remaining gap
The active seizure draft lives in memory only. A force-quit or OS kill
mid-seizure loses the start time. Closing this means persisting the draft to
`app_state` on every mutation, restoring it in `appStore.hydrate()`, and
offering an explicit "resume this recording?" choice on Home — never
auto-navigating back into a live timer.

---

## Milestone 1 — Foundation

**Date:** initial build
**Status:** foundation complete and verified

### Verified working
- `npx tsc --noEmit` → **0 errors**
- `npx expo export --platform ios` → **bundles 1,276 modules successfully**

That means routing, imports, and native module wiring all resolve. It does
**not** mean the app has been run on a device — see "Not yet verified" below.

### Tooling installed
Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript 6 (strict)

### Packages installed
| Package | Purpose |
|---|---|
| expo-router, react-native-screens, react-native-safe-area-context, expo-linking, expo-constants | File-based navigation |
| expo-sqlite | Local database |
| zustand | State management |
| zod | Runtime validation |
| expo-image-picker, expo-file-system, expo-camera | Video record + upload |
| expo-notifications | Medication reminders |
| expo-keep-awake, expo-haptics | Seizure-screen safety/accessibility |
| expo-print, expo-sharing | Vet report PDF + share |

### Architecture decisions
See `docs/ARCHITECTURE.md` for full reasoning. Summary:
1. **SQLite over a JSON blob** — the web prototype rewrote all data on every
   save. Unacceptable for health records.
2. **Repository pattern** — no SQL in components.
3. **Zustand over Redux/Context** — selector subscriptions matter for a screen
   updating once per second.
4. **Absolute timestamps for the timer** — never a tick counter. Safety-critical.
5. **Emergency flow outside the tab navigator** — no accidental navigation
   mid-seizure.
6. **Video files on disk, paths in the DB** — never blobs in SQLite.
7. **No backend for v1** — strongest privacy story; add only when
   multi-caregiver sync genuinely requires it.

### Files created
```
app.config.ts                     Permissions, bundle ids, plugins
tsconfig.json                     Strict mode + @/* path alias
app/_layout.tsx                   DB init, migrations, error/loading gate
app/(tabs)/_layout.tsx            Five-tab navigator
app/(tabs)/index.tsx              Home — COMPLETE
app/(tabs)/{timeline,history,analytics,more}.tsx   Routed, placeholder UI
app/seizure/_layout.tsx           Emergency stack, gestures disabled
app/seizure/live.tsx              Live timer — COMPLETE
app/seizure/{post,recovery}.tsx   Routed, placeholder UI
app/seizure-detail/[id].tsx       Routed, placeholder UI
app/onboarding.tsx                COMPLETE
app/{breed-picker,daily-checkin,emergency-plan}.tsx  Routed, placeholder UI
src/theme/tokens.ts               Design tokens (ported from web CSS vars)
src/types/domain.ts               Types + Zod schemas + option vocabularies
src/db/client.ts                  Connection + mapping helpers
src/db/migrations.ts              Versioned schema (v1 + v2 audit trail)
src/db/{dogRepo,seizureRepo,checkinRepo}.ts   Data access
src/store/{appStore,activeSeizureStore}.ts    State
src/hooks/useSeizureTimer.ts      Timer + thresholds + haptics + keep-awake
src/services/videoService.ts      Camera/library capture + file persistence
src/components/{ui,Placeholder}.tsx           Design system
src/constants/breeds.ts           235 standardized breeds + search
src/utils/time.ts                 Duration/clock formatting
```

### Features complete
- [x] Project setup, strict TypeScript, path aliases
- [x] SQLite schema with versioned migrations + audit-trail table
- [x] Repository layer for dogs, seizures, check-ins
- [x] Design system matching the original app's visuals
- [x] Tab navigation + emergency flow separation
- [x] Onboarding
- [x] Home dashboard (stats, breed entry, check-in status)
- [x] **Live seizure timer** — absolute timestamps, 3/5-min thresholds,
      cluster detection, haptics, keep-awake, observation chips,
      Record Video above the fold, emergency contacts at the bottom
- [x] Video capture + library upload + permanent file storage
- [x] 235-breed standardized list with search

### Features remaining (suggested order)
1. ~~**Post-seizure screen**~~ — done in Milestone 2
2. ~~**Recovery screen** + save pipeline~~ — done in Milestone 2
3. **History list** — `app/(tabs)/history.tsx`
4. **Seizure detail / edit / retrospective create** — `app/seizure-detail/[id].tsx`
5. ~~**Breed picker**~~ — done in Milestone 4
6. **Daily check-in** — `app/daily-checkin.tsx`
7. **Emergency plan** — `app/emergency-plan.tsx`
8. **Timeline** — `app/(tabs)/timeline.tsx`
9. **Analytics** — `app/(tabs)/analytics.tsx` + `src/features/analytics/`
10. **Medications + reminders** — needs `src/db/medicationRepo.ts` and
    `src/services/notificationService.ts`
11. **Vet report PDF** — `src/features/report/` using expo-print + expo-sharing
12. **More/settings hub** — `app/(tabs)/more.tsx`

### Not yet verified (be honest about this)
- **Never run on a real device or simulator.** Bundling proves the code
  resolves; it does not prove runtime behaviour.
- Camera permission flow — needs a physical device
- Notification scheduling — behaves differently on simulator vs. device
- SQLite migrations against a real device filesystem
- Background/foreground timer accuracy — **test this first and hardest**

### Known gaps carried from the original app
- No multi-caregiver support; schema has no user concept
- Seizure context fields are free text, not linked structured entities
- No standalone food/sleep/exercise/symptom/exposure logs
- No cloud backup — videos live only on the device
- No vet document attachments (lab reports, imaging)

### Configuration required before release
- [ ] Replace app icon and splash in `assets/`
- [ ] Confirm bundle id `com.pawsjournal.app` in `app.config.ts`
      (**permanent once published — change it before first submission**)
- [ ] `eas init` to generate the EAS project id
- [ ] Apple Developer account ($99/yr) for TestFlight + App Store
- [ ] Google Play Developer account ($25 once)
- [ ] Privacy policy URL (required by both stores even with no data collection)
