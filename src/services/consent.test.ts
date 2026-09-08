/**
 * Consent version comparison, and the cache key shape.
 *
 * ── WHY THESE TWO ─────────────────────────────────────────────────────
 *
 * services/consent.ts cannot be loaded by `node --test` — it imports the
 * Supabase client and the database through the `@/` alias. What CAN be tested
 * without either is the pair of decisions the whole gate rests on, and both
 * fail silently rather than loudly when they are wrong:
 *
 *   1. The comparison that decides whether an accepted pair of versions still
 *      counts. Get it wrong in one direction and everybody is asked to agree
 *      again on every launch; wrong in the other and a changed policy is never
 *      re-consented and nobody finds out.
 *
 *   2. The cache key. It MUST contain the user id. A device-wide key would
 *      tell the next person to sign in on a shared phone that they had already
 *      agreed — the exact bug that moving consent onto the account was meant
 *      to end, reintroduced by a string.
 *
 * Both are reproduced here byte-for-byte from services/consent.ts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRIVACY_VERSION, TERMS_VERSION } from '../constants/legal.ts';

/** Byte-for-byte the key builders in src/services/consent.ts. */
const cacheKey = (userId: string) => `consent_cache_${userId}`;
const pendingKey = (userId: string) => `consent_pending_${userId}`;

/** Byte-for-byte the CURRENT constant in src/services/consent.ts. */
const CURRENT = `${TERMS_VERSION}|${PRIVACY_VERSION}`;

/** The comparison readConsent() makes against a stored value. */
function isGranted(stored: string | null): boolean {
  return stored === CURRENT;
}

/** The "agreed to something, but not this" test readConsent() makes. */
function hadPrevious(stored: string | null): boolean {
  return stored !== null && stored !== '';
}

test('both documents at their current versions count as agreed', () => {
  assert.equal(isGranted(`${TERMS_VERSION}|${PRIVACY_VERSION}`), true);
});

test('a bump to EITHER document re-opens the gate', () => {
  // The failure this guards: shipping a new Privacy Policy and having nobody
  // asked to accept it, because the Terms happened not to change.
  assert.equal(isGranted(`${TERMS_VERSION}|2020-01-01`), false, 'privacy bumped');
  assert.equal(isGranted(`2020-01-01|${PRIVACY_VERSION}`), false, 'terms bumped');
  assert.equal(isGranted('2020-01-01|2020-01-01'), false, 'both bumped');
});

test('a missing or cleared record is not agreement', () => {
  // clearConsentCache writes '' rather than deleting, because sync_state has
  // no delete. Empty must read the same as absent.
  assert.equal(isGranted(null), false);
  assert.equal(isGranted(''), false);
});

test('cleared and absent are both "never agreed", not "agreed to something older"', () => {
  // If '' read as a previous agreement, a device whose cache had been cleared
  // would be greeted with "we've updated our terms" for terms it has never
  // shown anyone.
  assert.equal(hadPrevious(null), false);
  assert.equal(hadPrevious(''), false);
  assert.equal(hadPrevious('2020-01-01|2020-01-01'), true);
});

test('a partial record never counts as agreement', () => {
  // readConsent() only builds a comparable string when BOTH server columns are
  // non-null. These shapes must never equal CURRENT by accident.
  assert.equal(isGranted(TERMS_VERSION), false);
  assert.equal(isGranted(`${TERMS_VERSION}|`), false);
  assert.equal(isGranted(`|${PRIVACY_VERSION}`), false);
  assert.equal(isGranted('|'), false);
});

test('the cache key is per-user, so a shared phone cannot leak agreement', () => {
  const a = '11111111-1111-1111-1111-111111111111';
  const b = '22222222-2222-2222-2222-222222222222';

  assert.notEqual(cacheKey(a), cacheKey(b));
  assert.ok(cacheKey(a).includes(a), 'the user id must be part of the key');
  assert.notEqual(cacheKey(a), pendingKey(a), 'cache and pending must not collide');
});

test('the version pair is unambiguous under the chosen separator', () => {
  // A separator that could appear inside a version would let two different
  // pairs produce the same stored string.
  assert.ok(!TERMS_VERSION.includes('|'), 'terms version must not contain the separator');
  assert.ok(!PRIVACY_VERSION.includes('|'), 'privacy version must not contain the separator');
  assert.equal(CURRENT.split('|').length, 2);
});
