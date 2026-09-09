/**
 * Regression tests for the two day boundaries.
 *
 * Run with `npm test`. node:test with native TypeScript stripping — no test
 * framework, same as clock.test.ts. time.ts imports nothing, which is what
 * makes it testable this way.
 *
 * ── WHY THESE ARE WORTH HAVING ────────────────────────────────────────
 *
 * There are now TWO definitions of "what day is it" in this app, and they
 * disagree for four hours out of every twenty-four:
 *
 *   localDayKey  the calendar day. The key for the check-in unique index, the
 *                dose log, the calendar and the vet report.
 *   pulseDayKey  the calendar day of four hours ago, so the Daily Pulse card
 *                treats a night that runs past midnight as one day.
 *
 * An off-by-one in either is invisible in normal use — you have to be awake at
 * 2am to see it — and the failure it produces is a record filed under the
 * wrong date in a document a vet reads. So the boundary is pinned here rather
 * than left to be checked by hand at an hour nobody tests at.
 *
 * Everything below is constructed with the local-time Date constructor and
 * compared against local-time output, so the suite passes in any timezone
 * rather than only in the one it was written in.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PULSE_DAY_START_HOUR,
  formatTimeOfDay,
  localDayKey,
  pulseDayKey,
} from './time.ts';

/** 8 September 2026 at a given local wall-clock time. */
const at = (hour: number, minute = 0): number =>
  new Date(2026, 8, 8, hour, minute).getTime();

const YESTERDAY = '2026-09-07';
const TODAY = '2026-09-08';

test('localDayKey is the calendar day, all the way to midnight', () => {
  assert.equal(localDayKey(at(0, 0)), TODAY);
  assert.equal(localDayKey(at(3, 59)), TODAY);
  assert.equal(localDayKey(at(12, 0)), TODAY);
  assert.equal(localDayKey(at(23, 59)), TODAY);
});

test('pulseDayKey holds the previous day until 4am', () => {
  // The whole point: someone still up at 1am is answering for the day that is
  // ending, not being asked the same question again on a fresh one.
  assert.equal(pulseDayKey(at(0, 0)), YESTERDAY);
  assert.equal(pulseDayKey(at(1, 30)), YESTERDAY);
  assert.equal(pulseDayKey(at(3, 59)), YESTERDAY);
});

test('pulseDayKey rolls over exactly at 4am, not a minute either side', () => {
  assert.equal(pulseDayKey(at(3, 59)), YESTERDAY);
  assert.equal(pulseDayKey(at(4, 0)), TODAY);
  assert.equal(pulseDayKey(at(4, 1)), TODAY);
});

test('pulseDayKey agrees with the calendar for the rest of the day', () => {
  for (const hour of [4, 9, 12, 18, 23]) {
    assert.equal(pulseDayKey(at(hour)), localDayKey(at(hour)), `at ${hour}:00`);
  }
});

test('the boundary is derived from PULSE_DAY_START_HOUR, not hardcoded twice', () => {
  // Guards the constant against being changed in one place only: whatever it
  // says, the hour before it belongs to yesterday and the hour itself does not.
  assert.equal(pulseDayKey(at(PULSE_DAY_START_HOUR - 1, 59)), YESTERDAY);
  assert.equal(pulseDayKey(at(PULSE_DAY_START_HOUR, 0)), TODAY);
});

test('the pulse day crosses a month end correctly', () => {
  // 1 October at 2am is still September's last day as far as the pulse is
  // concerned. Subtracting hours from a Date handles this; subtracting from
  // the day NUMBER would not, which is the reason to test it.
  const firstOfOctober2am = new Date(2026, 9, 1, 2, 0).getTime();
  assert.equal(localDayKey(firstOfOctober2am), '2026-10-01');
  assert.equal(pulseDayKey(firstOfOctober2am), '2026-09-30');
});

/* ------------------------------------------------------------------ */
/* formatTimeOfDay                                                     */
/* ------------------------------------------------------------------ */
/*
 * Medication reminder times are stored 24-hour and shown 12-hour. The two
 * hours that do not simply lose twelve — midnight and noon — are the ones
 * worth pinning: rendering 00:30 as "0:30 am" or 12:30 as "12:30 am" puts a
 * dose twelve hours from where the owner set it.
 */

test('formatTimeOfDay renders morning times', () => {
  assert.equal(formatTimeOfDay('07:00'), '7:00 am');
  assert.equal(formatTimeOfDay('08:05'), '8:05 am');
  assert.equal(formatTimeOfDay('11:59'), '11:59 am');
});

test('formatTimeOfDay renders afternoon and evening times', () => {
  assert.equal(formatTimeOfDay('13:00'), '1:00 pm');
  assert.equal(formatTimeOfDay('18:30'), '6:30 pm');
  assert.equal(formatTimeOfDay('23:45'), '11:45 pm');
});

test('formatTimeOfDay gets midnight and noon right', () => {
  assert.equal(formatTimeOfDay('00:00'), '12:00 am');
  assert.equal(formatTimeOfDay('00:30'), '12:30 am');
  assert.equal(formatTimeOfDay('12:00'), '12:00 pm');
  assert.equal(formatTimeOfDay('12:30'), '12:30 pm');
});

/**
 * ARBITRARY MINUTES, NOT JUST MULTIPLES OF FIVE.
 *
 * The reminder picker used to step minutes in fives and SNAPPED an existing
 * value to that grid on open, so a 07:07 reminder silently became 07:05. The
 * step is now one and the snapping is gone, which means every minute 00-59 can
 * reach this formatter for the first time.
 *
 * Nothing here changed to allow that — padStart has always handled it — but
 * nothing proved it either, and "the display was fine before" is not evidence
 * about values that could not previously occur.
 */
test('formatTimeOfDay renders every off-grid minute', () => {
  assert.equal(formatTimeOfDay('07:07'), '7:07 am');
  assert.equal(formatTimeOfDay('06:47'), '6:47 am');
  assert.equal(formatTimeOfDay('07:23'), '7:23 am');
  assert.equal(formatTimeOfDay('00:01'), '12:01 am');
  assert.equal(formatTimeOfDay('12:01'), '12:01 pm');
  assert.equal(formatTimeOfDay('23:59'), '11:59 pm');
  // The single-digit minute is the one that would expose a lost padStart.
  assert.equal(formatTimeOfDay('09:09'), '9:09 am');
});

test('formatTimeOfDay round-trips all 1440 minutes of the day', () => {
  // Exhaustive rather than sampled: the whole point of the change is that the
  // input space went from 288 reachable values to 1440, so check all of them.
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m++) {
      const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const out = formatTimeOfDay(hhmm);
      assert.notEqual(out, hhmm, `${hhmm} was rejected as unparseable`);
      assert.match(out, /^(1[0-2]|[1-9]):[0-5]\d (am|pm)$/, hhmm);
      // The minute must survive verbatim — this is what a truncation or a
      // rounding step would break, and it would break it silently.
      assert.equal(out.split(':')[1].slice(0, 2), String(m).padStart(2, '0'), hhmm);
    }
  }
});

test('reminder times sort chronologically as plain strings', () => {
  // Both the SQL ORDER BY and the two in-memory sorts rely on this: zero-padded
  // HH:MM compares lexicographically in clock order. Odd minutes must not
  // disturb it, or a dose list renders out of sequence.
  const times = ['07:23', '07:07', '23:59', '00:01', '07:05', '12:00', '06:47'];
  assert.deepEqual(
    [...times].sort((a, b) => a.localeCompare(b)),
    ['00:01', '06:47', '07:05', '07:07', '07:23', '12:00', '23:59'],
  );
});

test('formatTimeOfDay hands back anything it cannot parse', () => {
  // Visible nonsense beats a plausible wrong time on a medication screen.
  for (const bad of ['', 'nope', '25:00', '10:75', '8', '8:00 pm']) {
    assert.equal(formatTimeOfDay(bad), bad, bad);
  }
});
