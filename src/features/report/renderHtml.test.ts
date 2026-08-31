/**
 * The rendered document, and the escaping that keeps it safe.
 *
 * ── WHY AN INJECTION TEST EXISTS AT ALL ───────────────────────────────
 *
 * `src/types/domain.ts` warns that owner text reaching this report as HTML is
 * an injection vector, and that a length cap does not close it. A code review
 * cannot enforce that warning for long: the template is one big string, new
 * fields get added to it, and a single `${s.notes}` written without `esc()`
 * still type-checks, still renders, and still looks correct on every dog whose
 * notes happen not to contain a bracket.
 *
 * These tests are the mechanical check. They feed hostile strings through the
 * real renderer and assert the output is inert.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  esc,
  fmtClock,
  fmtDuration,
  renderReportHtml,
  reportFileName,
  timingNote,
} from './renderHtml.ts';
import { resolveRange } from './range.ts';

/* ------------------------------------------------------------------ */
/* Escaping                                                            */
/* ------------------------------------------------------------------ */

test('angle brackets cannot open a tag', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('quotes cannot break out of an attribute', () => {
  // The `src` of a video thumbnail is attribute position. A bare double quote
  // there escapes the attribute without ever needing a `<`.
  assert.equal(esc('" onerror="alert(1)'), '&quot; onerror=&quot;alert(1)');
  assert.equal(esc("' onload='x"), '&#39; onload=&#39;x');
});

test('ampersand is escaped FIRST, so entities are not double-escaped', () => {
  // Escaping `&` last would turn the `&lt;` this function just produced into
  // `&amp;lt;`, and the vet's PDF would print the literal text "&lt;".
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('&lt;'), '&amp;lt;');
  assert.ok(!esc('<a & b>').includes('&amp;lt;'));
});

test('null and undefined render as empty, not as the words', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  // The bug this guards: `${s.notes}` on a null field printing "null" in a
  // clinical document.
  assert.ok(!esc(null).includes('null'));
});

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

test('durations read as minutes and seconds, zero-padded', () => {
  assert.equal(fmtDuration(124), '2m 04s');
  assert.equal(fmtDuration(45), '45s');
  assert.equal(fmtDuration(600), '10m 00s');
});

test('an absent duration is a dash, never "0s"', () => {
  // "0s" would read as a measured zero-length seizure, which is not a thing.
  assert.equal(fmtDuration(null), '—');
  assert.equal(fmtDuration(0), '—');
  assert.equal(fmtDuration(undefined), '—');
});

test('clock times are zero-padded to 24h', () => {
  assert.equal(fmtClock(new Date(2026, 7, 30, 8, 4).getTime()), '08:04');
  assert.equal(fmtClock(new Date(2026, 7, 30, 23, 59).getTime()), '23:59');
});

test('every seizure gets a timing marker, including the good ones', () => {
  // A marker that appeared only on bad rows would make its absence ambiguous.
  assert.equal(timingNote({ durationConfidence: 'high', retrospective: false }), 'timed live');
  assert.equal(
    timingNote({ durationConfidence: 'unreliable', retrospective: false }),
    'timing not dependable',
  );
  assert.equal(
    timingNote({ durationConfidence: 'high', retrospective: true }),
    'logged later, from memory',
  );
});

/* ------------------------------------------------------------------ */
/* File names                                                          */
/* ------------------------------------------------------------------ */

test('a slash in a pet name cannot become a path separator', () => {
  const name = reportFileName('Lucy/Bear', resolveRange('day', '2026-08-30'), '2026-08-30');
  assert.ok(!name.includes('/'), name);
  assert.equal(name, 'PawTrack-Lucy-Bear-2026-08-30.pdf');
});

test('emoji and punctuation are stripped but letters survive', () => {
  assert.equal(
    reportFileName('Lucy 🐕 Jr.', resolveRange('day', '2026-08-30'), '2026-08-30'),
    'PawTrack-Lucy-Jr-2026-08-30.pdf',
  );
  // Non-Latin names must not be erased into nothing.
  assert.equal(
    reportFileName('ルーシー', resolveRange('day', '2026-08-30'), '2026-08-30'),
    'PawTrack-ルーシー-2026-08-30.pdf',
  );
});

test('a name made only of symbols still yields a usable file', () => {
  assert.equal(
    reportFileName('///', resolveRange('day', '2026-08-30'), '2026-08-30'),
    'PawTrack-Dog-2026-08-30.pdf',
  );
});

/* ------------------------------------------------------------------ */
/* The whole document                                                  */
/* ------------------------------------------------------------------ */

const emptySummary = (scope: 'day' | 'week' = 'day') => ({
  range: resolveRange(scope, '2026-08-30'),
  seizureCount: 0,
  duration: {
    usableCount: 0, excludedCount: 0, totalSec: null, medianSec: null, longestSec: null,
  },
  doses: { given: 0, late: 0, missed: 0, recorded: 0 },
  days: resolveRange(scope, '2026-08-30').dayKeys.map((dayKey) => ({
    dayKey, seizureCount: 0, totalSec: null,
  })),
  checkins: [],
  seizures: [],
  doseRows: [],
  videoCount: 0,
  isEmpty: true,
  generatedAt: new Date(2026, 7, 30, 21, 4).getTime(),
});

test('a hostile dog name cannot inject markup into the document', () => {
  const html = renderReportHtml({
    summary: emptySummary() as never,
    dogName: '<script>alert("xss")</script>',
    breedLabel: '"><img src=x onerror=alert(1)>',
    rangeLabel: 'Sunday 30 Aug 2026',
  });
  // The assertion is about STRUCTURE, not vocabulary. Escaping neutralises
  // markup; it does not delete words, and it must not — a dog whose notes read
  // "vet said onerror=..." should still have those words printed. What must be
  // impossible is a TAG forming.
  assert.ok(!html.includes('<script>'), 'a script tag survived escaping');
  assert.ok(!html.includes('<img'), 'an img tag survived escaping');
  // No raw `<` from user input survives anywhere: everything the owner typed
  // arrives as an entity.
  assert.ok(html.includes('&lt;script&gt;'), 'the name should still be visible, escaped');
  assert.ok(html.includes('&lt;img'), 'the breed should still be visible, escaped');
  assert.ok(html.includes('&quot;'), 'a quote should be neutralised, not dropped');
});

test('a quiet day produces a real document that says so', () => {
  const html = renderReportHtml({
    summary: emptySummary() as never,
    dogName: 'Lucy',
    breedLabel: 'Labrador Retriever',
    rangeLabel: 'Sunday 30 Aug 2026',
  });
  // An empty period is a finding, not a failure: absence of seizures is often
  // the most useful thing the report can tell a vet.
  assert.ok(html.includes('No seizures were recorded in this period.'));
  assert.ok(html.includes('Lucy'));
  assert.ok(html.includes('Sunday 30 Aug 2026'));
});

test('every document carries the brand and the disclaimer', () => {
  const html = renderReportHtml({
    summary: emptySummary() as never,
    dogName: 'Lucy',
    breedLabel: 'Labrador Retriever',
    rangeLabel: 'Sunday 30 Aug 2026',
  });
  assert.ok(html.includes('Paw<span>Track</span>'), 'brand mark missing');
  assert.ok(html.includes('Generated by PawTrack'));
  assert.ok(html.includes('Not a medical device'));
});

test('the exclusion caveat appears whenever anything was left out', () => {
  const summary = {
    ...emptySummary(),
    seizureCount: 6,
    duration: {
      usableCount: 4, excludedCount: 2, totalSec: 500, medianSec: 110, longestSec: 200,
    },
  };
  const html = renderReportHtml({
    summary: summary as never,
    dogName: 'Lucy',
    breedLabel: 'Labrador Retriever',
    rangeLabel: 'Sunday 30 Aug 2026',
  });
  // The denominator sentence is the difference between an honest median and a
  // misleading one.
  assert.ok(html.includes('4'), 'usable count missing');
  assert.ok(html.includes('2'), 'excluded count missing');
  assert.ok(html.includes('no dependable timing'));
  assert.ok(html.includes('still listed below'));
});

test('when NOTHING was usable the caveat explains the dashes instead', () => {
  // "the median of 0 reliably timed seizures" is not a sentence, and a reader
  // seeing bare dashes with no explanation assumes the export is broken.
  const summary = {
    ...emptySummary(),
    seizureCount: 1,
    duration: {
      usableCount: 0, excludedCount: 1, totalSec: null, medianSec: null, longestSec: null,
    },
  };
  const html = renderReportHtml({
    summary: summary as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'Sunday 30 Aug 2026',
  });
  assert.ok(!html.includes('median and total of 0'), 'nonsense wording shipped');
  assert.ok(html.includes('no duration figures are shown'));
  assert.ok(html.includes('The record is'));
});

test('no caveat is printed when every record was trustworthy', () => {
  const summary = {
    ...emptySummary(),
    seizureCount: 3,
    duration: {
      usableCount: 3, excludedCount: 0, totalSec: 300, medianSec: 100, longestSec: 140,
    },
  };
  const html = renderReportHtml({
    summary: summary as never,
    dogName: 'Lucy',
    breedLabel: 'Labrador Retriever',
    rangeLabel: 'Sunday 30 Aug 2026',
  });
  assert.ok(!html.includes('no dependable timing'));
});

test('a week report renders a seven-bar day strip; a day report does not', () => {
  const week = renderReportHtml({
    summary: emptySummary('week') as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: '24 – 30 Aug 2026',
  });
  const day = renderReportHtml({
    summary: emptySummary('day') as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'Sunday 30 Aug 2026',
  });
  assert.equal((week.match(/class="bar"/g) ?? []).length, 7);
  assert.ok(!day.includes('class="bar"'));
});
