/**
 * Pattern analysis.
 *
 * Pure functions over already-loaded records. No SQL, no React, no dates read
 * from the ambient clock — `now` is always a parameter — so every rule below is
 * testable rather than a matter of code review.
 *
 * ── THE RULE THAT OUTRANKS EVERYTHING ────────────────────────────────
 *
 * This module may report that two things OCCURRED TOGETHER. It may never
 * report, imply, or rank a CAUSE. Concretely:
 *
 *   - Nothing is emitted at all below MIN_SEIZURES_FOR_PATTERNS.
 *   - Every association carries its own sample size, so the UI cannot show a
 *     finding without also showing how thin the evidence is.
 *   - Wording is fixed here, not in the screen. "Seizures were recorded more
 *     often after shorter sleep" is allowed. "Short sleep triggers seizures"
 *     is not, and no caller can construct it from what this returns.
 *
 * See docs/ARCHITECTURE.md → the one rule that outranks everything.
 */

import type { DailyCheckin, Seizure } from '@/types/domain';
import { startOfDay, DAY_MS } from '@/utils/time';

/**
 * Below this, the screen shows a "not enough data" message and NO charts.
 * Three is not a statistical threshold — it is the point below which a chart
 * is actively misleading, because one more seizure would redraw it entirely.
 */
export const MIN_SEIZURES_FOR_PATTERNS = 3;

/* ------------------------------------------------------------------ */
/* Confidence                                                          */
/* ------------------------------------------------------------------ */

export const CONFIDENCE_LEVELS = ['early', 'possible', 'repeated', 'strong'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Sample size, translated into a word an owner can weigh.
 *
 * Deliberately conservative: "strong" needs 20 observations and still only
 * means "this pattern has repeated", never "this is established".
 */
export function confidenceFor(sampleSize: number): Confidence {
  if (sampleSize >= 20) return 'strong';
  if (sampleSize >= 10) return 'repeated';
  if (sampleSize >= 5) return 'possible';
  return 'early';
}

export const CONFIDENCE_BLURB: Record<Confidence, string> = {
  early: 'Very few records so far — treat this as a first impression.',
  possible: 'A handful of records. Worth watching, not concluding.',
  repeated: 'This has repeated across enough records to mention to your vet.',
  strong: 'A consistent pattern in your records. Still an association, not a cause.',
};

/* ------------------------------------------------------------------ */
/* Time of day                                                         */
/* ------------------------------------------------------------------ */

export type TimeBand = {
  key: 'night' | 'morning' | 'afternoon' | 'evening';
  label: string;
  /** Inclusive start hour, exclusive end hour, local time. */
  range: string;
  count: number;
  /** 0–1 of the total, for bar length. */
  fraction: number;
};

const BAND_META = [
  { key: 'night', label: 'Night', range: '12am – 6am' },
  { key: 'morning', label: 'Morning', range: '6am – 12pm' },
  { key: 'afternoon', label: 'Afternoon', range: '12pm – 6pm' },
  { key: 'evening', label: 'Evening', range: '6pm – 12am' },
] as const;

/**
 * Four 6-hour bands, by LOCAL hour of the seizure start.
 *
 * Uses the wall-clock hour deliberately — "did this happen at night" is a
 * question about the dog's day, not about elapsed UTC.
 */
export function timeOfDayBands(seizures: Seizure[]): TimeBand[] {
  // Tuple, not number[] — noUncheckedIndexedAccess would otherwise make every
  // read below possibly-undefined for a set of slots we know exists.
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const s of seizures) {
    const band = Math.floor(new Date(s.start).getHours() / 6);
    // getHours() is 0–23, so band is 0–3; clamp defensively against a bad row.
    const i = Math.min(3, Math.max(0, band)) as 0 | 1 | 2 | 3;
    counts[i] += 1;
  }
  const total = seizures.length || 1;
  return BAND_META.map((meta, i) => ({
    key: meta.key,
    label: meta.label,
    range: meta.range,
    count: counts[i] ?? 0,
    fraction: (counts[i] ?? 0) / total,
  }));
}

/* ------------------------------------------------------------------ */
/* Duration                                                            */
/* ------------------------------------------------------------------ */

export type DurationStats = {
  count: number;
  medianSec: number | null;
  longestSec: number | null;
  shortestSec: number | null;
  /** Records whose duration we do not trust enough to average in. */
  excludedCount: number;
};

/**
 * MEDIAN, not mean.
 *
 * One 20-minute cluster drags a mean far enough to make a typical seizure look
 * longer than it is, and an owner reading "average 6 minutes" would reasonably
 * panic. The median answers the question actually being asked: what is a
 * normal seizure for my dog?
 *
 * Records whose duration was never measured reliably are EXCLUDED and counted,
 * so the screen can say how many were left out rather than silently averaging
 * a guess into a clinical figure.
 */
export function durationStats(seizures: Seizure[]): DurationStats {
  const usable = seizures
    .filter((s) => s.durationConfidence !== 'unreliable' && s.durationSec > 0)
    .map((s) => s.durationSec)
    .sort((a, b) => a - b);

  if (usable.length === 0) {
    return {
      count: 0,
      medianSec: null,
      longestSec: null,
      shortestSec: null,
      excludedCount: seizures.length,
    };
  }

  const mid = Math.floor(usable.length / 2);
  const median =
    usable.length % 2 === 0
      ? Math.round((((usable[mid - 1] ?? 0) + (usable[mid] ?? 0)) / 2))
      : (usable[mid] ?? 0);

  return {
    count: usable.length,
    medianSec: median,
    longestSec: usable[usable.length - 1] ?? null,
    shortestSec: usable[0] ?? null,
    excludedCount: seizures.length - usable.length,
  };
}

/* ------------------------------------------------------------------ */
/* Recent vs baseline                                                  */
/* ------------------------------------------------------------------ */

export type FrequencyComparison = {
  recentCount: number;
  /** Earlier seizures expressed at the same 30-day scale, so they compare. */
  baselinePer30d: number | null;
  baselineDays: number;
  direction: 'more' | 'fewer' | 'similar' | 'unknown';
  /** Plain-language, association-only. Never causal. */
  summary: string;
};

const RECENT_WINDOW_DAYS = 30;
/** Below this the "baseline" is too short a window to divide by. */
const MIN_BASELINE_DAYS = 30;

/**
 * Last 30 days against everything before it, normalised to the same window
 * length so the two numbers are actually comparable.
 *
 * Returns `unknown` rather than a misleading number when there is not enough
 * history — a first-month user comparing against nine days of baseline would
 * see wild swings that mean nothing.
 */
export function frequencyComparison(
  seizures: Seizure[],
  now: number,
): FrequencyComparison {
  const cutoff = now - RECENT_WINDOW_DAYS * DAY_MS;
  const recent = seizures.filter((s) => s.start >= cutoff);
  const earlier = seizures.filter((s) => s.start < cutoff);

  const oldest = earlier.reduce<number | null>(
    (min, s) => (min === null || s.start < min ? s.start : min),
    null,
  );
  const baselineDays = oldest === null ? 0 : Math.floor((cutoff - oldest) / DAY_MS);

  if (oldest === null || baselineDays < MIN_BASELINE_DAYS) {
    return {
      recentCount: recent.length,
      baselinePer30d: null,
      baselineDays,
      direction: 'unknown',
      summary:
        'Not enough earlier history yet to compare the last 30 days against.',
    };
  }

  const per30 = (earlier.length / baselineDays) * RECENT_WINDOW_DAYS;
  const rounded = Math.round(per30 * 10) / 10;

  // A 25% band counts as "about the same". Anything tighter reports noise as
  // a trend, which is how an owner ends up changing a dose over nothing.
  const delta = recent.length - per30;
  const direction: FrequencyComparison['direction'] =
    Math.abs(delta) <= Math.max(1, per30 * 0.25)
      ? 'similar'
      : delta > 0
        ? 'more'
        : 'fewer';

  const summary =
    direction === 'similar'
      ? `About the same as usual — ${recent.length} in the last 30 days, against a usual ${rounded}.`
      : direction === 'more'
        ? `More than usual — ${recent.length} in the last 30 days, against a usual ${rounded}.`
        : `Fewer than usual — ${recent.length} in the last 30 days, against a usual ${rounded}.`;

  return {
    recentCount: recent.length,
    baselinePer30d: rounded,
    baselineDays,
    direction,
    summary,
  };
}

/* ------------------------------------------------------------------ */
/* Associations                                                        */
/* ------------------------------------------------------------------ */

export type Association = {
  id: string;
  title: string;
  /** Association-only wording. Fixed here so no screen can restate it. */
  finding: string;
  /** How many days went into this. Shown next to the finding, always. */
  sampleSize: number;
  confidence: Confidence;
};

/**
 * Sleep hours on days that had a seizure, against days that did not.
 *
 * WHAT THIS CANNOT TELL YOU, and why the wording is locked down: a seizure
 * disrupts sleep at least as readily as poor sleep precedes a seizure. The
 * direction of the arrow is not recoverable from this data, so the finding
 * says the two were "recorded together" and stops there.
 *
 * Returns null rather than a weak claim when either group is too small.
 */
export function sleepAssociation(
  seizures: Seizure[],
  checkins: DailyCheckin[],
): Association | null {
  const seizureDays = new Set(seizures.map((s) => startOfDay(s.start)));

  const withSleep = checkins.filter((c) => c.sleepHrs !== null);
  const onSeizureDays = withSleep.filter((c) => seizureDays.has(startOfDay(c.timestamp)));
  const onQuietDays = withSleep.filter((c) => !seizureDays.has(startOfDay(c.timestamp)));

  // Both groups need real content. Comparing one day against forty is not a
  // comparison, it is an anecdote with a number attached.
  if (onSeizureDays.length < 3 || onQuietDays.length < 3) return null;

  const mean = (rows: DailyCheckin[]) =>
    rows.reduce((sum, c) => sum + (c.sleepHrs ?? 0), 0) / rows.length;

  const seizureMean = mean(onSeizureDays);
  const quietMean = mean(onQuietDays);
  const diff = seizureMean - quietMean;
  const sampleSize = onSeizureDays.length;

  // Under an hour is inside the noise of an owner estimating sleep by eye.
  if (Math.abs(diff) < 1) {
    return {
      id: 'sleep',
      title: 'Sleep',
      finding: `No difference stands out. Sleep averaged ${seizureMean.toFixed(1)}h on days with a seizure and ${quietMean.toFixed(1)}h on days without.`,
      sampleSize,
      confidence: confidenceFor(sampleSize),
    };
  }

  return {
    id: 'sleep',
    title: 'Sleep',
    finding:
      diff < 0
        ? `Shorter sleep was recorded on days that also had a seizure — ${seizureMean.toFixed(1)}h against ${quietMean.toFixed(1)}h on other days. Which came first is not something these records can show.`
        : `Longer sleep was recorded on days that also had a seizure — ${seizureMean.toFixed(1)}h against ${quietMean.toFixed(1)}h on other days. Which came first is not something these records can show.`,
    sampleSize,
    confidence: confidenceFor(sampleSize),
  };
}

/**
 * Owner-reported stress on seizure days against other days.
 *
 * Same caveat as sleep, and worse: stress here is the owner's own 1–5 rating,
 * recorded on a day they may already know went badly.
 */
export function stressAssociation(
  seizures: Seizure[],
  checkins: DailyCheckin[],
): Association | null {
  const seizureDays = new Set(seizures.map((s) => startOfDay(s.start)));
  const onSeizureDays = checkins.filter((c) => seizureDays.has(startOfDay(c.timestamp)));
  const onQuietDays = checkins.filter((c) => !seizureDays.has(startOfDay(c.timestamp)));

  if (onSeizureDays.length < 3 || onQuietDays.length < 3) return null;

  const mean = (rows: DailyCheckin[]) =>
    rows.reduce((sum, c) => sum + c.stress, 0) / rows.length;

  const seizureMean = mean(onSeizureDays);
  const quietMean = mean(onQuietDays);
  const sampleSize = onSeizureDays.length;

  if (Math.abs(seizureMean - quietMean) < 0.5) return null;

  return {
    id: 'stress',
    title: 'Stress',
    finding: `You rated stress ${seizureMean > quietMean ? 'higher' : 'lower'} on days that also had a seizure — ${seizureMean.toFixed(1)} against ${quietMean.toFixed(1)} out of 5. This is your own impression on the day, so it may reflect the seizure as much as precede it.`,
    sampleSize,
    confidence: confidenceFor(sampleSize),
  };
}

/* ------------------------------------------------------------------ */
/* Top-level                                                           */
/* ------------------------------------------------------------------ */

export type PatternReport =
  | { kind: 'insufficient'; seizureCount: number; needed: number }
  | {
      kind: 'report';
      seizureCount: number;
      confidence: Confidence;
      bands: TimeBand[];
      duration: DurationStats;
      frequency: FrequencyComparison;
      associations: Association[];
      /** True when there are too few check-ins for any control comparison. */
      needsMoreCheckins: boolean;
    };

/**
 * The single entry point the screen uses.
 *
 * Returning a discriminated union rather than a bag of nullable fields is what
 * makes the hard rule enforceable: below the threshold there is no shape in
 * which a chart could be rendered, so a future edit cannot accidentally leak
 * one past the gate.
 */
export function buildPatternReport(
  seizures: Seizure[],
  checkins: DailyCheckin[],
  now: number,
): PatternReport {
  if (seizures.length < MIN_SEIZURES_FOR_PATTERNS) {
    return {
      kind: 'insufficient',
      seizureCount: seizures.length,
      needed: MIN_SEIZURES_FOR_PATTERNS,
    };
  }

  const associations = [
    sleepAssociation(seizures, checkins),
    stressAssociation(seizures, checkins),
  ].filter((a): a is Association => a !== null);

  return {
    kind: 'report',
    seizureCount: seizures.length,
    confidence: confidenceFor(seizures.length),
    bands: timeOfDayBands(seizures),
    duration: durationStats(seizures),
    frequency: frequencyComparison(seizures, now),
    associations,
    needsMoreCheckins: checkins.length < 10,
  };
}
