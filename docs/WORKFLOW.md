# Development workflow

Written assuming you have not done this before. Every command tells you which
folder to be in and what you should see.

---

## Stage 0 — Get it running (do this first)

### Step 1. Install Node.js

Go to **nodejs.org**, download the **LTS** version, run the installer.

Check it worked. Open Terminal (Mac) or PowerShell (Windows) and type:

```bash
node --version
```

**Expected:** something like `v22.x.x`. If you get "command not found", the
install did not complete — restart your terminal first, then reinstall.

### Step 2. Go to the project folder

```bash
cd path/to/paws-journal-rn
```

Replace `path/to/` with wherever you unzipped it. On a Mac, you can type `cd `
(with the space) then drag the folder onto the terminal window.

**Check you are in the right place:**

```bash
ls
```

**Expected:** you should see `app`, `src`, `docs`, `package.json`.

### Step 3. Install the packages

```bash
npm install
```

**Expected:** a couple of minutes of output, ending with something like
`added 900 packages`. Warnings about "deprecated" packages are normal and safe
to ignore. A red `ERR!` is not — send it to me.

### Step 4. Align package versions with the Expo SDK

```bash
npx expo install --fix
```

**Why:** I installed packages without access to Expo's version API, so a few
may be slightly off from what SDK 57 expects. This command corrects them.

**Expected:** either "Dependencies are up to date" or a short list of packages
it updated.

### Step 5. Start it

```bash
npx expo start
```

**Expected:** a QR code in your terminal.

Now install **Expo Go** on your phone (App Store / Play Store), make sure your
phone and computer are on the **same WiFi**, and:

- **iPhone:** open the Camera app, point at the QR code, tap the banner.
- **Android:** open Expo Go, tap "Scan QR code".

**Expected:** the app loads and you see the onboarding screen asking for your
dog's name.

**If it does not connect:** most often the phone and computer are on different
networks (guest WiFi is a common culprit). Try `npx expo start --tunnel` —
slower but works across networks.

---

## Stage 1 — Planning ✅ done

The existing web app was inspected; its screens, data model and safety rules
are documented in `docs/ARCHITECTURE.md`.

## Stage 2 — Project setup ✅ done

Expo + TypeScript project created, dependencies installed, folder structure
established, `app.config.ts` written with all native permissions declared.

**Verified:** `npx tsc --noEmit` passes with zero errors, and
`npx expo export` bundles 1,276 modules successfully.

## Stage 3 — Architecture ✅ done

SQLite schema with migrations, repository layer, Zustand stores, design tokens,
domain types. See `docs/ARCHITECTURE.md`.

## Stage 4 — UI 🟡 in progress

**Done:** design system (`src/components/ui.tsx`), tab navigation, Home,
onboarding, and the live seizure timer screen.

**Next:** post-seizure, recovery, history, seizure detail/edit, breed picker,
daily check-in, emergency plan, analytics, more.

Every remaining screen already has a route, and each one lists what it needs in
its `Placeholder`. Build them one at a time, in the order in `DEVLOG.md`.

**Expected result of this stage:** every screen renders real data; no
`Placeholder` components remain.

## Stage 5 — Features 🔴 not started

Analytics engine, PDF vet report, medication reminders. Logic goes in
`src/features/`, device calls in `src/services/`.

## Stage 6 — Backend

**There is currently no backend, and for v1 that is the right call.** Everything
is on-device, which is the strongest possible privacy story for pet health
data. A backend only becomes necessary for multi-caregiver sync or cross-device
backup. Do not add one before you need it.

## Stage 7 — Testing

See "Manual test checklist" below. Add automated tests
(`jest-expo` + `@testing-library/react-native`) when the analytics engine
lands — pure functions like duration and association maths are exactly what
unit tests are good at, and exactly where a silent bug would matter most.

## Stage 8 — Build

```bash
npm install -g eas-cli
eas login          # create a free account at expo.dev first
eas init           # links this project to your Expo account
eas build --profile preview --platform android
```

**Expected:** a link to a build page; ~10-20 minutes later, a downloadable
`.apk` you can install on an Android phone.

For iOS, `--platform ios` — this needs your Apple Developer account ($99/yr)
and will prompt you to sign in. **EAS handles certificates and provisioning
profiles for you.** You do not need to understand them; say yes when it offers
to manage them.

## Stage 9 — Store testing

- **iOS:** `eas submit --platform ios` → appears in TestFlight → invite
  testers by email.
- **Android:** `eas submit --platform android` → Play Console → internal
  testing track.

## Stage 10 — Production

Store listing (screenshots, description, privacy policy), then submit for
review. Apple review typically takes 1-3 days; Google is usually faster.

**You will need a privacy policy URL.** Even though this app sends nothing
anywhere, both stores require one. Say plainly: all data stays on the device,
nothing is collected, nothing is sold.

**Health app note:** both stores ask whether your app handles health data.
Answer honestly. Be clear in your listing that this is a **record-keeping tool,
not a diagnostic one** — the same framing the app itself uses. Overclaiming
here is both a review risk and a real-world safety issue.

---

## Everyday commands

Run all of these from the project folder.

| Command | What it does |
|---|---|
| `npx expo start` | Start the dev server |
| `npx expo start --clear` | Same, but clears a stale cache — **try this first when something is weirdly broken** |
| `npm run typecheck` | Check for type errors without running the app |
| `npx expo-doctor` | Diagnose common project problems |
| `npx expo install <pkg>` | Add a package at the SDK-correct version (**use this instead of `npm install` for `expo-*` packages**) |

---

## Manual test checklist

Run through this before any build you give to another person.

**The critical path — test this most:**
- [ ] Tap Record Seizure — timer starts immediately, no confirmation step
- [ ] Lock the phone for 60s, unlock — **elapsed time is still correct**
- [ ] Switch to another app for 60s, come back — **still correct**
- [ ] Let it reach 3:00 — amber banner + vibration, exactly once
- [ ] Let it reach 5:00 — red banner + vibration, background turns red
- [ ] Tap observation chips — they toggle and show a checkmark, not just colour
- [ ] Record Video is reachable **without scrolling**
- [ ] End seizure → post → recovery → saved to history
- [ ] Tap ✕ mid-seizure — asks for confirmation, does not discard silently

**Everything else:**
- [ ] Onboarding creates a dog; app never asks again
- [ ] Breed picker: typing "gold" finds Golden Retriever; "ger" finds German Shepherd
- [ ] Mixed Breed / Other reveal the description field
- [ ] Call buttons with **no** number saved → helpful message, no crash
- [ ] Call buttons with a number → phone dialer opens
- [ ] Daily check-in saves, and re-opening it edits rather than duplicating
- [ ] Analytics with fewer than 3 seizures shows only "not enough data"
- [ ] Add a seizure retrospectively from History; it is labelled as such
- [ ] Edit an existing seizure; changes persist after restarting the app
- [ ] Force-quit and reopen — **all records still there**

**Devices and settings:**
- [ ] A small phone (iPhone SE) and a large one
- [ ] iOS **and** Android
- [ ] Settings → Accessibility → larger text: nothing clips or overlaps
- [ ] With a screen reader on, the timer announces as it changes
- [ ] Airplane mode — everything works, since there is no network dependency

---

## When something breaks

1. **Read the red error screen.** The first line usually names the file.
2. `npx expo start --clear` — fixes a surprising share of odd problems.
3. `npm run typecheck` — catches type mistakes the running app might hide.
4. Delete `node_modules` and reinstall:
   ```bash
   rm -rf node_modules
   npm install
   ```
5. Still stuck? Copy the **whole** error message and send it to me. "It does
   not work" is hard to diagnose; the error text is usually enough to fix it in
   one go.
