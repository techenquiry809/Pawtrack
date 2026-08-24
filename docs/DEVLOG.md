# Development record

Running log of decisions, state and remaining work. Update this at each
milestone so anyone (including future you) can resume without re-deriving
context.

---

## Milestone 1 — Foundation (current state)

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
1. **Post-seizure screen** — `app/seizure/post.tsx`
2. **Recovery screen** + save pipeline — `app/seizure/recovery.tsx`
   *(after this, the critical path is end-to-end complete — stop and test hard)*
3. **History list** — `app/(tabs)/history.tsx`
4. **Seizure detail / edit / retrospective create** — `app/seizure-detail/[id].tsx`
5. **Breed picker** — `app/breed-picker.tsx`
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
