/**
 * The home dashboard's per-day counts.
 *
 * The bug these guard against is the one that was actually shipped: six
 * seizures logged in a single day produced a chart that barely moved, because
 * the buckets were rolling weeks rather than calendar days. A chart that is
 * confidently wrong is worse than no chart.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { seizuresPerDay, startOfLocalDay } from './daily.ts';

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m, d, h, min, 0, 0).getTime();

test('six seizures in one day land in one bucket, all six', () => {
  const now = at(2026, 7, 31, 17);
  const starts = [
    at(2026, 7, 31, 2),
    at(2026, 7, 31, 6, 30),
    at(2026, 7, 31, 9),
    at(2026, 7, 31, 13),
    at(2026, 7, 31, 15, 45),
    at(2026, 7, 31, 16, 50),
  ];
  const days = seizuresPerDay(starts, 14, now);
  // The whole point: today is the LAST bucket and it reads 6, not 1 and not 0.
  assert.equal(days[13], 6);
  assert.equal(days.reduce((a, b) => a + b, 0), 6);
});

test('today is always the last bucket', () => {
  const now = at(2026, 7, 31, 9);
  const days = seizuresPerDay([at(2026, 7, 31, 8)], 7, now);
  assert.equal(days.length, 7);
  assert.equal(days[6], 1);
  assert.deepEqual(days.slice(0, 6), [0, 0, 0, 0, 0, 0]);
});

test('a late-evening seizure stays on ITS day when read the next morning', () => {
  // The rolling-subtraction bug: at 09:00, yesterday 22:00 is 11 hours ago.
  // Elapsed-time bucketing calls that "today"; the calendar does not.
  const now = at(2026, 7, 31, 9);
  const lastNight = at(2026, 7, 30, 22);
  const days = seizuresPerDay([lastNight], 7, now);
  assert.equal(days[6], 0, 'must not be counted as today');
  assert.equal(days[5], 1, 'belongs to yesterday');
});

test('one minute past midnight belongs to the new day', () => {
  const now = at(2026, 7, 31, 3);
  const days = seizuresPerDay([at(2026, 7, 31, 0, 1)], 7, now);
  assert.equal(days[6], 1);
});

test('one minute before midnight belongs to the old day', () => {
  const now = at(2026, 7, 31, 3);
  const days = seizuresPerDay([at(2026, 7, 30, 23, 59)], 7, now);
  assert.equal(days[6], 0);
  assert.equal(days[5], 1);
});

test('quiet days keep their zero rather than being compacted away', () => {
  const now = at(2026, 7, 31);
  const days = seizuresPerDay([at(2026, 7, 31), at(2026, 7, 25)], 14, now);
  assert.equal(days.length, 14);
  assert.equal(days[13], 1);
  assert.equal(days[7], 1);
  // The gaps are the pattern a seizure chart exists to show.
  assert.equal(days.filter((n) => n === 0).length, 12);
});

test('anything older than the window is dropped, not clamped into the oldest bar', () => {
  const now = at(2026, 7, 31);
  // 40 days back, well outside a 14-day chart.
  const days = seizuresPerDay([at(2026, 6, 22)], 14, now);
  assert.equal(days.reduce((a, b) => a + b, 0), 0, 'must not pile into bucket 0');
});

test('a future timestamp does not corrupt the chart', () => {
  // Clock skew and owner-entered dates both produce these.
  const now = at(2026, 7, 31);
  const days = seizuresPerDay([at(2026, 8, 5)], 14, now);
  assert.equal(days.reduce((a, b) => a + b, 0), 0);
});

test('every bucket boundary holds across a whole year of days', () => {
  // Walks a full year so any daylight-saving transition in the runner's zone
  // is crossed. A floor() instead of round() fails here: a 25-hour local day
  // reports as 1.04 days and lands the event in the wrong bar.
  let cursor = at(2026, 0, 1);
  for (let i = 0; i < 365; i += 1) {
    const days = seizuresPerDay([cursor], 2, cursor);
    assert.equal(days[1], 1, `same-day bucketing broke on day ${i}`);

    const dt = new Date(cursor);
    dt.setDate(dt.getDate() + 1);
    const next = dt.getTime();
    const two = seizuresPerDay([cursor], 2, next);
    assert.equal(two[0], 1, `yesterday bucketing broke on day ${i}`);
    assert.equal(two[1], 0, `yesterday leaked into today on day ${i}`);
    cursor = next;
  }
});

test('startOfLocalDay is local midnight, not UTC midnight', () => {
  const evening = at(2026, 7, 30, 22, 30);
  const midnight = new Date(startOfLocalDay(evening));
  assert.equal(midnight.getHours(), 0);
  assert.equal(midnight.getDate(), 30);
});
