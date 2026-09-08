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

test('formatTimeOfDay hands back anything it cannot parse', () => {
  // Visible nonsense beats a plausible wrong time on a medication screen.
  for (const bad of ['', 'nope', '25:00', '10:75', '8', '8:00 pm']) {
    assert.equal(formatTimeOfDay(bad), bad, bad);
  }
});
