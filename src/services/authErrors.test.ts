/**
 * Sign-in error copy.
 *
 * The failure this file guards is not a crash — it is a red panel shown to
 * someone who did nothing wrong, or a panel reading "DEVELOPER_ERROR" at an
 * owner who cannot act on it. Both look fine to a type checker.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeAuthError, isCancellation, isExistingAccountSignUp } from './authErrors.ts';

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

/* ------------------------------------------------------------------ */
/* "This email already has an account"                                 */
/* ------------------------------------------------------------------ */

/*
 * With email confirmation required, signUp() on an existing CONFIRMED address
 * returns 200 with an obfuscated user rather than an error — deliberately, so
 * the endpoint cannot be enumerated. `identities: []` is the only thing that
 * distinguishes it. Reading it wrong fails in one of two bad directions:
 * missing it strands an owner on a code screen for a code that never arrives;
 * over-firing it refuses a legitimate new signup outright.
 */

test('an existing confirmed account is recognised by its empty identities', () => {
  // The shape GoTrue actually returns: a real-looking user, no identities.
  const obfuscated = {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'taken@example.com',
    identities: [],
  };
  assert.equal(isExistingAccountSignUp(obfuscated), true);
});

test('a genuine new signup carries an identity and is let through', () => {
  const fresh = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'new@example.com',
    identities: [{ id: 'abc', provider: 'email' }],
  };
  assert.equal(isExistingAccountSignUp(fresh), false);
});

test('an ABSENT identities field is not treated as an existing account', () => {
  // The bug `!user.identities?.length` would introduce. `identities` is
  // optional in the SDK type, and "no information" must not be read as "this
  // address is taken" — that refuses a new owner an account they can create.
  assert.equal(isExistingAccountSignUp({ id: 'x', email: 'a@b.c' }), false);
  assert.equal(
    isExistingAccountSignUp({ id: 'x', email: 'a@b.c', identities: null }),
    false,
  );
  assert.equal(
    isExistingAccountSignUp({ id: 'x', email: 'a@b.c', identities: undefined }),
    false,
  );
});

test('a null or non-object user is never an existing account', () => {
  // signUp() returns { user: null } on some error paths; that is an error to
  // report, not an "already registered" panel.
  assert.equal(isExistingAccountSignUp(null), false);
  assert.equal(isExistingAccountSignUp(undefined), false);
  assert.equal(isExistingAccountSignUp('taken'), false);
});

/* ------------------------------------------------------------------ */
/* Mail that never went out, and saying so in the right words          */
/* ------------------------------------------------------------------ */

/*
 * Observed on a real device: signing up with a working email address and
 * password produced
 *
 *   "Could not sign in with Email — Something went wrong and the app could
 *    not say what. Your records are safe on this phone. You can try again,
 *    or use email and password."
 *
 * on the CREATE ACCOUNT screen. Three things wrong in two sentences: it said
 * sign in, it told someone using email and password to use email and
 * password, and it promised safety for records that did not exist yet. The
 * underlying cause — GoTrue's 500 "Error sending confirmation email" — was
 * not mentioned at all, and that is the only part the owner could act on.
 */

test('a failed send is named, not shrugged at', () => {
  const notice = describeAuthError(
    new Error('Error sending confirmation email'),
    'password',
    'sign-up',
  );
  assert.ok(notice);
  assert.match(notice.title, /could not send/i);
  // The one fact that changes what the owner does next: stop watching the inbox.
  assert.match(notice.body, /no confirmation code is coming/i);
  assert.equal(notice.retryable, true);
});

test('a failed reset send names the reset code, not a confirmation code', () => {
  const notice = describeAuthError(
    new Error('Error sending recovery email'),
    'password',
    'sign-in',
  );
  assert.ok(notice);
  assert.match(notice.body, /no reset code is coming/i);
});

test('the sign-up screen never tells you it could not SIGN IN', () => {
  const notice = describeAuthError(new Error('kaboom_500'), 'password', 'sign-up');
  assert.ok(notice);
  assert.match(notice.title, /create your account/i);
  assert.doesNotMatch(notice.title, /sign in/i);
});

test('email/password failures never suggest "use email and password"', () => {
  // Only sensible as a fallback FROM Apple or Google. Offered to someone who
  // is already using email and password, it is a dead end phrased as advice.
  for (const context of ['sign-in', 'sign-up'] as const) {
    const notice = describeAuthError(new Error('kaboom_500'), 'password', context);
    assert.ok(notice);
    assert.doesNotMatch(notice.body, /use email and password/i);
  }
});

test('the stale "records are safe on this phone" promise is gone', () => {
  // Written when an account was optional and local records predated sign-in.
  // An account is required now, so on these screens there is usually nothing
  // recorded yet and the reassurance referred to nothing.
  for (const provider of ['password', 'google', 'apple'] as const) {
    const notice = describeAuthError(new Error('kaboom_500'), provider, 'sign-up');
    assert.ok(notice);
    assert.doesNotMatch(notice.body, /records are safe on this phone/i);
  }
});

test('Apple and Google still get the fallback that has somewhere to fall back TO', () => {
  const notice = describeAuthError(new Error('kaboom_500'), 'google', 'sign-in');
  assert.ok(notice);
  assert.match(notice.title, /google/i);
  assert.match(notice.body, /email and password/i);
});

test('context defaults to sign-in, so existing call sites are unchanged', () => {
  const withDefault = describeAuthError(new Error('kaboom_500'), 'password');
  const explicit = describeAuthError(new Error('kaboom_500'), 'password', 'sign-in');
  assert.deepEqual(withDefault, explicit);
});
