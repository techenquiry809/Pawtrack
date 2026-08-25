/**
 * Monotonic clock guard for seizure durations.
 *
 * Duration in this app is a clinical figure — a vet may adjust a dose based on
 * whether seizures are lengthening. So the wall clock must not be allowed to
 * corrupt it.
 *
 * `Date.now()` reads the wall clock, which the OS can move BACKWARDS at any
 * moment: an NTP sync, a manual clock change, or crossing a timezone with "set
 * automatically" on. `performance.now()` is monotonic — it only ever counts
 * forward, and it is immune to all of the above.
 *
 * The catch is that `performance.now()` is measured from an origin unique to
 * the current JS session. A value captured before a crash is meaningless after
 * relaunch. So we deliberately never persist it: it lives in memory only, and
 * its absence is exactly how we detect that a record came back from a crash.
 *
 * See also the note at the top of src/store/activeSeizureStore.ts.
 */

export type DurationConfidence =
  | 'high'
  | 'clock_corrected'
  | 'recovered'
  | 'unreliable'
  | 'legacy';

export const DURATION_CONFIDENCES = [
  'high', 'clock_corrected', 'recovered', 'unreliable', 'legacy',
] as const;

/** Longer than this and we assume the clock lied, not the dog. */
export const MAX_PLAUSIBLE_SEIZURE_SECONDS = 6 * 60 * 60;

/** Wall and monotonic clocks may differ by this much before we call it drift. */
const CLOCK_DRIFT_TOLERANCE_MS = 3_000;

export type StartMark = {
  /** Absolute instant, epoch ms. Persisted. */
  startedAtUtc: number;
  /** Minutes ahead of UTC, e.g. Kathmandu = 345. Persisted. */
  tzOffsetMin: number;
  /** Monotonic reading. Memory only — never write this to SQLite. */
  startedAtMono: number | null;
};

export type ResolvedDuration = {
  durationSeconds: number | null;
  confidence: DurationConfidence;
};

function monotonicNow(): number | null {
  const perf = globalThis.performance;
  return typeof perf?.now === 'function' ? perf.now() : null;
}

/** Call once, at the instant the owner says the seizure is starting. */
export function markStart(now = Date.now()): StartMark {
  return {
    startedAtUtc: now,
    // getTimezoneOffset() returns minutes BEHIND UTC, so negate it to get the
    // conventional "+345 for Kathmandu" form a human would recognise.
    tzOffsetMin: -new Date(now).getTimezoneOffset(),
    startedAtMono: monotonicNow(),
  };
}

/** Derive a duration at finalize time, in the session the seizure began. */
export function resolveDuration(mark: StartMark): ResolvedDuration {
  const wallMs = Date.now() - mark.startedAtUtc;
  const monoStart = mark.startedAtMono;
  const monoNow = monotonicNow();

  const monoMs =
    monoStart !== null && monoNow !== null ? monoNow - monoStart : null;

  // Monotonic is available and trustworthy — prefer it outright.
  if (monoMs !== null) {
    const drifted = Math.abs(monoMs - wallMs) > CLOCK_DRIFT_TOLERANCE_MS;
    return clamp(monoMs, drifted ? 'clock_corrected' : 'high');
  }

  // No monotonic reading available. Fall back to the wall clock and say so.
  return clamp(wallMs, 'unreliable');
}

/**
 * Derive a duration for a row recovered after a crash.
 *
 * We use the last phase transition rather than "now" on purpose. If the app
 * died at 02:14 and the owner opens it at 08:00, "now" would report a six-hour
 * seizure and hand a vet a fabricated data point. The last write we managed is
 * a conservative, honest floor.
 */
export function resolveRecoveredDuration(
  startedAtUtc: number,
  lastTouchedAt: number | null,
): ResolvedDuration {
  if (lastTouchedAt === null || lastTouchedAt <= startedAtUtc) {
    return { durationSeconds: null, confidence: 'unreliable' };
  }
  return clamp(lastTouchedAt - startedAtUtc, 'recovered');
}

function clamp(ms: number, confidence: DurationConfidence): ResolvedDuration {
  const seconds = Math.round(ms / 1000);

  // A negative duration means the clock moved backwards under us. Recording
  // null is strictly better than recording a number we know to be wrong — a
  // blank field prompts a question, a wrong number gets acted on.
  if (seconds < 0 || seconds > MAX_PLAUSIBLE_SEIZURE_SECONDS) {
    return { durationSeconds: null, confidence: 'unreliable' };
  }

  return { durationSeconds: seconds, confidence };
}

/**
 * For the live screen's ticking display. Recomputed from the mark on every
 * render — the 1s interval only exists to trigger that render, so a suspended
 * JS thread costs nothing.
 */
export function elapsedSecondsFromMark(mark: StartMark): number {
  const monoStart = mark.startedAtMono;
  const monoNow = monotonicNow();
  if (monoStart !== null && monoNow !== null) {
    return Math.max(0, Math.floor((monoNow - monoStart) / 1000));
  }
  return Math.max(0, Math.floor((Date.now() - mark.startedAtUtc) / 1000));
}
