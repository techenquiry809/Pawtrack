# Paws Journal — React Native + Expo

A dog seizure tracking app. Record a seizure in one tap, capture structured
observations without typing, and produce a clean report for your veterinarian.

> **This is a tracking and decision-support tool, not a diagnostic tool.** It
> does not diagnose or treat seizures, and never claims that anything *caused*
> a seizure. If your dog is having a prolonged or repeated seizure, follow your
> veterinarian's emergency plan and seek veterinary care.

## Quick start

```bash
npm install
npx expo install --fix
npx expo start
```

Then scan the QR code with **Expo Go** on your phone.

New to this? Read **`docs/WORKFLOW.md`** — it assumes no prior experience and
tells you exactly what to type and what to expect.

## Documentation

| File | What's in it |
|---|---|
| `docs/WORKFLOW.md` | **Start here.** Setup, daily commands, test checklist, troubleshooting |
| `docs/ARCHITECTURE.md` | Every technology choice and why; the safety rules |
| `docs/TOOLSET.md` | Every tool and package explained; accounts and costs |
| `docs/DEVLOG.md` | Current state, what's done, what's next |

## Status

Foundation complete and verified (`tsc` clean, bundles successfully). The
critical seizure-recording path is built through the live timer; the remaining
screens are routed with their requirements documented. See `docs/DEVLOG.md`.

**Not yet run on a physical device** — do that before building on top of it.
