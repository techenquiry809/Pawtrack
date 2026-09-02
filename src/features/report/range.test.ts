/**
 * Report boundary maths.
 *
 * ── WHY THESE CASES AND NOT OTHERS ────────────────────────────────────
 *
 * Every failure this file guards against is INVISIBLE in the output. A report
 * with a missing seizure looks exactly like a report of a quieter day, and the
 * vet reading it cannot tell the difference. So the tests pin the three ways
 * the arithmetic goes wrong in practice:
 *
 *   1. a day boundary computed in UTC       → evening events file a day late
 *   2. a day added as 86_400_000 ms         → drifts an hour across a DST change
 *   3. a week anchored on getDay() directly → Sunday lands in the wrong week
 *
 * Each of those is a one-character mistake that still type-checks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// ./range.ts, not the barrel: node --test strips types but does not resolve
// the `@/` alias, so this module stays free of runtime `@/` imports.
import {
  addDaysToKey,
  dayKeyOf,
  daysBetweenKeys,
  endOfMonthKey,
  formatRangeLabel,
  rangeFileStem,
  resolveRange,
  startOfDayKey,
  startOfMonthKey,
  startOfWeekKey,
} from './range.ts';

/* ------------------------------------------------------------------ */
/* Day keys                                                            */
/* ------------------------------------------------------------------ */

test('a day key is the LOCAL date, not the UTC one', () => {
  // 30 Aug 2026, 22:30 local. Under `toISOString().slice(0,10)` any timezone
  // west of Greenwich reports the 31st here — the bug this guards.
  const evening = new Date(2026, 7, 30, 22, 30, 0, 0).getTime();
  assert.equal(dayKeyOf(evening), '2026-08-30');
});

test('midnight belongs to the day that is beginning', () => {
  const midnight = new Date(2026, 7, 30, 0, 0, 0, 0).getTime();
  assert.equal(dayKeyOf(midnight), '2026-08-30');
  assert.equal(startOfDayKey('2026-08-30'), midnight);
});

test('the last millisecond of a day still belongs to that day', () => {
  const lastMs = new Date(2026, 7, 30, 23, 59, 59, 999).getTime();
  assert.equal(dayKeyOf(lastMs), '2026-08-30');
});

/* ------------------------------------------------------------------ */
/* Adding days                                                         */
/* ------------------------------------------------------------------ */

test('adding a day rolls the month', () => {
  assert.equal(addDaysToKey('2026-08-31', 1), '2026-09-01');
});

test('adding a day rolls the year', () => {
  assert.equal(addDaysToKey('2026-12-31', 1), '2027-01-01');
});

test('February is handled by the calendar, not by a day-count table', () => {
  // 2028 is a leap year; 2026 is not.
  assert.equal(addDaysToKey('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysToKey('2026-02-28', 1), '2026-03-01');
});

test('subtracting days walks backwards across a month edge', () => {
  assert.equal(addDaysToKey('2026-09-01', -1), '2026-08-31');
});

test('a day step lands on local midnight even across a DST change', () => {
  // Whatever this machine's zone, every step must land at exactly 00:00 local.
  // Fixed 86_400_000ms arithmetic fails here in any zone that observes DST:
  // it lands at 23:00 the previous day, quietly shifting a report's window.
  let key = '2026-03-01';
  for (let i = 0; i < 400; i += 1) {
    const midnight = new Date(startOfDayKey(key));
    assert.equal(midnight.getHours(), 0, `hour drifted on ${key}`);
    assert.equal(midnight.getMinutes(), 0, `minute drifted on ${key}`);
    assert.equal(dayKeyOf(startOfDayKey(key)), key, `round-trip broke on ${key}`);
    key = addDaysToKey(key, 1);
  }
});

/* ------------------------------------------------------------------ */
/* Weeks                                                               */
/* ------------------------------------------------------------------ */

test('the week starts on Monday', () => {
  // 2026-08-31 is a Monday.
  assert.equal(new Date(2026, 7, 31).getDay(), 1);
  assert.equal(startOfWeekKey('2026-08-31'), '2026-08-31');
});

test('Sunday belongs to the week that is ENDING, not the one starting', () => {
  // 2026-08-30 is a Sunday. The off-by-one here is the classic bug: treating
  // getDay() === 0 as "already Monday" pushes Sunday into the next week.
  assert.equal(new Date(2026, 7, 30).getDay(), 0);
  assert.equal(startOfWeekKey('2026-08-30'), '2026-08-24');
});

test('every day of one week resolves to the same Monday', () => {
  const days = [
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
    '2026-08-28', '2026-08-29', '2026-08-30',
  ];
  for (const d of days) assert.equal(startOfWeekKey(d), '2026-08-24');
});

/* ------------------------------------------------------------------ */
/* Ranges                                                              */
/* ------------------------------------------------------------------ */

test('a day range covers exactly one day and is half-open', () => {
  const r = resolveRange('day', '2026-08-30');
  assert.equal(r.fromKey, '2026-08-30');
  assert.equal(r.toKey, '2026-08-30');
  assert.deepEqual(r.dayKeys, ['2026-08-30']);
  assert.equal(r.fromMs, startOfDayKey('2026-08-30'));
  // Exclusive end: the instant midnight starts the NEXT day.
  assert.equal(r.toMs, startOfDayKey('2026-08-31'));
});

test('consecutive day ranges share no instant', () => {
  const sat = resolveRange('day', '2026-08-29');
  const sun = resolveRange('day', '2026-08-30');
  assert.equal(sat.toMs, sun.fromMs);
  // Half-open on both sides means the shared instant belongs to Sunday only,
  // so a seizure at exactly midnight is counted once across the two reports.
  assert.ok(sat.toMs > sat.fromMs);
  assert.ok(sun.fromMs < sun.toMs);
});

test('a week range covers seven days, anchored on its Monday', () => {
  // Picking a Thursday must produce the whole week, not Thursday + 6.
  const r = resolveRange('week', '2026-08-27');
  assert.equal(r.fromKey, '2026-08-24');
  assert.equal(r.toKey, '2026-08-30');
  assert.equal(r.dayKeys.length, 7);
  assert.equal(r.dayKeys[0], '2026-08-24');
  assert.equal(r.dayKeys[6], '2026-08-30');
  assert.equal(r.toMs, startOfDayKey('2026-08-31'));
});

test('a week spanning a month edge stays seven days', () => {
  const r = resolveRange('week', '2026-09-02');
  assert.equal(r.fromKey, '2026-08-31');
  assert.equal(r.toKey, '2026-09-06');
  assert.equal(r.dayKeys.length, 7);
});

test('consecutive weeks share no instant', () => {
  const a = resolveRange('week', '2026-08-24');
  const b = resolveRange('week', '2026-08-31');
  assert.equal(a.toMs, b.fromMs);
});

/* ------------------------------------------------------------------ */
/* Labels and file names                                               */
/* ------------------------------------------------------------------ */

test('a day label names the weekday, so the reader need not count', () => {
  assert.equal(formatRangeLabel(resolveRange('day', '2026-08-30')), 'Sunday 30 Aug 2026');
});

test('a week label collapses a repeated month but never the year', () => {
  assert.equal(formatRangeLabel(resolveRange('week', '2026-08-24')), '24 – 30 Aug 2026');
});

test('a week label spanning two months names both', () => {
  assert.equal(formatRangeLabel(resolveRange('week', '2026-08-31')), '31 Aug – 6 Sep 2026');
});

test('file stems sort chronologically as plain text', () => {
  const a = rangeFileStem(resolveRange('day', '2026-08-09'));
  const b = rangeFileStem(resolveRange('day', '2026-08-10'));
  // Zero-padding is what makes a directory listing sort correctly.
  assert.equal(a, '2026-08-09');
  assert.ok(a < b);
  assert.equal(rangeFileStem(resolveRange('week', '2026-08-24')), '2026-08-24-to-08-30');
});


/* ------------------------------------------------------------------ */
/* Months                                                              */
/* ------------------------------------------------------------------ */

test('a month ends on its real last day, leap years included', () => {
  assert.equal(endOfMonthKey('2026-08-14'), '2026-08-31');
  assert.equal(endOfMonthKey('2026-09-01'), '2026-09-30');
  // The case a month-length table gets wrong. 2028 is a leap year; 2026 is not.
  assert.equal(endOfMonthKey('2026-02-10'), '2026-02-28');
  assert.equal(endOfMonthKey('2028-02-10'), '2028-02-29');
  // December must roll the YEAR, not wrap to month 13 of the same year.
  assert.equal(endOfMonthKey('2026-12-05'), '2026-12-31');
});

test('any day in a month produces the same month report', () => {
  const first = resolveRange('month', '2026-08-01');
  const middle = resolveRange('month', '2026-08-14');
  const last = resolveRange('month', '2026-08-31');
  for (const r of [first, middle, last]) {
    assert.equal(r.fromKey, '2026-08-01');
    assert.equal(r.toKey, '2026-08-31');
    assert.equal(r.dayKeys.length, 31);
  }
  // Same forgiveness the week picker has, and the same reason.
  assert.deepEqual(first.dayKeys, last.dayKeys);
});

test('a month range is half-open, so months never double-count a seizure', () => {
  const aug = resolveRange('month', '2026-08-14');
  const sep = resolveRange('month', '2026-09-14');
  // August's exclusive end IS September's inclusive start. A seizure at that
  // exact instant belongs to September and to nothing else.
  assert.equal(aug.toMs, sep.fromMs);
  assert.equal(aug.toMs, startOfDayKey('2026-09-01'));
});

test('February in a leap year enumerates 29 days', () => {
  assert.equal(resolveRange('month', '2028-02-10').dayKeys.length, 29);
  assert.equal(resolveRange('month', '2026-02-10').dayKeys.length, 28);
});

/* ------------------------------------------------------------------ */
/* All time                                                            */
/* ------------------------------------------------------------------ */

test('an all-time range spans the first record to the chosen day', () => {
  const r = resolveRange('all', '2026-09-01', '2026-08-30');
  assert.equal(r.fromKey, '2026-08-30');
  assert.equal(r.toKey, '2026-09-01');
  assert.deepEqual(r.dayKeys, ['2026-08-30', '2026-08-31', '2026-09-01']);
});

test('all-time with no history is just the chosen day, not 1970', () => {
  // A dog with nothing recorded must produce an empty report about TODAY.
  const none = resolveRange('all', '2026-09-01');
  assert.equal(none.fromKey, '2026-09-01');
  assert.equal(none.toKey, '2026-09-01');
  assert.equal(none.dayKeys.length, 1);
});

test('an earliest key AFTER the chosen day cannot invert the range', () => {
  // Clock skew or a retrospective record dated in the future. An inverted
  // range would silently produce a report covering nothing.
  const r = resolveRange('all', '2026-09-01', '2026-12-25');
  assert.equal(r.fromKey, '2026-09-01');
  assert.equal(r.toKey, '2026-09-01');
  assert.ok(r.toMs > r.fromMs);
});

test('day counting survives a DST change', () => {
  // Whatever the runner's zone, a month must enumerate its own length —
  // millisecond division reports 30.96 days for a 31-day month across a
  // spring-forward and rounds it to the wrong number.
  assert.equal(daysBetweenKeys('2026-03-01', '2026-03-31'), 31);
  assert.equal(daysBetweenKeys('2026-10-01', '2026-10-31'), 31);
  assert.equal(daysBetweenKeys('2026-08-30', '2026-08-30'), 1);
});

/* ------------------------------------------------------------------ */
/* Labels and file names                                               */
/* ------------------------------------------------------------------ */

test('a month names itself rather than printing its own end points', () => {
  assert.equal(formatRangeLabel(resolveRange('month', '2026-08-14')), 'August 2026');
});

test('an all-time label says what "all" turned out to mean', () => {
  const label = formatRangeLabel(resolveRange('all', '2026-09-01', '2024-03-12'));
  assert.ok(label.startsWith('All records'), label);
  // The span matters: "everything" is only meaningful once the reader knows
  // whether the records start two years ago or two weeks ago.
  assert.ok(label.includes('2024'), label);
  assert.ok(label.includes('Sep'), label);
});

test('file stems sort chronologically and say which period they are', () => {
  assert.equal(rangeFileStem(resolveRange('day', '2026-08-30')), '2026-08-30');
  assert.equal(rangeFileStem(resolveRange('month', '2026-08-14')), '2026-08');
  assert.equal(rangeFileStem(resolveRange('all', '2026-09-01', '2024-03-12')), 'all-to-2026-09-01');
});

test('startOfMonthKey keeps the year and month it was given', () => {
  assert.equal(startOfMonthKey('2026-12-31'), '2026-12-01');
  assert.equal(startOfMonthKey('2026-01-01'), '2026-01-01');
});
