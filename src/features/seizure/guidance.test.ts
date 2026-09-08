/**
 * The live-seizure guidance schedule.
 *
 * ── WHAT THESE ARE ACTUALLY PROTECTING ────────────────────────────────
 *
 * A gap between two steps renders NOTHING, on the one screen where a blank
 * space is read as the app having stopped working. An overlap picks whichever
 * step happens to come first in the array, which makes the copy order load-
 * bearing in a way nobody would guess from reading it. Neither is visible in
 * review — both are arithmetic — so they are asserted here instead.
 *
 * The boundary cases matter for the same reason the pulse-day tests do: an
 * off-by-one at 300 seconds is the difference between "Almost 5 Minutes" and
 * "Contact an emergency veterinarian immediately".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GUIDANCE, guidanceAt, guidanceIndexAt } from './guidance.ts';

test('the schedule is contiguous — no second falls through a gap', () => {
  for (let i = 1; i < GUIDANCE.length; i += 1) {
    assert.equal(
      GUIDANCE[i].fromSec,
      GUIDANCE[i - 1].toSec,
      `step ${i} ("${GUIDANCE[i].title}") does not start where step ${i - 1} ends`,
    );
  }
});

test('the schedule only moves forwards', () => {
  for (const step of GUIDANCE) {
    if (step.toSec !== null) {
      assert.ok(
        step.toSec > step.fromSec,
        `"${step.title}" ends before it begins`,
      );
    }
  }
});

test('it starts at zero and the last step never ends', () => {
  assert.equal(GUIDANCE[0].fromSec, 0);
  assert.equal(GUIDANCE[GUIDANCE.length - 1].toSec, null);
  // Exactly one open-ended step, or the lookup would stop early.
  assert.equal(GUIDANCE.filter((s) => s.toSec === null).length, 1);
});

test('every second of the first ten minutes resolves to exactly one step', () => {
  for (let s = 0; s <= 600; s += 1) {
    const matches = GUIDANCE.filter(
      (step) => s >= step.fromSec && (step.toSec === null || s < step.toSec),
    );
    assert.equal(matches.length, 1, `second ${s} matched ${matches.length} steps`);
    assert.equal(guidanceAt(s), matches[0], `lookup disagreed at second ${s}`);
  }
});

test('the opening beats are the calming ones', () => {
  assert.equal(guidanceAt(0).title, 'Stay Calm');
  assert.equal(guidanceAt(4).title, 'Stay Calm');
  assert.equal(guidanceAt(5).title, 'Make the Area Safe');
  assert.equal(guidanceAt(9).title, 'Make the Area Safe');
  assert.equal(guidanceAt(10).title, 'Don’t Hold Him Down');
});

test('boundaries belong to the step that is starting, not the one ending', () => {
  assert.equal(guidanceAt(30).title, 'Keep Your Hands Away');
  assert.equal(guidanceAt(60).title, 'You’re Doing Okay');
  assert.equal(guidanceAt(120).title, 'This Is Taking Longer');
  assert.equal(guidanceAt(180).title, 'Stay Alert');
  assert.equal(guidanceAt(240).title, 'Approaching 5 Minutes');
});

test('five minutes is the emergency step, and it holds from then on', () => {
  assert.equal(guidanceAt(299).title, 'Almost 5 Minutes');
  assert.equal(guidanceAt(300).title, '5 Minutes — Emergency');
  assert.equal(guidanceAt(301).title, '5 Minutes — Emergency');
  // A seizure can run a long time, and a phone can be suspended for minutes.
  assert.equal(guidanceAt(60 * 60).title, '5 Minutes — Emergency');
  assert.equal(guidanceAt(Number.MAX_SAFE_INTEGER).title, '5 Minutes — Emergency');
});

test('tone escalates and never softens again', () => {
  const rank = { calm: 0, caution: 1, urgent: 2 } as const;
  let seen = 0;
  for (const step of GUIDANCE) {
    assert.ok(
      rank[step.tone] >= seen,
      `"${step.title}" softens the tone after it had already escalated`,
    );
    seen = rank[step.tone];
  }
  assert.equal(GUIDANCE[GUIDANCE.length - 1].tone, 'urgent');
});

test('a jump forwards lands on the right step, not the next one', () => {
  // useSeizureTimer recomputes from an absolute mark, so elapsed can leap when
  // the OS un-suspends the JS thread. A cursor-based implementation would be
  // sitting on "Stay Calm" here; the lookup must not be one.
  assert.equal(guidanceIndexAt(0), 0);
  assert.equal(guidanceAt(247).title, 'Approaching 5 Minutes');
});

test('a negative or unusable clock still shows something', () => {
  // Wall-clock changes can briefly produce these; see utils/clock.ts.
  assert.equal(guidanceAt(-1).title, 'Stay Calm');
  assert.equal(guidanceAt(Number.NaN).title, 'Stay Calm');
});

test('index tracks the step, so the UI animates once per change', () => {
  assert.equal(guidanceIndexAt(0), guidanceIndexAt(4));
  assert.notEqual(guidanceIndexAt(4), guidanceIndexAt(5));
  assert.equal(guidanceIndexAt(300), GUIDANCE.length - 1);
});

test('every step has copy worth rendering', () => {
  for (const step of GUIDANCE) {
    assert.ok(step.title.trim().length > 0, 'a step has no title');
    assert.ok(step.body.trim().length > 0, `"${step.title}" has no body`);
    assert.ok(step.glyph.trim().length > 0, `"${step.title}" has no glyph`);
  }
});
