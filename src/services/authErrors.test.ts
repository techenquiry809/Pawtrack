/**
 * Sign-in error copy.
 *
 * The failure this file guards is not a crash — it is a red panel shown to
 * someone who did nothing wrong, or a panel reading "DEVELOPER_ERROR" at an
 * owner who cannot act on it. Both look fine to a type checker.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeAuthError, isCancellation } from './authErrors.ts';

/* ------------------------------------------------------------------ */
/* Cancellation is not an error                                        */
/* ------------------------------------------------------------------ */

test('backing out of either sheet shows nothing at all', () => {
  // The reported bug: Google had no cancellation check, so dismissing the
  // sheet raised an error panel. Every spelling both SDKs have used.
  const cancels: unknown[] = [
    { code: 'ERR_REQUEST_CANCELED' },          // expo-apple-authentication
    { code: 'SIGN_IN_CANCELLED' },             // google-signin
    { code: -5 },                              // google-signin, iOS raw
    { code: 12501 },                           // google-signin, Android raw
    new Error('The user canceled the sign-in flow.'),
    new Error('User cancelled'),
    // The iOS consent sheet is ASWebAuthenticationSession, not GIDSignIn, so
    // dismissing it does NOT produce -5. This is what it actually throws.
    new Error(
      'RNGoogleSignIn: Unknown error in google sign in., Error Domain=' +
        'com.apple.AuthenticationServices.WebAuthenticationSession error 1.',
    ),
  ];
  for (const e of cancels) {
    assert.equal(isCancellation(e), true, `not detected: ${JSON.stringify(e)}`);
    assert.equal(describeAuthError(e, 'google'), null);
    assert.equal(describeAuthError(e, 'apple'), null);
  }
});

/* ------------------------------------------------------------------ */
/* Our fault vs theirs                                                 */
/* ------------------------------------------------------------------ */

test('a configuration fault says so and does NOT offer a pointless retry', () => {
  const notice = describeAuthError({ code: 'DEVELOPER_ERROR' }, 'google');
  assert.ok(notice);
  assert.equal(notice.retryable, false, 'retry cannot fix our config');
  assert.match(notice.body, /problem with the app/i);
  // It must not imply the owner's account is at fault.
  assert.doesNotMatch(notice.body, /your password|your account is/i);
});

test('a missing id token reads as a setup problem, not a user mistake', () => {
  // This is the state an empty webClientId actually produces.
  const notice = describeAuthError(
    new Error('Google did not return an identity token.'),
    'google',
  );
  assert.ok(notice);
  assert.equal(notice.retryable, false);
  assert.match(notice.body, /setup/i);
  // It must not assert that the sign-in completed — this branch cannot know.
  assert.doesNotMatch(notice.body, /completed but/i);
  assert.doesNotMatch(notice.title, /did not finish/i);
});

test('no raw SDK jargon ever reaches the owner', () => {
  for (const e of [
    { code: 'DEVELOPER_ERROR' },
    new Error('RNGoogleSignin: something failed'),
    new Error('DEVELOPER_ERROR'),
  ]) {
    const notice = describeAuthError(e, 'google');
    assert.ok(notice);
    const text = `${notice.title} ${notice.body}`;
    assert.doesNotMatch(text, /DEVELOPER_ERROR|RNGoogleSignin|_/, text);
  }
});

/* ------------------------------------------------------------------ */
/* Transient                                                           */
/* ------------------------------------------------------------------ */

test('a network failure offers retry and reassures about the records', () => {
  const notice = describeAuthError(new Error('Network request failed'), 'google');
  assert.ok(notice);
  assert.equal(notice.retryable, true);
  // The reassurance is the point: signing in is a backup, not the store.
  assert.match(notice.body, /saved on this phone/i);
});

/* ------------------------------------------------------------------ */
/* Our own messages survive                                            */
/* ------------------------------------------------------------------ */

test('a message written for owners is passed through, not replaced', () => {
  // authStore throws these deliberately; replacing them with something vaguer
  // would throw away the one thing that tells the owner what to do.
  const notice = describeAuthError(
    new Error('That email and password do not match.'),
    'password',
  );
  assert.ok(notice);
  assert.equal(notice.body, 'That email and password do not match.');
});

test('every notice is a complete, readable pair', () => {
  for (const e of [
    new Error('boom'),
    { code: 'DEVELOPER_ERROR' },
    new Error('Network request failed'),
    new Error('rate limit exceeded'),
  ]) {
    const notice = describeAuthError(e, 'google');
    assert.ok(notice);
    assert.ok(notice.title.length > 0 && notice.title.length < 60, notice.title);
    assert.ok(notice.body.length > 20, notice.body);
    // A title that ends in a full stop reads as a truncated sentence beside
    // the body, not as a heading.
    assert.doesNotMatch(notice.title, /[.]$/);
  }
});
