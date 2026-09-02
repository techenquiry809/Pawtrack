/**
 * Client-side sign-in throttling.
 *
 * These guard the SHAPE of the backoff, not its security value — it has none.
 * See the note on signInBackoffMs. What can genuinely regress here is the
 * countdown reading "0s" while the button is still disabled, and the curve
 * growing without a ceiling.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { signInBackoffMs, secondsUntil } from './authThrottle.ts';

test('the first few wrong passwords are not punished', () => {
  // A mistyped password is the common case, not an attack. Blocking on the
  // first miss would punish everyone to inconvenience nobody.
  for (const n of [0, 1, 2, 3]) {
    assert.equal(signInBackoffMs(n), 0, `attempt ${n} should not block`);
  }
});

test('the backoff starts, doubles, and is capped', () => {
  assert.equal(signInBackoffMs(4), 15_000);
  assert.equal(signInBackoffMs(5), 30_000);
  assert.equal(signInBackoffMs(6), 60_000);
  // Capped: an owner locked out of their dog's records for an hour is a worse
  // outcome than a slow brute force the server is already refusing.
  assert.equal(signInBackoffMs(20), 300_000);
  assert.equal(signInBackoffMs(200), 300_000);
});

test('the backoff never goes backwards as failures mount', () => {
  let prev = -1;
  for (let n = 0; n <= 30; n += 1) {
    const v = signInBackoffMs(n);
    assert.ok(v >= prev, `attempt ${n} decreased`);
    prev = v;
  }
});

test('the countdown rounds UP, so it never shows 0s while still blocked', () => {
  const now = 1_000_000;
  // 1ms left is still blocked; flooring would render "0s" beside a dead
  // button, which is the state that reads as a broken app.
  assert.equal(secondsUntil(now + 1, now), 1);
  assert.equal(secondsUntil(now + 999, now), 1);
  assert.equal(secondsUntil(now + 1000, now), 1);
  assert.equal(secondsUntil(now + 1001, now), 2);
});

test('an elapsed or absent deadline is zero, never negative', () => {
  const now = 1_000_000;
  assert.equal(secondsUntil(null, now), 0);
  assert.equal(secondsUntil(now, now), 0);
  assert.equal(secondsUntil(now - 60_000, now), 0);
});
