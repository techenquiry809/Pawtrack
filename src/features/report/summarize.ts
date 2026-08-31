/**
 * Turning a period's raw rows into the numbers a vet reads.
 *
 * ── THE ONE RULE THAT MATTERS ─────────────────────────────────────────
 *
 * A clinician cannot tell a confident wrong number from a right one. So every
 * statistic here carries its own denominator, and every number that was
 * computed from a subset says which subset.
 *
 * `durationConfidence` is the gate — NOT `timingConfidence`, which records how
 * well we know WHEN a seizure started, a different question. A duration marked
 * `unreliable` is one the app itself does not trust: the clock jumped mid-event,
 * or the owner reconstructed it from memory. Averaging a stopwatch reading with
 * a recollection produces a median of nothing.
 *
 * The exclusion is never silent. `excludedCount` travels with every duration
 * statistic so the renderer can print "median of 4 of 6 recorded" rather than a
 * bare number that reads as though all six were measured.
 *
 * Pure, and free of runtime `@/` imports so it can be tested. Types only.
 */

import type { DailyCheckin } from '@/types/domain';
import type { ReportRange } from './range';
import type { DoseWithName, ReportData, SeizureWithClips } from './collect';

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type DurationSummary = {
  /** How many durations were trustworthy enough to count. */
  usableCount: number;
  /** How many were recorded but excluded. Printed whenever non-zero. */
  excludedCount: number;
  totalSec: number | null;
  medianSec: number | null;
  longestSec: number | null;
};

export type DoseSummary = {
  given: number;
  late: number;
  missed: number;
  /** Doses with any record at all. The denominator for adherence. */
  recorded: number;
};

export type DayBucket = {
  dayKey: string;
  seizureCount: number;
  /** Null when nothing in the day had a trustworthy duration. */
  totalSec: number | null;
};

export type ReportSummary = {
  range: ReportRange;
  seizureCount: number;
  duration: DurationSummary;
  doses: DoseSummary;
  /** One entry per day in the range, in order. Drives the week strip. */
  days: DayBucket[];
  checkins: DailyCheckin[];
  seizures: SeizureWithClips[];
  doseRows: DoseWithName[];
  videoCount: number;
  /** True when nothing at all was recorded. A valid report, not an error. */
  isEmpty: boolean;
  generatedAt: number;
};

/* ------------------------------------------------------------------ */
/* Duration                                                            */
/* ------------------------------------------------------------------ */

/**
 * Whether a recorded duration is solid enough to put in a statistic.
 *
 * Mirrors `durationStats` in features/analytics so the exported file and the
 * on-screen report can never disagree about the same set of seizures. A
 * duration of zero is treated as absent rather than as a real measurement.
 */
export function isTrustworthyDuration(s: {
  durationConfidence: string;
  durationSec: number;
}): boolean {
  return s.durationConfidence !== 'unreliable' && s.durationSec > 0;
}

export function summarizeDurations(seizures: SeizureWithClips[]): DurationSummary {
  const usable = seizures
    .filter(isTrustworthyDuration)
    .map((s) => s.durationSec)
    .sort((a, b) => a - b);

  if (usable.length === 0) {
    return {
      usableCount: 0,
      excludedCount: seizures.length,
      totalSec: null,
      medianSec: null,
      longestSec: null,
    };
  }

  const mid = Math.floor(usable.length / 2);
  const medianSec =
    usable.length % 2 === 0
      ? Math.round(((usable[mid - 1] ?? 0) + (usable[mid] ?? 0)) / 2)
      : (usable[mid] ?? 0);

  return {
    usableCount: usable.length,
    excludedCount: seizures.length - usable.length,
    // Total is over the SAME usable set as the median. Summing every row
    // including the untrusted ones would report more seizure time than the app
    // can stand behind, which is the direction that matters clinically.
    totalSec: usable.reduce((a, b) => a + b, 0),
    medianSec,
    longestSec: usable[usable.length - 1] ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Medication                                                          */
/* ------------------------------------------------------------------ */

export function summarizeDoses(doses: DoseWithName[]): DoseSummary {
  let given = 0;
  let late = 0;
  let missed = 0;
  for (const d of doses) {
    if (d.status === 'given') given += 1;
    else if (d.status === 'late') late += 1;
    else if (d.status === 'missed') missed += 1;
  }
  return { given, late, missed, recorded: doses.length };
}

/* ------------------------------------------------------------------ */
/* Per-day                                                             */
/* ------------------------------------------------------------------ */

/**
 * One bucket per day in the range, including days with nothing in them.
 *
 * Empty days are kept on purpose. A week strip that only showed the days
 * something happened would compress four quiet days out of the picture, and
 * the gaps between events are exactly what a clinician is reading the strip
 * for.
 *
 * Bucketing uses each seizure's own `dayKeyOf(start)`, so an event is filed
 * under the day it began even when its recovery ran past midnight.
 */
export function bucketByDay(
  range: ReportRange,
  seizures: SeizureWithClips[],
  dayKeyOf: (ms: number) => string,
): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  for (const key of range.dayKeys) {
    buckets.set(key, { dayKey: key, seizureCount: 0, totalSec: null });
  }
  for (const s of seizures) {
    const bucket = buckets.get(dayKeyOf(s.start));
    if (!bucket) continue;
    bucket.seizureCount += 1;
    if (isTrustworthyDuration(s)) {
      bucket.totalSec = (bucket.totalSec ?? 0) + s.durationSec;
    }
  }
  return range.dayKeys.map((k) => buckets.get(k) ?? {
    dayKey: k, seizureCount: 0, totalSec: null,
  });
}

/* ------------------------------------------------------------------ */
/* The whole thing                                                     */
/* ------------------------------------------------------------------ */

export function summarizeReport(
  data: ReportData,
  dayKeyOf: (ms: number) => string,
): ReportSummary {
  const duration = summarizeDurations(data.seizures);
  const doses = summarizeDoses(data.doses);
  const videoCount = data.seizures.reduce((n, s) => n + s.videos.length, 0);

  return {
    range: data.range,
    seizureCount: data.seizures.length,
    duration,
    doses,
    days: bucketByDay(data.range, data.seizures, dayKeyOf),
    checkins: data.checkins,
    seizures: data.seizures,
    doseRows: data.doses,
    videoCount,
    // "Nothing happened" is a finding, not a failure. A quiet week is often
    // the single most useful thing a report can tell a vet, so this flag
    // changes the wording rather than suppressing the document.
    isEmpty:
      data.seizures.length === 0 &&
      data.doses.length === 0 &&
      data.checkins.length === 0,
    generatedAt: data.generatedAt,
  };
}
