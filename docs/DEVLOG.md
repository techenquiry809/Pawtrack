# Development record

Running log of decisions, state and remaining work. Update this at each
milestone so anyone (including future you) can resume without re-deriving
context.

---

---

---

---

---

## Nav bar — real Liquid Glass instead of a blur pretending to be one

**Date:** 2026-08-26
**Status:** shipped. Verified on iPhone 17 and iPad mini (iOS 26.5).

### What was actually there

The island called itself glass and was opaque. Three layers, working against
each other:

    backgroundColor: colors.card          // solid white
    <BlurView intensity={60} />           // blurring the solid white
    rgba(255,255,255,0.72)                // a wash on top of that

Nothing behind the bar reached the eye, so the blur was doing no visible work.
The opaque backing was there for a real reason — iOS needs something to cast a
shadow from — but it also made the whole stack pointless.

### What it is now

`GlassView` from `expo-glass-effect` — the same material the iOS 26 system tab
bar uses. It refracts rather than samples: it bends what passes underneath and
re-tunes its own contrast against it, which is the part a blur cannot imitate.

The package was already present as a transitive dep of `expo` and already
autolinked (it is in `Podfile.lock`), so this needed no native rebuild — but it
is now a DIRECT dependency, because depending on a hoisted transitive is one
`npm dedupe` away from vanishing.

Choices worth keeping:

- **`regular`, not `clear`.** Clear glass is built for photo and video
  backdrops and passes nearly everything through; over a scrolling list of text
  it would put words behind the labels. Regular is the adaptive one.
- **`tintColor` at 6% teal.** Enough that the island belongs to this app rather
  than reading as system chrome. More than that and it stops looking like glass
  and starts looking like tinted plastic.
- **`colorScheme="light"`.** The app is light-themed and does not follow the
  system theme. On `auto`, a dark OS would hand back dark glass and put teal
  labels on a near-black bar.
- **Lighter shadow on the glass path.** Glass carries its own edge and ambient
  shading; the full custom shadow underneath reads as a dark smudge.
- **Translucent active pill.** The opaque `tealTint` that works over a blur
  reads as a plastic chip set into glass, and blocks the transparency at the
  one spot the eye goes first.

### Legibility — measured, not eyeballed

The worry with a genuinely transparent bar is text competing with text. Sampled
straight off the render, with a busy backdrop underneath (dark body copy on
white cards, luminance spread 0.79):

    Home      5.43:1
    Check-in  5.39:1
    More      5.48:1

All above the 4.5:1 AA threshold. Regular glass is doing its adaptive job, so
the transparency cost nothing and none of it had to be walked back.

There is now a `pngcrop.py` in the scratchpad — the machine has no PIL, no
ImageMagick, and `sips` silently ignores `--cropOffset`, so inspecting a strip
of a screenshot at full resolution needed a hand-rolled decoder. Also used for
the contrast sampling above.

### Follow-up — the bar went vivid cyan on Home

Reported as "fix this when clicked the navbar buttons", with the island a
saturated teal slab. It is not a press state. It is the Home screen's solid
teal `Update today's check-in` button (`colors.teal` #2F7E86) sitting directly
under the island, and the glass reporting it honestly at #ACDBE0.

Three wrong diagnoses before that, each disproved by building it:

1. `isInteractive` — plausible (its touch response IS a radial tint) but the
   bar was still cyan at rest with the prop gone. Left removed anyway: it is
   for a glass element that is ITSELF the control, and on a container it
   tints the whole bar on every tap.
2. `tintColor` — removing it entirely changed #A9D9DE to #B0DFE4. Nothing.
3. The teal `Disclaimer` behind the bar — whitened it, no change.

What settled it was hiding the tab bar and screenshotting what was underneath.
Worth doing that first next time; three builds went into guessing at layers
when one build would have shown the answer.

Measured, rather than argued about:

    tab active     island body    label contrast
    Records        chroma 13-30   5.4:1
    Home           chroma 37-53   3.98:1   <- fails WCAG AA

So this was an accessibility failure, not a matter of taste. Home already
applies `contentClearance`, so the button being under the bar is just where it
falls at that scroll offset — any content can pass under a floating bar, which
means the fix has to make the chrome survive an arbitrary backdrop rather than
special-case this screen.

Two changes:

- **`CHROME_INK` #414A5A for inactive tabs.** Chosen by solving for the worst
  measured backdrop, not by eye: `colors.inkSoft` gives 3.98:1 against
  #ACDBE0, #414A5A gives 5.94:1. Still lighter than `colors.ink`, so an
  inactive tab does not shout as loudly as the active one.
- **A 22% white scrim over the glass.** Caps how much of any one colour the
  material can take on. Still a fraction of the 0.72 wash over an opaque
  backing that the blur version used, and the backdrop reads clearly through.

Result on the failing screen: 3.98:1 -> 6.52:1, chroma 47 -> 37. The More tab
(white backdrop) is unchanged.

**This is a knob, not a solved problem.** Glass reports what is behind it; that
is the whole point of it. The scrim alpha trades colour fidelity against
saturation, and 0.22 is a judgement call — worth revisiting if the bar ever
sits over imagery.

### Reduce Transparency

`src/theme/glass.ts` gates the material on two separate questions:

- CAN it — `isLiquidGlassAvailable()`, fixed for the process, read once.
- SHOULD it — Reduce Transparency, which the user can flip WHILE the app is
  open, so it is subscribed to rather than sampled at startup.

Someone who turns that setting on has told the OS that see-through chrome is a
problem for them, and a nav bar is the one piece of chrome they cannot avoid.
When it is on, the bar falls back to the old blur-and-wash treatment — which is
why that code is still in the file rather than deleted. Android and iOS 25 take
the same path.

### Verified

- Glass renders on iPhone 17 and iPad mini; width still capped and centred on
  the tablet.
- Fallback branch was rendered and checked — fully opaque, no bleed-through.
  **Its trigger is untested:** `simctl` cannot toggle Reduce Transparency, and
  writing `com.apple.Accessibility ReduceTransparencyEnabled` directly does not
  reach the app. The branch was forced in code to verify it, then reverted.
  Confirming the detection itself needs a real device.
- tsc clean, all suites pass.

---

## Fix — stored JSON could hand back objects with missing fields

**Date:** 2026-08-26
**Status:** fixed and verified on iPhone 17 and iPad mini.

### The crash

    Cannot read property 'trim' of undefined
    app/(tabs)/more.tsx (83:31)

`more.tsx` computes whether the call buttons have a number to dial:

    const hasVetNumber =
      dog.emergencyVet.phone.trim().length > 0 || dog.vet.phone.trim().length > 0;

`dog.emergencyVet` was `{}`, so `.phone` was `undefined`.

### Why it happened

`fromSqlJson(value, fallback)` returns the fallback only when the column is
falsy or unparseable. `'{}'` is valid JSON, so it parsed to a truthy `{}` and
was returned as-is — typed `VetContact`, but with every field missing.
TypeScript could not catch it: the cast asserts a shape nobody checked.

This was not limited to one bad row. `'{}'` is the COLUMN DEFAULT:

    vet_json            TEXT NOT NULL DEFAULT '{}',
    emergency_vet_json  TEXT NOT NULL DEFAULT '{}',
    emergency_plan_json TEXT NOT NULL DEFAULT '{}',
    context_json        TEXT NOT NULL DEFAULT '{}',

`createDog` writes complete JSON, so dogs made through the app were fine. Any
row that reached the table another way — a migration, a restore, a partial
import — got the default and crashed the More screen on open. It surfaced when
a dog row was inserted directly via SQL while testing tab-bar geometry on the
iPad, which is exactly the schema default reproduced by hand.

### The fix — merge, don't substitute

Two helpers in `src/db/client.ts`, so a partial object cannot be constructed
rather than being guarded against at each of its read sites:

- `fromSqlObject(value, defaults)` spreads the parsed value over a complete
  default, and rejects non-objects (arrays, strings, `null`).
- `fromSqlArray(value)` returns `[]` for anything that is not an array — the
  same bug in reverse, where `'{}'` typed as `string[]` survives compilation
  and throws on the first `.slice()`.

Applied to `dogRepo` (`vet`, `emergencyVet`, `emergencyPlan`) and
`seizureRepo` (`context`, and the four observation arrays).

Fixing the mapping layer rather than `more.tsx` matters because the crash site
was not the only exposed reader — `emergency-plan.tsx` prefills its form from
the same objects, and `report.tsx` renders them.

### Verified

- `jsontest.mjs` replays the exact strings stored on the iPad through both the
  old and new mapping: `'{}'`, `'[]'`, `'"hello"'` all threw before and return
  complete objects now. Well-formed and partial JSON are unchanged.
- More screen renders on the iPad row that crashed — the Emergency plan row
  correctly reads "No vet number yet" instead of throwing.
- iPhone 17 unchanged. tsc clean, all suites pass.
- The hand-seeded `ipaddog` row has been deleted from the simulator.

### Note for later

The Zod schemas in `src/types/domain.ts` exist for exactly this — validating
data coming back out of SQLite — but the repositories do not use them on the
read path. The merge helpers close the crash; running rows through the schemas
on read would close the whole class. Worth doing when the repos are next
touched.

---

## Milestone 6 — Breed on signup, Check-in tab, medication (current state)

**Date:** 2026-08-25
**Status:** built. Sign-up / accounts / sync explicitly NOT built — deferred.

### Audit first

Every path the incoming spec named was absent (`CLAUDE.md`, `db/repositories/`,
`constants/breeds.generated.ts`, `app.json`); the real equivalents are
`docs/`, `src/db/`, an inline `BREED_LIST`, and `app.config.ts`. The breed
picker, its ranked/accent-folded search and its 200-char Zod cap already
existed and exceeded the spec, so they were left alone.

### Migration 4 (`user_version` 3 → 4)

| Change | Why |
|---|---|
| `daily_checkins.check_in_date` + **UNIQUE (dog_id, check_in_date)** | One check-in per day is now a DATABASE guarantee. The old `upsertTodaysCheckin` read-then-branched, which two rapid saves can race past |
| Backfill via `date(timestamp/1000,'unixepoch','localtime')` | Local day, so an 11pm check-in files under the day the owner means |
| **Dedupe before the index** | A unique index fails outright against existing duplicates. Keeps the most recently updated row per day |
| `medication_reminders` | Its own table, not a nullable column — anticonvulsants are dosed 2–3× daily |
| `medication_doses` | What actually happened, which is a different question from what was prescribed |

`medications.scheduled_time` and `notification_id` are now dead and
deliberately left in place: a dead column costs nothing, `DROP COLUMN` on a
shipped table does not.

### Reminders

`DailyTriggerInput`, never `timeInterval`. An interval trigger fires every
86,400s from when it was set, so it drifts and keeps firing at the OLD local
time after the owner travels. `rescheduleIfTimezoneChanged()` runs on
foreground, compares the UTC offset first, and rebuilds only when it moved.

Permission is requested when the owner enables their FIRST reminder, never at
launch. Declining is a supported state — the list and dose log keep working and
the card explains how to enable them later.

Notification body: `"Phenobarbital for River — scheduled dose: 60mg"`. Nothing
else. Lock screens are readable by anyone holding the phone.

`expo-notifications` earned its plugin entry back, along with
`POST_NOTIFICATIONS`. `SCHEDULE_EXACT_ALARM` stays out — a daily reminder does
not need second-accuracy, and it is Play-policy restricted.

### Timeline was moved, not deleted

The tab slot went to Daily Check-in. The merge logic moved to
`src/features/timeline/` and is now History's "Everything" filter. Both of
History's filters stay: "what am I looking at" and "how far back" are
orthogonal.

### Home was not touched

`app/daily-checkin.tsx` became a redirect into the tab, so Home's
"Update today's check-in" button is byte-identical. The red Record seizure
button is untouched and still first on the screen.

### Verified

- Migration replayed against SQLite including the hard case: two same-day
  check-ins collapse to the newest, a third is then rejected by the index
- **On device**: `user_version` 4, both tables, 28 rows backfilled, and a
  direct duplicate INSERT is refused — `UNIQUE constraint failed`
- A safety scan asserts no advice language in any user-facing string across six
  files, that the missed-dose line defers to the vet, that the notification
  body carries no diagnosis, that permission is never requested from the root
  layout, and that onboarding has no free-text breed field
- `tsc` 0 errors · `expo-doctor` 21/21 · all earlier suites still pass

### Fixed in passing

`src/constants/breeds.ts` read `BREED_LIST: BreedOption[] = [] = [` — a stray
zero-target destructuring assignment from the Milestone 4 rewrite. Valid JS, so
it typechecked and all 235 breeds loaded; it worked by accident.

### Still open

- `seizure-detail` remains read-only, so History still has no "+ Add seizure
  record" button
- Tapping a reminder deep-links to the medication section, but iOS response
  handling is not wired to a specific medication yet

---

## Milestone 5 — The four remaining tabs

**Date:** 2026-08-25
**Status:** Timeline, History, Patterns and More built; `seizure-detail` built
read-only to stop three surfaces dead-ending into it

### What the specs assumed, and what was actually there

An audit before writing any code found three of the four screens depended on
things that do not exist:

| Spec said | Reality |
|---|---|
| Timeline merges "seizures + medAdmins + checkins" | **`medAdmins` does not exist** — no table, no type, no repo. `medications` stores a prescription, not a dose given. Timeline merges the two real sources; the filter offers no Medication option rather than one that is always empty. |
| Patterns shows meal-timing associations | `meals` has a table but **no repository, and nothing writes to it** — the association would be computed over a permanently empty set. Sleep and stress associations shipped instead; both are backed by real check-in data. |
| History has "+ Add seizure record" → shared edit screen | The edit screen did not exist. The button is **deliberately absent** until it does. |
| More links to profile / medications / vet-report / settings | **Four of five routes do not exist.** More links to what exists and *implements* the settings inline instead. |

### Patterns

`src/features/analytics/` holds pure functions — no SQL, no React, and `now` is
always a parameter, so every safety rule is testable rather than reviewable.

The hard rule is enforced by TYPE, not by an `if` in the screen:
`buildPatternReport` returns a discriminated union, so below three seizures
there is no shape in which a chart could be rendered. A future edit to the
screen cannot leak one past the gate.

Two judgement calls worth keeping:
- **Median, not mean.** One 20-minute cluster drags a mean far enough to make a
  typical seizure look longer than it is. An owner reading "average 6 minutes"
  would reasonably panic.
- **Frequency comparison refuses to run** on under 30 days of baseline. A
  first-month user dividing by nine days sees wild swings that mean nothing.

### The colour-blindness finding

The Timeline spec called for red seizure / green medication / teal check-in.
Run through the palette validator, that pairing **fails hard**:

```
CVD separation  FAIL  green<->red  dE 5.1 (deutan)
Normal-vision   FAIL  teal<->green dE 9.2  (below the 15 floor)
Chroma floor    FAIL  brand teal reads grey at dot size
```

A deuteranopic reader — roughly 1 in 12 men — could not tell a seizure dot from
a medication dot. Amber replaces green, which also frees green to stay a
reserved STATUS colour ("Done") rather than doubling as a category. The final
set `#C63F35 / #B8801F / #0090A0` passes all five checks and lives in
`theme/tokens.ts` as `eventColors`, documented as data-encoding hues distinct
from the brand palette. Colour is never the only channel: every event also
carries a glyph and a text label.

### Bug found while verifying

**Home printed "0s" for an untimed seizure.** It formatted `durationSec`
directly without consulting `durationConfidence`, so a record the app had
explicitly refused to time rendered as a zero-second seizure — and fed the
30-day average. The analytics module already excluded those; Home did not. Both
the pill and the average now respect confidence.

Found because a real app-created record with `duration_sec = 0` was sitting in
the simulator database, not because a test caught it.

### Verified

- `tsc --noEmit` clean · analytics unit-tested, including a **causation-language
  gate** that scans every emitted string for causal verbs while allowing
  explicit denials ("an association, not a cause")
- Palette validated with `scripts/validate_palette.js`, not eyeballed
- Rendered on the iPhone 17 simulator against seeded data (7 seizures,
  28 check-ins)

### Still open

- `seizure-detail` is READ + DELETE. Field editing is the next increment, and it
  unblocks two deferred things: History's "+ Add seizure record", and the
  crash-recovery prompt's "Finish it now" action.
- Medication administrations need a table, a migration and a repo before
  Timeline can show them.
- `meals` still has no repository, so meal-timing associations remain unbuilt.

---

## Milestone 4 — Breed picker

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
3. ~~**History list**~~ — done in Milestone 5 — `app/(tabs)/history.tsx`
4. **Seizure detail / edit / retrospective create** — `app/seizure-detail/[id].tsx`
5. ~~**Breed picker**~~ — done in Milestone 4
6. **Daily check-in** — `app/daily-checkin.tsx`
7. **Emergency plan** — `app/emergency-plan.tsx`
8. ~~**Timeline**~~ — done in Milestone 5 — `app/(tabs)/timeline.tsx`
9. ~~**Analytics**~~ — done in Milestone 5 — `app/(tabs)/analytics.tsx` + `src/features/analytics/`
10. **Medications + reminders** — needs `src/db/medicationRepo.ts` and
    `src/services/notificationService.ts`
11. **Vet report PDF** — `src/features/report/` using expo-print + expo-sharing
12. ~~**More/settings hub**~~ — done in Milestone 5 — `app/(tabs)/more.tsx`

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
