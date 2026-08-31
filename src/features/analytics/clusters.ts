/**
 * Cluster detection and the shape of the record over time.
 *
 * ── WHY THIS IS A SEPARATE MODULE FROM index.ts ───────────────────────
 *
 * Everything here is pure arithmetic over seizure timestamps, and it drives
 * the one alert in the app that tells an owner to consider phoning their vet.
 * That makes it the piece most worth testing directly.
 *
 * `index.ts` imports `@/utils/time`, and Node's native TypeScript stripping —
 * which is what `npm test` runs on — does not resolve the `@/` path alias. So
 * importing the analytics barrel from a test fails at module load, and the
 * cluster rules would be reachable only through the app.
 *
 * This file therefore imports NOTHING but types, which are erased at runtime.
 * Same reason src/utils/clock.ts is testable and most of the app is not.
 *
 * ── WHAT THESE FUNCTIONS ARE ALLOWED TO CLAIM ─────────────────────────
 *
 * They count events inside a time window. That is the whole claim.
 *
 * "Cluster seizures" is a real veterinary term with real consequences, and two
 * in twenty-four hours is a common threshold for phoning a vet — but the
 * threshold differs between practices and between dogs, which is exactly why
 * the window and the count are SETTINGS rather than constants. The app counts;
 * the owner's veterinarian decides what a count means. Nothing here may phrase
 * a result as a diagnosis.
 *
 * See docs/ARCHITECTURE.md -> the one rule that outranks everything.
 */

import type { Seizure } from '@/types/domain';

/*
 * NOTE: this module imports TYPES ONLY, and that is load-bearing rather than
 * incidental.
 *
 * Type imports are erased at runtime, so Node's TypeScript stripping can load
 * this file directly and clusters.test.ts can exercise the maths without the
 * app's bundler. The moment a VALUE is imported here, that stops being true:
 * an extensionless specifier fails under Node, and an explicit `.ts` one fails
 * under `tsc` (allowImportingTsExtensions is off).
 *
 * That is why `confidence` is NOT attached here. These functions report
 * `sampleSize`; the caller turns it into a word with confidenceFor(). The pure
 * arithmetic and the presentation vocabulary are separate concerns anyway.
 */

export type SeizureCluster = {
  /** The seizures in this cluster, oldest first. */
  seizures: Seizure[];
  /** Start of the first seizure in the run. */
  startedAt: number;
  /** Start of the last seizure in the run. */
  endedAt: number;
  count: number;
  /** Hours between the first and last seizure of the run. */
  spanHours: number;
};

/**
 * Runs of seizures that fall inside one window.
 *
 * ── WHAT THIS IS AND IS NOT SAYING ────────────────────────────────────
 *
 * It reports a COUNT INSIDE A TIME WINDOW. That is arithmetic on the owner's
 * own records, and it is the whole claim.
 *
 * "Cluster seizures" is a real veterinary term with real consequences, and
 * ≥2 in 24 hours is a common threshold for phoning a vet — but the threshold
 * differs between practices and between dogs, which is exactly why the window
 * and the count are SETTINGS rather than constants baked in here. The app
 * counts; the owner's veterinarian decides what a count means. Nothing in this
 * file may phrase the result as a diagnosis.
 *
 * ── WHY A GREEDY WALK AND NOT A SLIDING PAIR TEST ─────────────────────
 *
 * Asking "were there 2 within 24h" of every adjacent pair would report three
 * seizures at 09:00, 20:00 and 31:00 as two separate clusters that share a
 * member. It is one run, and an owner counting on their fingers would say so.
 * This walks forward and extends the current run while the next seizure is
 * still within the window OF THE RUN'S FIRST SEIZURE, which is the reading a
 * vet means by "in 24 hours".
 *
 * Only `complete` seizures are considered — the caller passes the same list
 * every other analytic uses, and an in-progress row is not yet a record.
 */
export function detectClusters(
  seizures: Seizure[],
  windowHours: number,
  minCount: number,
): SeizureCluster[] {
  if (seizures.length < minCount || minCount < 2 || windowHours <= 0) return [];

  const ordered = [...seizures].sort((a, b) => a.start - b.start);
  const windowMs = windowHours * 3_600_000;
  const clusters: SeizureCluster[] = [];

  let run: Seizure[] = [];
  for (const seizure of ordered) {
    const first = run[0];
    if (first && seizure.start - first.start <= windowMs) {
      run.push(seizure);
      continue;
    }
    if (run.length >= minCount) clusters.push(toCluster(run));
    run = [seizure];
  }
  if (run.length >= minCount) clusters.push(toCluster(run));

  // Newest first: the only one that can still need action is the latest.
  return clusters.reverse();
}

function toCluster(run: Seizure[]): SeizureCluster {
  const startedAt = run[0]!.start;
  const endedAt = run[run.length - 1]!.start;
  return {
    seizures: [...run],
    startedAt,
    endedAt,
    count: run.length,
    spanHours: (endedAt - startedAt) / 3_600_000,
  };
}

/**
 * The cluster the owner may still need to act on, or null.
 *
 * "Still open" means the window has not yet closed — another seizure now would
 * extend the same run. A cluster from last March is history and belongs in the
 * pattern report, not in an alert.
 */
export function activeCluster(
  seizures: Seizure[],
  windowHours: number,
  minCount: number,
  now: number,
): SeizureCluster | null {
  const latest = detectClusters(seizures, windowHours, minCount)[0];
  if (!latest) return null;
  const windowMs = windowHours * 3_600_000;
  return now - latest.startedAt <= windowMs ? latest : null;
}

/* ------------------------------------------------------------------ */
/* Shortening intervals                                                */
/* ------------------------------------------------------------------ */

export type IntervalTrend = {
  /** Mean gap in days across the earlier half of the record. */
  earlierMeanDays: number;
  /** Mean gap in days across the recent half. */
  recentMeanDays: number;
  direction: 'shortening' | 'lengthening' | 'steady';
  /** Pass to confidenceFor() for the word to show beside it. */
  sampleSize: number;
};

/**
 * Whether the gaps between seizures are getting shorter or longer.
 *
 * Deliberately compares two HALVES of the record rather than fitting a line.
 * A regression slope over a handful of irregular events invites a precision
 * nobody has earned here, and "the gaps have roughly halved" is both truer and
 * more useful to repeat to a vet than a coefficient.
 *
 * Needs at least six seizures — five gaps — so each half has more than a
 * single interval behind it. Returns null rather than a weak claim otherwise,
 * and reports 'steady' unless the change is at least 25%, so ordinary
 * irregularity does not read as a trend.
 */
export function intervalTrend(seizures: Seizure[]): IntervalTrend | null {
  if (seizures.length < 6) return null;

  const starts = [...seizures].sort((a, b) => a.start - b.start).map((s) => s.start);
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    gaps.push((starts[i]! - starts[i - 1]!) / 86_400_000);
  }

  const mid = Math.floor(gaps.length / 2);
  const earlier = gaps.slice(0, mid);
  const recent = gaps.slice(gaps.length - mid);
  if (earlier.length === 0 || recent.length === 0) return null;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const earlierMeanDays = mean(earlier);
  const recentMeanDays = mean(recent);
  if (earlierMeanDays === 0) return null;

  const change = (recentMeanDays - earlierMeanDays) / earlierMeanDays;
  const direction =
    Math.abs(change) < 0.25 ? 'steady' : change < 0 ? 'shortening' : 'lengthening';

  return {
    earlierMeanDays,
    recentMeanDays,
    direction,
    sampleSize: seizures.length,
  };
}

/* ------------------------------------------------------------------ */
/* Day of week                                                         */
/* ------------------------------------------------------------------ */

export type DayBand = { day: string; count: number; share: number };

/**
 * Seizures by day of the week.
 *
 * Included because a household's week has structure a dog lives inside —
 * someone out on Thursdays, the groomer on Saturdays, a different routine at
 * weekends. It is a prompt to go and look, never a finding on its own, which
 * is why this returns raw counts and shares and leaves the wording to the
 * screen.
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayOfWeekBands(seizures: Seizure[]): DayBand[] {
  const counts = new Array<number>(7).fill(0);
  for (const seizure of seizures) {
    // getDay() is 0-6 so the slot always exists, but `noUncheckedIndexedAccess`
    // is on for good reason and an unchecked `+= 1` on a possibly-undefined
    // slot is exactly the pattern it guards.
    const day = new Date(seizure.start).getDay();
    counts[day] = (counts[day] ?? 0) + 1;
  }
  const total = seizures.length || 1;
  return counts.map((count, i) => ({
    day: DAY_NAMES[i]!,
    count,
    share: count / total,
  }));
}

