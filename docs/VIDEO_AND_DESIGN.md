# Video library, gallery, and the UI pass

What changed, why each decision went the way it did, and how to run it.

Companion to `ARCHITECTURE.md` (principles), `STACK.md` (inventory) and
`DEVLOG.md` (history).

---

## Part 1 — Design review

### What is wrong with the current screens

I looked at Today, the live timer, and the post-seizure form. The problems are
not decoration; they are hierarchy and honesty.

**1. Today has seven cards and no primary.**
Dog profile, four stat tiles, last seizure, daily check-in — every one is a
white rounded rectangle on cream with the same border, the same radius, and the
same shadow. Only "Record seizure" breaks out, and it does so by shouting in
full red. The eye has one loud thing and six identical quiet things, which is
not a hierarchy, it is an alarm next to a list.

**2. The four stat tiles claim to be equal facts. They are not.**
"0 days since last seizure" is alarming. "2m 36s average duration" is
reference material an owner reads once a month. Rendering them at the same size,
weight and colour tells the owner they matter equally. The days-since number is
the one an owner opens the app to see; it should be visibly the largest thing on
the screen after the record button.

**3. "Choose Breed" is onboarding stranded in a summary card.**
It sits inside the dog profile card, competing with Lucy's name for attention,
and it will sit there forever even though the breed is already set to Labrador
Retriever. A set value does not need a call-to-action next to it. The whole card
should be tappable to edit, with a chevron.

**4. The live screen is a wall of thirty identical chips.**
Movement, Awareness, Autonomic signs and Body position render as one
undifferentiated field of white pills. The group labels are 11px uppercase; the
section label above them is *also* 11px uppercase. Two label levels at the same
size is one label level. Under stress, this is unreadable.

**5. Selection state is invisible without reading every chip.**
Nothing tells you "3 selected in Movement" — you have to scan all nine.

**6. Chip rows wrap raggedly.** "Trembling / Muscle twitching" leaves half a row
empty, then "Head/neck extension / Facial movements" fills it. Nothing is wrong
with flow layout, but with no rhythm the wall reads as noise.

**7. "Seizure ended — stop timer" was two scrolls below the fold.**
This is the worst one. The owner needs that button at the exact unpredictable
moment the seizure stops. A scroll gesture between the event and its recorded
end time is a measurement error with a UI cause.

**8. The timer is a number with no context.**
68px of tabular figures, and nothing that says "you are forty seconds from the
threshold your vet told you about". The thresholds are configurable per care
plan and the owner cannot do arithmetic right now.

**9. The post-seizure form has no visible end.**
A long optional questionnaire with no sense of how much remains reads as a
demand, not an offer — exactly wrong five minutes after a seizure. And the
Continue button was at the bottom, so an owner who wanted to answer nothing
(which is allowed) still had to scroll past every question to leave.

**10. A real formatting bug.** The post screen said
**"827m 33s since the previous recorded seizure."** `formatDuration` was written
for seizure lengths, which are minutes, and never rolls into hours. The gap
*between* seizures is hours or days, and it is the number an owner is most likely
to quote to their vet.

---

### The system I applied

Not a repaint. The palette in `src/theme/tokens.ts` is already good and was
already validated for colour-vision deficiency — it stays exactly as it is. What
was missing was **structure**.

#### Two label levels, and only two

Three competing label styles at one weight is no hierarchy. There are now
exactly two, and they are visually unmistakable:

| Level | Component | Looks like | Used for |
|---|---|---|---|
| Structural | `SectionRule` | 11px 800-weight caps + count badge + hairline running to the edge | Scannable dividers: *Movement*, *Emergency contacts* |
| Interrogative | `QuestionLabel` | 16px sentence case, no rule, optional hint line | Things being asked: *How is Lucy behaving now?* |

The hairline is what makes the first read as a level *above* the second rather
than beside it. Letter-spacing and colour alone were not enough at 11px.

**Do not add a third level.** If something does not fit these two, it is a
`Card`.

#### Count badges make selection visible

`SectionRule` takes a `count`. A group with three answers shows a teal `3`; a
group with none shows nothing at all. Omitting the badge at zero is deliberate —
"0 selected" reads as a failure state, an absent badge reads as "nothing yet",
which is what an optional field deserves.

#### Commit actions are pinned

New `ActionBar` component: the primary action sits above the home indicator with
a hairline top border, always reachable. Applied to the live screen (stop timer),
the post screen (continue), and the import screen (save).

#### Progress is named, not dotted

`StepTrail` spells out **During → Afterwards → Recovery**. A row of bare dots
tells you there are three steps but not what they are, which is not reassurance.

#### The timer gets a track

`ThresholdTrack` on the live screen fills toward the warn mark and then the
critical mark, both drawn from the owner's *own* configured thresholds and
labelled in minutes. It is scaled so the critical mark sits at 80% of the track,
leaving visible room beyond it — a bar that pins at 100% the moment it turns red
stops conveying anything at exactly the point the information matters most.

---

## Part 2 — What was built

### The honesty problem at the centre of it

The feature is "let owners import videos they already have". The hard part is
not the file copy. It is this:

> `expo-image-picker` hands back a temporary copy of the chosen asset with **no
> reliable original capture date**. The temp file's own timestamps are the time
> of the copy, which is now.

So there is no honest way to derive when an imported seizure happened. The app
does not guess. It asks, and then it *records that it asked* — because a
recalled date and a stopwatch date must never be presented identically in a
gallery, and certainly not in a vet report.

This mirrors the rule `DurationConfidence` already sets, and the refusals in
`SeizureFinalizeSchema`: on a health record, a silent repair is
indistinguishable from a measurement.

### Migration 8

```sql
ALTER TABLE videos ADD COLUMN imported_at INTEGER NOT NULL DEFAULT 0;
UPDATE videos SET imported_at = timestamp WHERE imported_at = 0;

ALTER TABLE videos ADD COLUMN capture_confidence TEXT NOT NULL DEFAULT 'device';
UPDATE videos SET capture_confidence = 'unknown'
 WHERE source IN ('uploaded', 'legacy');

ALTER TABLE videos ADD COLUMN thumb_uri TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_videos_timestamp ON videos(timestamp DESC);
```

The column meanings shifted, which is the point:

| Column | Means |
|---|---|
| `timestamp` | **when the seizure in this video happened** |
| `imported_at` | when the file entered the app — always measured |
| `capture_confidence` | how the app knows the timestamp |

`capture_confidence` is **not** backfilled to `'device'` for every existing row.
Rows written by the old import path never had a real capture time, so they are
backfilled `'unknown'` rather than dressed up as measured.

### New type

```ts
export const CAPTURE_CONFIDENCES = ['device', 'owner_stated', 'unknown'] as const;
```

| Value | Meaning | Gallery badge |
|---|---|---|
| `device` | the app was running the timer | none |
| `owner_stated` | the owner typed the date from memory | amber "Your date" |
| `unknown` | imported before this was asked for | amber "No date" |

A badge on every tile is a badge on none, so `device` shows nothing.

### The videos table now has exactly one owner

`src/db/videoRepo.ts` is new and owns all video SQL. `seizureRepo` re-exports
`attachVideo` / `detachVideo` from it so existing call sites keep working, and
`getSeizure` now calls `videoRepo.listForSeizure` instead of querying the table
itself. That duplicate column list is exactly how the two copies would have
drifted apart when migration 8 landed.

**Shape change to note:** `detachVideo` now returns `{ fileUri, thumbUri }`
rather than a bare path. A thumbnail whose video is gone is unreachable from
every screen, so nothing would ever clean it up. Hand the whole object to
`videoService.deleteVideoAssets()`.

### File layout on disk

```
Documents/
  seizure-videos/<uid>.mov     the clips
  seizure-thumbs/<uid>.jpg     poster frames
```

Both stored **relative** to the document directory, per `fileStore.ts` — iOS
reassigns the app container UUID on reinstall, and an absolute path would make a
seizure video silently unreachable after an update.

Thumbnails are extracted at import time, not lazily in the gallery. Pulling a
frame out of a video is slow, and doing it while scrolling a grid of twenty
tiles is the wrong moment. Extraction is best-effort and returns `''` on
failure — which happens routinely on clips shorter than one second, a fair
description of a lot of seizure footage. The tile has a designed placeholder,
not a grey box.

### Getting a video out

Two routes, because they answer different questions:

| Function | Question | Mechanism |
|---|---|---|
| `saveVideoToPhone()` | "I want to keep this." | `expo-media-library`, into a **Paws Journal** album |
| `shareVideo()` | "I want to send this." | `expo-sharing`, the OS share sheet |

The album matters more than it sounds. A seizure video dropped loose into a
camera roll of holiday footage is one the owner will not find again when they
are sitting in front of their vet.

The media-library permission is requested **`writeOnly`**. Saving a file the app
already owns does not require reading the owner's entire library, and iOS shows a
materially gentler prompt for add-only access — so the narrower ask also gets
granted more often. Asking for more than a feature needs is exactly the
over-broad declaration that gets a Data Safety form rejected.

The share sheet stays available even when photo-library access is refused,
because on iOS it offers "Save Video" with no permission prompt at all.

### New screens

**`app/add-video.tsx`** — log a seizure from a clip you already have.

Deliberately **not** inside `app/seizure/`. That folder is the emergency stack
with back gestures disabled so an accidental swipe cannot interrupt a live
recording. An import is the opposite situation — the seizure is over, the owner
is calm, and trapping them in a form they cannot swipe out of would be hostile.

Flow: pick clips (multi-select, up to 10) → state the date and time → state the
length or say you are not sure → the full observation questionnaire → save.

The record is written with three separate honesty signals, because three
different consumers read them:

```ts
retrospective:     true            // analytics weights these differently
timingConfidence:  'approximate'   // the history list badges this
durationConfidence:'unreliable'    // never 'high' — only the stopwatch earns that
captureConfidence: 'owner_stated'  // on every video row; the gallery badges it
```

**"I'm not sure" about the length is a first-class answer**, not a validation
failure. An owner who filmed thirty seconds of a seizure that had already
started cannot honestly state its length, and forcing a number out of them puts
a fabricated duration into the median their vet reads. Choosing it writes
`durationSec: 0` and the record renders as "Not timed" everywhere.

**`app/video/[id].tsx`** — one video, and everything known about that day.

The record is on this screen rather than a tap away because an owner opening a
video from the gallery is not asking "may I watch this clip" — they are asking
*what happened that day*. The clip is the fastest way into the memory; the
observations are the answer.

Playback uses `expo-video` (`expo-av`'s Video component is deprecated). The
player is paused on unmount so navigating away never leaves seizure audio
playing over the next screen, and it never autoplays — a seizure video that
starts the moment the screen opens is distressing, and may be opened in a
waiting room.

### The gallery

Lives inside the Records tab as a `Timeline | Gallery` segment, so the 4-tab bar
is untouched. The mode switch renders into *both* lists' headers in the same
place, so the control does not jump when you switch.

Grouped by **when it happened**, not when it was added. That is the whole point
of migration 8: a clip filmed Tuesday and imported Friday belongs under Tuesday,
next to the check-in and doses from that day. Grouping by import date files it
under Friday, where it means nothing.

Three columns, and the last row of a day is padded with invisible spacers rather
than left short — otherwise a day with four videos renders one full row and one
row whose single tile stretches full-width, which reads as a different kind of
item.

Tapping a tile opens the video screen. Inline playback in the grid was considered
and rejected: a wall of autoplaying seizure footage is the last thing an owner
scrolling their history needs to be ambushed by.

### Shared questionnaire

`src/components/ObservationFields.tsx` now owns the chip groups. Three screens
ask the same questions — live, post, and import — and they each used to map over
the option arrays themselves. That was fine with two and became a liability with
three: the vocabularies are stored **verbatim in the database**, so a group that
silently drifts writes strings no other screen can read back.

The interface is plain values, not the store. `post.tsx` and `live.tsx` drive it
from the zustand draft; `add-video.tsx` drives it from local state, because an
import is not a live seizure and has no business touching the active-seizure
store.

One behaviour change worth knowing: **single-select groups now clear on
re-tap.** Without that, an owner who taps "Staring" by mistake has no way back
to "unanswered" — and on a form where everything is optional, unanswered is a
real and meaningful state that must stay reachable.

### The 827-minute bug

Fixed by adding a second function rather than changing the first:

```ts
formatDuration(156)    // '2m 36s'   how long a seizure lasted
formatInterval(49653)  // '13h 47m'  how long since the last one
```

Resolution drops as the interval grows — seconds matter within a minute, they
are noise after a day. `formatDuration` is deliberately untouched: `0h 2m 36s`
on a vet report is worse than `2m 36s`, not better.

---

## Part 3 — Files

**New**

```
src/db/videoRepo.ts                 all video SQL, incl. gallery queries
src/services/mediaExport.ts         save to Photos, share sheet
src/components/form.tsx             ScreenHeader, SectionRule, QuestionLabel,
                                    TextArea, StepTrail, ActionBar, TextAction
src/components/ObservationFields.tsx shared chip groups
src/components/DateTimeField.tsx    owner-stated date/time, no native picker
src/components/VideoTile.tsx        thumbnail tile
src/components/VideoGallery.tsx     day-grouped grid
app/add-video.tsx                   import → date → observations → save
app/video/[id].tsx                  player + the record for that day
```

**Changed**

```
src/db/migrations.ts        + migration 8
src/types/domain.ts         CaptureConfidence, VideoSchema, GalleryEntry
src/db/seizureRepo.ts       video SQL moved out; getSeizure delegates
src/services/videoService.ts multi-import, thumbnails, capturedAt
src/store/activeSeizureStore.ts pendingVideos gains thumbUri
src/services/saveActiveSeizure.ts writes the new video columns
src/utils/time.ts           + formatInterval
app/(tabs)/history.tsx      Timeline | Gallery
app/seizure/live.tsx        pinned stop button, threshold track, shared fields
app/seizure/post.tsx        pinned continue, step trail, interval fix
app.config.ts               permissions + plugins
```

---

## Part 4 — How to run it

### 1. Install the three new packages

Run this yourself — I could not, the sandbox has no network access to the npm
registry.

```bash
cd ~/Desktop/Pawtrack
npx expo install expo-media-library expo-video expo-video-thumbnails
```

Use `expo install`, not `npm install`: it resolves the versions that match SDK
57 rather than the newest published, which is how a native module ends up
mismatched with the runtime.

### 2. Rebuild natively — this is not optional

All three add native code, and `app.config.ts` changed (a new `infoPlist` key,
a new Android permission, two new plugin entries). Fast Refresh cannot pick any
of that up.

```bash
cd ios && pod install && cd ..
npx expo run:ios --device "iPhone 17 Pro"
```

### 3. Verify the typecheck

```bash
npm run typecheck
```

It is currently clean apart from the three missing modules, which the install
resolves. One error will disappear on its own with them:
`app/video/[id].tsx(74,42): Parameter 'instance' implicitly has an 'any' type`
— that is the `useVideoPlayer` callback, and its type arrives with the package.

### 4. Delete the scratch folder

I could not remove it — `device_bash` has no delete permission on your machine.

```bash
rm -rf ~/Desktop/Pawtrack/.pawtrack-tmp
```

It holds the one-shot Python patch scripts I used to edit existing files in
place. They are all idempotent, so re-running one is safe, but nothing needs
them again.

### 5. Test path

1. Records → **Gallery** → empty state → **Add a video you already have**
2. Pick two clips → confirm thumbnails appear and each has a remove ✕
3. Leave the date blank-ish → confirm **Save is disabled** and the gate text
   says why
4. Enter a future date → confirm it is **refused**, not clamped
5. Enter `31 / 02 / 2026` → confirm "That date does not exist"
6. Tap **Yesterday**, set a time, enter `2 min 10 sec` → save
7. Confirm the record lands on the seizure detail screen with **Logged later**
8. Records → Gallery → confirm the tile is filed under **yesterday**, with an
   amber **Your date** badge and a `2m 10s` duration badge
9. Tap the tile → confirm playback, then **Save to my phone** → check Photos for
   a **Paws Journal** album
10. Record a live seizure with a video → confirm its gallery tile has **no**
    date badge (it was measured)
11. Delete a video from the detail screen → confirm the seizure record survives
    and the gallery tile is gone

---

## Part 5 — What I did not do

### The Today screen

It is the screen with the most design debt and the least behavioural risk, and I
ran out of turn rather than nerve. Here is the brief, ready to hand to a coding
agent:

> Redesign `app/(tabs)/index.tsx`. Keep every existing data source, store call
> and route — this is a presentation change only.
>
> **The problem:** seven cards with identical treatment and no primary. The four
> stat tiles claim to be equal facts when "days since last seizure" is the
> number the owner opened the app to see and "average duration" is monthly
> reference material.
>
> **Do this:**
> 1. Promote *days since last seizure* to a hero figure — display-size numeral,
>    the date beneath it, full width. Not a tile in a 2×2 grid.
> 2. Demote the other three to a single horizontal strip of small figures under
>    it. Same information, a third of the vertical space.
> 3. Delete the "Choose Breed" button from the profile card. Make the whole card
>    a `NavRow` to `/dog-profile` with a chevron — a set value does not need a
>    call-to-action beside it.
> 4. Add a **Recent videos** strip: the three newest `videoRepo.listGallery()`
>    entries as `VideoTile`s, with a "See all" link into Records → Gallery.
>    Render nothing at all when there are none — an empty strip is worse than no
>    strip.
> 5. Replace every ad-hoc uppercase heading with `SectionRule` from
>    `@/components/form`, so Today uses the same two label levels as the rest of
>    the app.
> 6. Keep the red **Record seizure** button exactly as it is, at the top. It is
>    the one thing on this screen that is correctly loud.
>
> Constraints: no new dependencies; only tokens from `src/theme/tokens.ts`;
> nothing interactive below `MIN_TOUCH_TARGET`; `npm run typecheck` must pass.

### Editing observations on an existing record

`app/seizure-detail/[id].tsx` shows a record but does not yet let you add
observations to one you saved earlier, or attach a video to an existing seizure.
Both are straightforward now that `ObservationFields` and `videoRepo` exist —
the detail screen needs an edit mode wired to `seizureRepo.updateSeizure` and an
"Add video" button calling `importVideos()` then `videoRepo.attachVideo()`.

### A caveat on the two bugs from the earlier run

The `status = 'abandoned'` bug in `app/seizure/recovery.tsx` and the inflated
`resolveDuration` are **still there**. I did not touch them in this pass — they
are in the live save path and deserve their own change with their own testing,
not a drive-by fix inside a feature branch. They will make the live-capture half
of the test path above fail, so fix them first if you want to test step 10.
