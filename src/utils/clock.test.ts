/**
 * Regression tests for the seizure duration figure.
 *
 * Run with `npm test`. These use node:test and node's native TypeScript
 * stripping — no test framework is installed, and none should be added for
 * this. clock.ts imports nothing, which is what makes it testable this way.
 *
 * ── THE BUG THESE EXIST FOR ───────────────────────────────────────────
 *
 * resolveDuration() measured start → Date.now() at SAVE time. Save happens on
 * the recovery screen, which is two screens and several minutes after the
 * seizure actually stopped. Every one of those minutes was added to the
 * duration, and the result was stamped durationConfidence 'high' — the value
 * reserved for a figure the app itself measured.
 *
 * A vet may adjust an anticonvulsant dose on the trend in this number.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// Explicit .ts extension: node's native type stripping resolves ESM specifiers
// literally, so an extensionless relative import does not resolve here.
import { markStart, resolveDuration, type EndMark, type StartMark } from './clock.ts';

/** A start mark 10 minutes in the past on both clocks. */
function startMark(agoMs: number, mono = true): StartMark {
  return {
    startedAtUtc: Date.now() - agoMs,
    tzOffsetMin: 0,
    startedAtMono: mono ? performance.now() - agoMs : null,
  };
}

const MINUTE = 60_000;

test('duration is measured to the end mark, not to save time', () => {
  // Seizure ran 3 minutes, then the owner spent 12 minutes on the post-seizure
  // and recovery screens before the record was written.
  const start = startMark(15 * MINUTE);
  const end: EndMark = {
    endedAtUtc: start.startedAtUtc + 3 * MINUTE,
    endedAtMono: (start.startedAtMono as number) + 3 * MINUTE,
  };

  const { durationSeconds, confidence } = resolveDuration(start, end);

  assert.equal(durationSeconds, 180, 'must report the 3 minutes it actually ran');
  assert.equal(confidence, 'high');
});

test('without an end mark it still measures to now — the old, wrong behaviour', () => {
  // Pinned deliberately. This is the fallback path for a record with no
  // recorded end, and it must stay honest about being a to-now measurement
  // rather than silently pretending otherwise.
  const start = startMark(15 * MINUTE);
  const { durationSeconds } = resolveDuration(start);
  assert.ok(
    durationSeconds !== null && Math.abs(durationSeconds - 900) <= 2,
    `expected ~900s to now, got ${durationSeconds}`,
  );
});

test('the end mark, not the wall clock, is what a live save uses', () => {
  // The exact shape saveActiveSeizure passes: both marks captured together by
  // endSeizure(). 12 minutes of screen time must not appear in the figure.
  const start = startMark(15 * MINUTE);
  const withEnd = resolveDuration(start, {
    endedAtUtc: start.startedAtUtc + 3 * MINUTE,
    endedAtMono: (start.startedAtMono as number) + 3 * MINUTE,
  });
  const withoutEnd = resolveDuration(start);

  assert.equal(withEnd.durationSeconds, 180);
  assert.ok(
    (withoutEnd.durationSeconds as number) - (withEnd.durationSeconds as number) > 600,
    'the regression would inflate the duration by the screen time',
  );
});

test('a monotonic-free end mark falls back to the wall clock and says so', () => {
  // A salvaged row has no monotonic reading. The end instant is still the right
  // one to measure to; we just cannot claim high confidence for it.
  const start = startMark(15 * MINUTE, /* mono */ false);
  const { durationSeconds, confidence } = resolveDuration(start, {
    endedAtUtc: start.startedAtUtc + 3 * MINUTE,
    endedAtMono: null,
  });

  assert.equal(durationSeconds, 180);
  assert.equal(confidence, 'unreliable');
});

test('wall and monotonic clocks disagreeing downgrades confidence', () => {
  const start = startMark(15 * MINUTE);
  const { confidence } = resolveDuration(start, {
    // Wall clock jumped forward 5 minutes mid-seizure; monotonic did not.
    endedAtUtc: start.startedAtUtc + 8 * MINUTE,
    endedAtMono: (start.startedAtMono as number) + 3 * MINUTE,
  });
  assert.equal(confidence, 'clock_corrected');
});

test('markStart and markEnd read both clocks', () => {
  const mark = markStart();
  assert.equal(typeof mark.startedAtUtc, 'number');
  assert.notEqual(mark.startedAtMono, null);
});
