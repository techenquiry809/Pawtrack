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

import {
  secondsUntil,
  serverStatedWaitMs,
  signInBackoffMs,
  signUpBackoffMs,
} from './authThrottle.ts';

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

/* ------------------------------------------------------------------ */
/* The signup backoff                                                  */
/* ------------------------------------------------------------------ */

/*
 * The signup form answers "does this email already have an account?" — a
 * deliberate trade against enumeration, documented in sign-up.tsx and
 * docs/SECURITY.md. This ladder is the client-side half of the mitigation.
 * It is a speed bump, not a control: see the note in authThrottle.ts.
 */

test('the first two signup attempts are not delayed', () => {
  // A typo in the email, then the correction, must not cost anyone a wait.
  assert.equal(signUpBackoffMs(1), 0);
  assert.equal(signUpBackoffMs(2), 0);
});

test('probing repeatedly gets progressively more expensive', () => {
  assert.equal(signUpBackoffMs(3), 5_000);
  assert.equal(signUpBackoffMs(4), 10_000);
  assert.equal(signUpBackoffMs(5), 20_000);
  assert.equal(signUpBackoffMs(6), 40_000);
});

test('the signup backoff is capped, so the form never bricks itself', () => {
  // Uncapped doubling would put a real owner behind an hours-long wall after
  // a bad afternoon of typos. The cap is what keeps this recoverable.
  assert.equal(signUpBackoffMs(20), 120_000);
  assert.equal(signUpBackoffMs(500), 120_000);
});

test('signup is throttled sooner but far more gently than sign-in', () => {
  // Different threats: a wrong password is one person failing at one account,
  // a signup scan is bulk. So signup starts costing earlier (3rd vs 4th) and
  // caps much lower (2 min vs 5), because every new owner passes through it.
  assert.equal(signInBackoffMs(3), 0);
  assert.ok(signUpBackoffMs(3) > 0, 'signup starts costing one attempt sooner');
  assert.ok(
    signUpBackoffMs(500) < signInBackoffMs(500),
    'but the signup ceiling must stay well below the sign-in one',
  );
});

/* ------------------------------------------------------------------ */
/* Server-stated cooldowns                                             */
/* ------------------------------------------------------------------ */

/*
 * RESET_COOLDOWN_MS is a local guess at a limit that actually lives in the
 * Supabase dashboard. When the server states its own remaining window, that
 * number wins — otherwise the button re-enables at 60s into a refusal, which
 * reads as a broken app.
 */

test('a GoTrue rate-limit message is read as the authoritative wait', () => {
  assert.equal(
    serverStatedWaitMs({
      status: 429,
      message: 'For security purposes, you can only request this after 47 seconds.',
    }),
    47_000,
  );
});

test('the status alone is enough, and so is the wording alone', () => {
  // Different GoTrue versions vary; neither signal should be load-bearing.
  assert.equal(
    serverStatedWaitMs({ status: 429, message: 'Try again after 12 seconds' }),
    12_000,
  );
  assert.equal(
    serverStatedWaitMs({
      message: 'For security purposes, you can only request this after 30 seconds',
    }),
    30_000,
  );
});

test('anything unrecognised returns null so the caller keeps its own guess', () => {
  // The failure that matters: a rate-limit notice we cannot parse must never
  // become a zero, which would re-enable the button immediately.
  assert.equal(serverStatedWaitMs(null), null);
  assert.equal(serverStatedWaitMs(undefined), null);
  assert.equal(serverStatedWaitMs({ status: 429, message: 'Too many requests' }), null);
  assert.equal(serverStatedWaitMs({ status: 500, message: 'boom' }), null);
});

test('a number in an unrelated error is never mistaken for a duration', () => {
  // Without the rate-limit gate this would read "8" out of a user id and
  // silently shorten the cooldown.
  assert.equal(
    serverStatedWaitMs({ status: 400, message: 'User 8 seconds could not be found' }),
    null,
  );
});

test('an absurd server wait is capped rather than bricking the screen', () => {
  assert.equal(
    serverStatedWaitMs({ status: 429, message: 'you can only request this after 999999 seconds' }),
    3_600_000,
  );
});
