/**
 * Cluster detection, and the interval trend.
 *
 * ── WHY THIS IS THE MOST SAFETY-RELEVANT MATH IN THE APP ──────────────
 *
 * Everything else in analytics produces a hedged observation the owner may or
 * may not act on. This one drives an alert that says "consider contacting your
 * veterinarian", so both failure directions are real harm:
 *
 *   under-count   the alert never fires on a night it should have
 *   over-count    the alert fires constantly, the owner learns to dismiss it,
 *                 and it is noise on the night it matters
 *
 * The grouping rule is the part most likely to be got wrong, so it is pinned
 * here: seizures at 09:00, 20:00 and 31:00 with a 24h window are ONE run of
 * three, not two overlapping runs of two.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// ./clusters, not the ./index barrel: the barrel imports `@/utils/time`, and
// Node's TypeScript stripping does not resolve the `@/` alias. That constraint
// is why the cluster maths lives in its own dependency-free module.
import {
  activeCluster,
  detectClusters,
  intervalTrend,
  dayOfWeekBands,
} from './clusters.ts';
import type { Seizure } from '../../types/domain.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A seizure with only the fields these functions read. */
function seizureAt(start: number): Seizure {
  return {
    id: `s${start}`,
    dogId: 'dog1',
    status: 'complete',
    durationConfidence: 'high',
    lastTouchedAt: start,
    tzOffsetMin: 0,
    start,
    end: start + 60_000,
    durationSec: 60,
    timingConfidence: 'exact',
    retrospective: false,
    preIctalObs: [],
    preIctalNote: '',
    ictalObs: [],
    awareness: null,
    autonomic: [],
    position: null,
    postBehavior: [],
    severityOwner: null,
    recoveryStart: null,
    recoveryEnd: null,
    recoverySec: null,
    context: {
      food: '', sleep: '', exercise: '', medication: '',
      stress: '', environment: '', illness: '', exposure: '',
    },
    notes: '',
    timeSincePrevSec: null,
    createdAt: start,
    updatedAt: start,
  } as Seizure;
}

/* ------------------------------------------------------------------ */
/* The rule the owner actually means                                   */
/* ------------------------------------------------------------------ */

test('two seizures inside 24 hours is one cluster', () => {
  const clusters = detectClusters(
    [seizureAt(0), seizureAt(10 * HOUR)],
    24,
    2,
  );
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.count, 2);
});

test('two seizures 25 hours apart are NOT a cluster', () => {
  const clusters = detectClusters([seizureAt(0), seizureAt(25 * HOUR)], 24, 2);
  assert.equal(clusters.length, 0, 'the window is exclusive past its end');
});

test('exactly at the window edge still counts', () => {
  const clusters = detectClusters([seizureAt(0), seizureAt(24 * HOUR)], 24, 2);
  assert.equal(
    clusters.length,
    1,
    'a vet saying "two in 24 hours" includes the 24th hour',
  );
});

test('three in a rolling window are ONE run, not two overlapping pairs', () => {
  // 09:00, 20:00, 31:00. Naive pairwise testing reports two clusters that
  // share the middle seizure, and an owner counting on their fingers says
  // "three since yesterday morning".
  const clusters = detectClusters(
    [seizureAt(9 * HOUR), seizureAt(20 * HOUR), seizureAt(31 * HOUR)],
    24,
    2,
  );
  assert.equal(clusters.length, 1, 'one run, not two');
  assert.equal(clusters[0]?.count, 3);
});

test('a run is measured from its FIRST seizure, not the previous one', () => {
  // 0, 20h, 40h, 60h — each gap is under 24h, but the run cannot stretch
  // indefinitely or "in 24 hours" would mean nothing.
  const clusters = detectClusters(
    [seizureAt(0), seizureAt(20 * HOUR), seizureAt(40 * HOUR), seizureAt(60 * HOUR)],
    24,
    2,
  );
  assert.equal(clusters.length, 2, 'the chain must break when the window closes');
  assert.deepEqual(
    clusters.map((c) => c.count),
    [2, 2],
    'first run 0+20h, second run 40h+60h',
  );
});

test('separate clusters weeks apart are both reported, newest first', () => {
  const clusters = detectClusters(
    [
      seizureAt(0), seizureAt(2 * HOUR),
      seizureAt(30 * DAY), seizureAt(30 * DAY + 3 * HOUR),
    ],
    24,
    2,
  );
  assert.equal(clusters.length, 2);
  assert.equal(
    clusters[0]?.startedAt,
    30 * DAY,
    'newest first — the only one that can still need action is the latest',
  );
});

test('input order does not matter', () => {
  const shuffled = [seizureAt(20 * HOUR), seizureAt(0), seizureAt(9 * HOUR)];
  const clusters = detectClusters(shuffled, 24, 2);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.count, 3, 'history arrives newest-first from the repo');
});

test('a higher minCount suppresses pairs', () => {
  const two = [seizureAt(0), seizureAt(2 * HOUR)];
  assert.equal(detectClusters(two, 24, 3).length, 0);
  assert.equal(detectClusters([...two, seizureAt(4 * HOUR)], 24, 3).length, 1);
});

test('a single seizure is never a cluster', () => {
  assert.equal(detectClusters([seizureAt(0)], 24, 2).length, 0);
  assert.equal(detectClusters([], 24, 2).length, 0);
});

test('nonsense thresholds return nothing rather than throwing', () => {
  const rows = [seizureAt(0), seizureAt(HOUR)];
  assert.equal(detectClusters(rows, 0, 2).length, 0);
  assert.equal(detectClusters(rows, 24, 1).length, 0, 'minCount below 2 is meaningless');
});

/* ------------------------------------------------------------------ */
/* Which cluster still deserves an alert                               */
/* ------------------------------------------------------------------ */

test('a cluster inside the window is active', () => {
  const now = 20 * HOUR;
  const active = activeCluster([seizureAt(0), seizureAt(10 * HOUR)], 24, 2, now);
  assert.ok(active, 'another seizure now would extend this same run');
});

test('a cluster whose window has closed is history, not an alert', () => {
  const now = 40 * HOUR;
  const active = activeCluster([seizureAt(0), seizureAt(10 * HOUR)], 24, 2, now);
  assert.equal(
    active,
    null,
    'alerting about last month would train the owner to dismiss it',
  );
});

/* ------------------------------------------------------------------ */
/* Interval trend                                                      */
/* ------------------------------------------------------------------ */

test('interval trend needs six seizures before it says anything', () => {
  const five = [0, 10, 20, 30, 40].map((d) => seizureAt(d * DAY));
  assert.equal(intervalTrend(five), null, 'each half must have more than one gap');
});

test('halving gaps read as shortening', () => {
  // 20d, 20d, 10d, 5d, 5d
  const days = [0, 20, 40, 50, 55, 60];
  const trend = intervalTrend(days.map((d) => seizureAt(d * DAY)));
  assert.equal(trend?.direction, 'shortening');
  assert.ok((trend?.recentMeanDays ?? 0) < (trend?.earlierMeanDays ?? 0));
});

test('evenly spaced seizures read as steady, not as a trend', () => {
  const days = [0, 10, 20, 30, 40, 50];
  assert.equal(
    intervalTrend(days.map((d) => seizureAt(d * DAY)))?.direction,
    'steady',
    'ordinary irregularity must not be reported as an escalation',
  );
});

test('widening gaps read as lengthening', () => {
  const days = [0, 5, 10, 25, 45, 70];
  assert.equal(
    intervalTrend(days.map((d) => seizureAt(d * DAY)))?.direction,
    'lengthening',
  );
});

/* ------------------------------------------------------------------ */
/* Day of week                                                         */
/* ------------------------------------------------------------------ */

test('day-of-week shares sum to one and land on the right days', () => {
  // 2026-08-24 is a Monday.
  const monday = new Date(2026, 7, 24, 12, 0, 0).getTime();
  const bands = dayOfWeekBands([
    seizureAt(monday),
    seizureAt(monday + 7 * DAY),
    seizureAt(monday + 2 * DAY),
  ]);

  const mon = bands.find((b) => b.day === 'Monday');
  assert.equal(mon?.count, 2);
  assert.equal(bands.find((b) => b.day === 'Wednesday')?.count, 1);
  assert.ok(Math.abs(bands.reduce((s, b) => s + b.share, 0) - 1) < 1e-9);
});
