# The complete toolset

Every tool, package and service, what it does, and whether you actually need
it. Written for someone who has not used these before.

---

## 1. On your computer (install these first)

| Tool | What it does | Required? | Notes |
|---|---|---|---|
| **Node.js** (LTS) | Runs the JavaScript tooling. Everything below needs it. | **Required** | Download the LTS version from nodejs.org |
| **npm** | Installs packages. Comes with Node. | **Required** | Already installed with Node |
| **A code editor** | VS Code is the standard choice and free. | **Required** | Install the "ESLint" extension later if you add linting |
| **Git** | Version control — lets you undo mistakes. | **Strongly recommended** | The project already has a `.git` folder |
| **Expo Go** (phone app) | Runs your app on your real phone during development, over WiFi. | Optional but very useful | Free, from the App Store / Play Store |
| **Xcode** (Mac only) | Builds iOS apps, runs the iOS Simulator. | Only for local iOS builds | Free, ~10GB, Mac App Store. **You can skip this** if you use EAS Build in the cloud |
| **Android Studio** | Runs the Android emulator. | Only for local Android testing | Free. You can also just use a real phone with Expo Go |

**The important thing to understand:** you do **not** need a Mac to build an
iOS app if you use EAS Build (Expo's cloud build service). It compiles on
Expo's Macs. You *do* need a Mac if you want to build locally.

---

## 2. Runtime packages (already installed)

These are in `package.json` and are already installed.

### Core framework

| Package | What it does | Required? |
|---|---|---|
| `expo` | The framework itself. Bundles the native runtime and all `expo-*` modules. | **Required** |
| `react` / `react-native` | The UI framework. React Native turns your components into real native views. | **Required** |
| `typescript` | Adds types to JavaScript so mistakes are caught before you run the app. | **Required** by your spec |

### Navigation

| Package | What it does | Required? |
|---|---|---|
| `expo-router` | File-based routing. A file in `app/` becomes a screen. | **Required** |
| `react-native-screens` | Makes navigation use real native screen containers (faster, correct animations). | **Required** — peer dependency of the router |
| `react-native-safe-area-context` | Tells us where the notch / home indicator are so content is not hidden. | **Required** — peer dependency |
| `expo-linking` | Deep links (`pawtrack://`). | **Required** by the router |
| `expo-constants` | Reads values from `app.config.ts` at runtime. | **Required** by the router |

### Data

| Package | What it does | Required? |
|---|---|---|
| `expo-sqlite` | The local database. All records live here. | **Required** |
| `zustand` | Small state manager for the active dog, settings and the in-progress seizure. | **Required** (or you would hand-roll the same thing) |
| `zod` | Validates data at runtime, not just compile time. Guards against corrupt records. | Recommended — justified because this is health data |

### Device features

| Package | What it does | Required? |
|---|---|---|
| `expo-image-picker` | Opens the system camera to record video, and the library to pick an existing one. | **Required** for the video feature |
| `expo-file-system` | Copies recorded videos into permanent app storage. | **Required** for the video feature |
| `expo-camera` | In-app camera preview. | Optional — installed for a possible future in-app recorder; the picker handles today's flow |
| `expo-notifications` | Local medication and check-in reminders. | **Required** for reminders |
| `expo-keep-awake` | Stops the screen sleeping during a seizure. | **Required** — safety-relevant |
| `expo-haptics` | Vibration at the 3 and 5 minute thresholds. | **Required** — accessibility, do not rely on colour alone |
| `expo-print` | Turns the vet report into a real PDF. | **Required** for the report |
| `expo-sharing` | Opens the OS share sheet to send that PDF to the vet. | **Required** for the report |
| `expo-status-bar` | Controls the clock/battery bar styling. | Minor, ships with the template |

**Deliberately NOT installed**, and why:

- **Redux / MobX** — Zustand covers our needs at a fraction of the complexity.
- **NativeWind / styled-components** — extra build step, no benefit at this size.
- **react-hook-form** — our forms are chips and a few text inputs.
- **moment / date-fns / dayjs** — JS `Date` + `Intl` handle our formatting and
  arithmetic correctly, including DST.
- **An icon library** — currently emoji. Add `@expo/vector-icons` (ships with
  Expo, no install needed) when you want sharper icons.
- **axios** — there is no backend. `fetch` is built in if that changes.

---

## 3. Expo services (cloud, used later)

| Service | What it does | When you need it | Cost |
|---|---|---|---|
| **EAS Build** | Compiles your app into a real `.ipa` / `.aab` on Expo's servers. **This is how you build an iOS app without a Mac.** | When you want to test on TestFlight or submit | Free tier exists; paid for faster/more builds |
| **EAS Submit** | Uploads the built file to App Store Connect / Google Play for you. | At submission time | Included with EAS |
| **EAS Update** | Push JavaScript-only fixes to users without a new store review. | Post-launch, for bug fixes | Free tier exists |
| **Expo Dev Client** | A custom version of Expo Go containing *your* native modules. | Once Expo Go can't run your app (see below) | Free, built via EAS Build |

### Expo Go vs. development build — which do you need?

**Start with Expo Go.** It is instant and needs no build.

**You must switch to a development build when Expo Go cannot load a native
module your app uses.** For this app that means: as soon as you exercise
camera recording, notifications, or SQLite in anger, Expo Go may not be
enough. The symptom is a red error screen naming a missing native module.

When that happens, one command creates your own dev client:

```bash
npx eas build --profile development --platform ios
```

You install that build once, then it behaves exactly like Expo Go for the rest
of development.

---

## 4. Accounts you will need (and what they cost)

| Account | For what | Cost | When |
|---|---|---|---|
| **Expo account** | EAS Build / Submit / Update | Free to create | Before your first cloud build |
| **Apple Developer Program** | TestFlight + App Store | **$99/year** | Before iOS testing on real devices via TestFlight, and before submission |
| **Google Play Developer** | Play Store | **$25 one-time** | Before Android submission |

> **You do not need to give me any of these credentials.** You will sign in
> yourself when the command prompts you. If any step ever seems to ask you to
> paste a password or key into a file, stop and ask — that is not how it should
> work.

---

## 5. Which tool at which stage

| Stage | Tools |
|---|---|
| **Writing code** | VS Code, TypeScript (`npm run typecheck`) |
| **Running it** | `npx expo start` + Expo Go on your phone |
| **Debugging** | Expo dev menu (shake phone), React Native DevTools, `console.log` |
| **Android testing** | Expo Go, or Android Studio emulator, or an EAS `.apk` |
| **iOS testing** | Expo Go, or Xcode Simulator (Mac only), or TestFlight via EAS |
| **Building** | EAS Build |
| **iOS submission** | EAS Submit → App Store Connect → TestFlight → review |
| **Android submission** | EAS Submit → Play Console → internal testing → production |
| **Post-launch fixes** | EAS Update for JS-only changes; a new build for native changes |
