/**
 * Which launch URLs are allowed to skip the intro.
 *
 * ── WHAT THESE PROTECT ────────────────────────────────────────────────
 *
 * Two failures, in opposite directions, and they are not equally bad.
 *
 * Failing to recognise the widget's URL costs three seconds of a seizure that
 * nothing can get back — the whole bug this classifier was written for.
 * Recognising too much only skips a brand animation. So the tests below lean
 * on the first: every shape the widget link actually arrives in has a case
 * here, including the development client's wrapped form, because a fast path
 * that cannot be observed in a dev build is a fast path nobody will notice
 * breaking.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyLaunchUrl, routeOfLaunchUrl } from './launchUrl.ts';

test('the widget URL is an emergency launch', () => {
  assert.equal(classifyLaunchUrl('pawtrack://seizure/start'), 'emergency');
});

test('a trailing slash or query does not hide the route', () => {
  assert.equal(classifyLaunchUrl('pawtrack://seizure/start/'), 'emergency');
  assert.equal(classifyLaunchUrl('pawtrack://seizure/start?from=widget'), 'emergency');
  assert.equal(classifyLaunchUrl('pawtrack://seizure/start#top'), 'emergency');
});

test('the live timer counts too', () => {
  assert.equal(classifyLaunchUrl('pawtrack://seizure/live'), 'emergency');
});

test('the development client wrapper is unwrapped', () => {
  // What a dev build actually hands back for the same tap.
  const wrapped =
    'exp+pawtrack://expo-development-client/?url=' +
    encodeURIComponent('pawtrack://seizure/start');
  assert.equal(classifyLaunchUrl(wrapped), 'emergency');
});

test('an ordinary launch has no URL at all', () => {
  assert.equal(classifyLaunchUrl(null), 'ordinary');
  assert.equal(classifyLaunchUrl(undefined), 'ordinary');
  assert.equal(classifyLaunchUrl(''), 'ordinary');
});

test('other deep links are ordinary launches', () => {
  assert.equal(classifyLaunchUrl('pawtrack://emergency-plan'), 'ordinary');
  assert.equal(classifyLaunchUrl('pawtrack://'), 'ordinary');
  assert.equal(classifyLaunchUrl('pawtrack://(tabs)/checkin'), 'ordinary');
});

test('a route that merely starts with the emergency path does not qualify', () => {
  // Guards against a `startsWith` refactor: these are different screens, and
  // only an exact route may skip the intro.
  assert.equal(classifyLaunchUrl('pawtrack://seizure/start-something'), 'ordinary');
  assert.equal(classifyLaunchUrl('pawtrack://seizure/post'), 'ordinary');
});

test('an https link drops its host before matching', () => {
  assert.equal(routeOfLaunchUrl('https://pawtrack.app/seizure/start'), 'seizure/start');
  assert.equal(classifyLaunchUrl('https://pawtrack.app/seizure/start'), 'emergency');
});

test('a malformed percent escape does not throw on the launch path', () => {
  // decodeURIComponent throws on a lone '%'. Launching must not.
  assert.equal(
    classifyLaunchUrl('exp+pawtrack://expo-development-client/?url=%E0%A4%A'),
    'ordinary',
  );
});
