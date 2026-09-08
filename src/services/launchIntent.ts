/**
 * What opened this process, and how much ceremony it is allowed.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────
 *
 * The home-screen widget exists so that someone whose dog has just started
 * convulsing can reach a running timer in one tap. What they got instead was
 * the branded intro: `AnimatedSplash` covers the whole window until the clip
 * finishes, so every launch — including the emergency one — paid roughly three
 * seconds of video before the seizure route was even visible. That is three
 * seconds of a seizure that nothing can recover, spent showing a logo to the
 * one person who least wants to see it.
 *
 * The intro is right for an ordinary launch and wrong for this one, so the
 * launch has to be classified before the splash is mounted.
 *
 * ── WHY THE PROBE STARTS AT IMPORT ────────────────────────────────────
 *
 * `Linking.getInitialURL()` is asynchronous, and the root layout has to decide
 * what to render on its FIRST frame. Firing it at module scope means the
 * native round trip is already in flight by the time React renders anything,
 * so the answer is normally back within a frame or two — see `introPhase` in
 * app/_layout.tsx, which holds a plain background over that gap rather than
 * starting a video it might have to tear down.
 *
 * ── WHY A TIMEOUT ─────────────────────────────────────────────────────
 *
 * A promise that never settles would leave the app under that plain cover
 * forever. The fallback is 'ordinary', which is both the common case and the
 * safe one: the worst outcome is that a widget launch still sees the intro,
 * which is exactly the behaviour this replaces.
 *
 * ── WARM STARTS ARE NOT THIS FILE'S PROBLEM ───────────────────────────
 *
 * `getInitialURL` reports the intent that STARTED the process, so a widget tap
 * that merely resumes a living process is not seen here. That is correct:
 * nothing is mounting, there is no splash to skip, and expo-router routes the
 * new URL on its own.
 */

import * as Linking from 'expo-linking';

import { classifyLaunchUrl, type LaunchIntent } from './launchUrl';

export type { LaunchIntent };

/** How long to wait for the platform to say what opened us. */
const PROBE_TIMEOUT_MS = 400;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * Started at import, deliberately. See the note above.
 *
 * Never rejects: every failure resolves to 'ordinary', because a launch this
 * module cannot classify must still start the app.
 */
const probe: Promise<LaunchIntent> = withTimeout(
  Linking.getInitialURL().then(classifyLaunchUrl),
  PROBE_TIMEOUT_MS,
  'ordinary',
);

/** Resolves once, with the answer cached by the promise itself. */
export function launchIntent(): Promise<LaunchIntent> {
  return probe;
}
