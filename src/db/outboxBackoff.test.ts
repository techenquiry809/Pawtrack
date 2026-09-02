/**
 * The retry window.
 *
 * ── WHAT THIS GUARDS ──────────────────────────────────────────────────
 *
 * `attempts` was incremented from migration 1 onward and never read, so a
 * failing batch was re-sent at full rate on every trigger. Nothing spun,
 * because the only triggers are foreground and reconnect-transition — but the
 * failure mode was one new trigger away, and it is invisible until it is a
 * hot loop against a server that is already refusing.
 *
 * These run against the pure predicate rather than SQLite: the window is
 * arithmetic, and arithmetic is where an off-by-one hides.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backoffMs, isDue } from './outbox.ts';

const NOW = 1_800_000_000_000;

test('a row with attempts=4 is skipped until its window has passed', () => {
  // The case named in the brief. 4 failures → 2s * 2^4 = 32s.
  const entry = { attempts: 4, lastAttemptAt: NOW };
  const window = backoffMs(4);
  assert.equal(window, 32_000);

  assert.equal(isDue(entry, NOW), false, 'due immediately after failing');
  assert.equal(isDue(entry, NOW + window - 1), false, 'due 1ms early');
  assert.equal(isDue(entry, NOW + window), true, 'not due exactly on the boundary');
  assert.equal(isDue(entry, NOW + window + 60_000), true, 'not due long after');
});

test('a never-attempted row is always due', () => {
  // The common case: freshly queued, nothing has failed.
  assert.equal(isDue({ attempts: 0, lastAttemptAt: null }, NOW), true);
  assert.equal(isDue({ attempts: 0, lastAttemptAt: NOW }, NOW), true);
});

test('rows queued BEFORE migration 12 are due, not parked forever', () => {
  // last_attempt_at is null on every pre-existing row. Treating null as
  // "attempted at the epoch" would be accidentally right; treating it as
  // "never attempted" is right on purpose. Either way the queue must drain
  // after an upgrade rather than silently stall.
  assert.equal(isDue({ attempts: 7, lastAttemptAt: null }, NOW), true);
});

test('the window grows with failures and is capped at five minutes', () => {
  assert.equal(backoffMs(1), 4_000);
  assert.equal(backoffMs(2), 8_000);
  assert.equal(backoffMs(4), 32_000);
  assert.equal(backoffMs(8), 300_000, 'clamped by the 5-minute ceiling');
  // Capped low deliberately: a seizure logged this morning must not still be
  // on one device tonight because the backoff grew to an hour.
  assert.equal(backoffMs(30), 300_000);
  assert.equal(backoffMs(1000), 300_000);
});

test('the window never shrinks as failures mount', () => {
  let prev = -1;
  for (let n = 0; n <= 40; n += 1) {
    const v = backoffMs(n);
    assert.ok(v >= prev, `attempts=${n} produced a shorter window`);
    prev = v;
  }
});

test('a clock that jumps backwards delays a retry, it does not lose the row', () => {
  // Wall clock, so an NTP correction can move `now` behind lastAttemptAt.
  // The entry must stay queued and simply wait — never be dropped, and never
  // be treated as due-forever.
  const entry = { attempts: 5, lastAttemptAt: NOW };
  assert.equal(isDue(entry, NOW - 3_600_000), false);
  assert.equal(isDue(entry, NOW + backoffMs(5)), true);
});
