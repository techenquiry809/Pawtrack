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
  clipLocation,
  esc,
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
  const name = reportFileName('Lucy/Bear', '2026-08-30');
  assert.ok(!name.includes('/'), name);
  assert.equal(name, 'PawTrack-Lucy-Bear-2026-08-30.pdf');
});

test('emoji and punctuation are stripped but letters survive', () => {
  assert.equal(
    reportFileName('Lucy 🐕 Jr.', '2026-08-30'),
    'PawTrack-Lucy-Jr-2026-08-30.pdf',
  );
  // Non-Latin names must not be erased into nothing.
  assert.equal(
    reportFileName('ルーシー', '2026-08-30'),
    'PawTrack-ルーシー-2026-08-30.pdf',
  );
});

test('a name made only of symbols still yields a usable file', () => {
  assert.equal(
    reportFileName('///', '2026-08-30'),
    'PawTrack-Dog-2026-08-30.pdf',
  );
});

/* ------------------------------------------------------------------ */
/* The whole document                                                  */
/* ------------------------------------------------------------------ */

/**
 * A dog with nothing filled in beyond the required fields.
 *
 * Deliberately sparse: the profile block must print only what the owner
 * actually entered, so the fixture that proves it has to be mostly empty.
 */
const bareDog = {
  id: 'd1', name: 'Lucy', photoUri: '', sex: '', ageYears: null, weightKg: null,
  dob: '', diagnosisStatus: 'suspected', firstSeizureDate: '', seizureType: '',
  allergies: '', diet: '',
  breed: { breedId: '', breedName: '', breedSource: '', userEnteredDescription: '' },
  vet: { name: '', clinic: '', phone: '' },
  emergencyVet: { name: '', clinic: '', phone: '' },
  emergencyPlan: {},
  createdAt: 0, updatedAt: 0,
};

const emptySummary = (scope: 'day' | 'week' | 'month' | 'all' = 'day') => ({
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
  medications: [],
  videoCount: 0,
  isEmpty: true,
  generatedAt: new Date(2026, 7, 30, 21, 4).getTime(),
});

test('a hostile dog name cannot inject markup into the document', () => {
  const html = renderReportHtml({
    summary: emptySummary() as never,
    dog: bareDog as never,
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
    dog: bareDog as never,
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
    dog: bareDog as never,
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
    dog: bareDog as never,
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
    dog: bareDog as never,
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
    dog: bareDog as never,
    dogName: 'Lucy',
    breedLabel: 'Labrador Retriever',
    rangeLabel: 'Sunday 30 Aug 2026',
  });
  assert.ok(!html.includes('no dependable timing'));
});

test('a week report renders a seven-bar day strip; a day report does not', () => {
  const week = renderReportHtml({
    summary: emptySummary('week') as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: '24 – 30 Aug 2026',
  });
  const day = renderReportHtml({
    summary: emptySummary('day') as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'Sunday 30 Aug 2026',
  });
  assert.equal((week.match(/class="bar"/g) ?? []).length, 7);
  assert.ok(!day.includes('class="bar"'));
});

/* ------------------------------------------------------------------ */
/* Branding, medication and check-ins                                  */
/* ------------------------------------------------------------------ */

test('the logo is vector and self-contained, never a broken image', () => {
  const html = renderReportHtml({
    summary: emptySummary() as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'Sunday 30 Aug 2026',
  });
  // expo-print renders the HTML with no base URL, so any <img src="./..."> is
  // a broken-image box in the PDF. The mark has to carry its own pixels.
  assert.ok(html.includes('<svg'), 'the logo should be inline SVG');
  assert.ok(html.includes('aria-label="PawTrack"'));
  assert.ok(!/<img[^>]+src=["']\.?\//.test(html), 'a relative image src would print broken');
});

test('a mood-only check-in prints its energy and NOTHING else', () => {
  // The row exists because someone tapped one face on the dashboard. Every
  // other column holds a schema default nobody answered; printing them would
  // manufacture clinical observations out of a single tap.
  const summary = {
    ...emptySummary(),
    checkins: [{
      id: 'c1', dogId: 'd1', timestamp: 0, checkInDate: '2026-08-30',
      sleepHrs: null, appetite: 'normal', water: 'normal', energy: 5, stress: 2,
      medOnTime: true, gi: 'none', unusual: '', backfilled: false, moodOnly: true,
      createdAt: 0, updatedAt: 0,
    }],
  };
  const html = renderReportHtml({
    summary: summary as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'Sunday 30 Aug 2026',
  });
  assert.ok(html.includes('Bouncy'), 'the real value should print');
  assert.ok(html.includes('energy only'), 'the row must be marked as partial');
  assert.ok(html.includes('never answered'), 'the footnote must explain the dashes');
  // The defaults must not appear as if they were observations.
  const row = html.slice(html.indexOf('2026-08-30'), html.indexOf('energy only'));
  assert.ok(!row.includes('normal'), 'a default was printed as an observation');
});

test('a full check-in prints every field it was actually given', () => {
  const summary = {
    ...emptySummary(),
    checkins: [{
      id: 'c1', dogId: 'd1', timestamp: 0, checkInDate: '2026-08-30',
      sleepHrs: 7.5, appetite: 'decreased', water: 'increased', energy: 2, stress: 4,
      medOnTime: false, gi: 'vomit', unusual: 'off her food', backfilled: false,
      moodOnly: false, createdAt: 0, updatedAt: 0,
    }],
  };
  const html = renderReportHtml({
    summary: summary as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'Sunday 30 Aug 2026',
  });
  for (const v of ['decreased', 'increased', 'vomit', 'off her food', '4/5', '7.5 h']) {
    assert.ok(html.includes(v), `missing ${v}`);
  }
  assert.ok(!html.includes('energy only'));
});

test('the prescribed regimen is printed even when no dose was logged', () => {
  // "Three drugs prescribed, none recorded this week" is a finding. An empty
  // medication section cannot say it.
  const summary = {
    ...emptySummary(),
    medications: [{
      id: 'm1', dogId: 'd1', name: 'Phenobarbital', dose: '30', unit: 'mg',
      frequency: 'Twice daily', prescriber: 'Dr Adeyemi', createdAt: 0, updatedAt: 0,
      reminders: [{ id: 'r1', medicationId: 'm1', timeHHMM: '08:00', enabled: true }],
    }],
    doseRows: [],
  };
  const html = renderReportHtml({
    summary: summary as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'Sunday 30 Aug 2026',
  });
  assert.ok(html.includes('Phenobarbital'));
  assert.ok(html.includes('30 mg'), 'dose and unit should read as one value');
  assert.ok(html.includes('Twice daily'));
  assert.ok(!html.includes('08:00'), 'the report no longer prints clock times');
  assert.ok(html.includes('Dr Adeyemi'));
  assert.ok(html.includes('No medication recorded in this period.'), 'the dose log still says it is empty');
});

test('a hostile medication name cannot inject markup', () => {
  const summary = {
    ...emptySummary(),
    medications: [{
      id: 'm1', dogId: 'd1', name: '<script>x</script>', dose: '"><b>', unit: '',
      frequency: '', prescriber: '', createdAt: 0, updatedAt: 0, reminders: [],
    }],
  };
  const html = renderReportHtml({
    summary: summary as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'x',
  });
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('an all-time strip aggregates into months instead of drawing 900 bars', () => {
  // A per-day strip over years is a smear, not a chart.
  const summary = emptySummary('all');
  const long = {
    ...summary,
    days: Array.from({ length: 400 }, (_, i) => ({
      dayKey: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`,
      seizureCount: 0, totalSec: null,
    })),
  };
  const html = renderReportHtml({
    summary: long as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'All records',
  });
  const bars = (html.match(/class="bar"/g) ?? []).length;
  assert.ok(bars <= 12, `expected month bars, got ${bars}`);
  assert.ok(html.includes('Seizures per month'));
});

test('only the profile fields the owner filled in are printed', () => {
  const html = renderReportHtml({
    summary: emptySummary() as never,
    dog: bareDog as never,
    dogName: 'Lucy', breedLabel: 'Lab', rangeLabel: 'x',
  });
  // An empty "Weight —" row invites the reader to believe the dog was weighed.
  assert.ok(!html.includes('Weight'), 'an unfilled field was printed');
  assert.ok(!html.includes('Allergies'));
  assert.ok(!html.includes('Care team'), 'an empty care team should be omitted');
});

/* ------------------------------------------------------------------ */
/* The dose log                                                        */
/* ------------------------------------------------------------------ */
/*
 * A vet reads down this table to answer one question: was the drug taken, and
 * when was it meant to be. It used to repeat the date on every row and print
 * the raw enum, so three doses on one day were three identical lines saying
 * "2026-08-30  Keppra  given" with nothing distinguishing them.
 */

const doseRow = (
  doseDate: string,
  scheduledHHMM: string,
  status: 'given' | 'late' | 'missed',
  medicationName: string | null = 'Keppra',
) => ({
  id: `${doseDate}-${scheduledHHMM}`,
  medicationId: 'm1',
  dogId: 'd1',
  doseDate,
  scheduledHHMM,
  status,
  recordedAt: 0,
  note: '',
  createdAt: 0,
  medicationName,
});

const withDoses = (rows: ReturnType<typeof doseRow>[]) => ({
  ...emptySummary(),
  doseRows: rows,
  isEmpty: false,
});

const renderWith = (summary: unknown, dog: unknown = bareDog) =>
  renderReportHtml({
    summary: summary as never,
    dog: dog as never,
    dogName: 'Lucy',
    breedLabel: 'Labrador Retriever',
    rangeLabel: 'Sunday 30 Aug 2026',
  });

test('a day with several doses prints its date once, not once per row', () => {
  const html = renderWith(
    withDoses([
      doseRow('2026-08-30', '08:00', 'given'),
      doseRow('2026-08-30', '12:00', 'late'),
      doseRow('2026-08-30', '20:00', 'missed'),
    ]),
  );
  const dateCount = html.split('2026-08-30').length - 1;
  assert.equal(dateCount, 1, `the date should appear once, appeared ${dateCount} times`);
});

test('each dose row is identified by its scheduled time, in 12-hour form', () => {
  const html = renderWith(
    withDoses([
      doseRow('2026-08-30', '08:00', 'given'),
      doseRow('2026-08-30', '12:00', 'late'),
      doseRow('2026-08-30', '20:00', 'missed'),
    ]),
  );
  assert.ok(html.includes('8:00 am'), '8:00 am missing');
  assert.ok(html.includes('12:00 pm'), 'noon must be pm, not am');
  assert.ok(html.includes('8:00 pm'), '20:00 should read as 8:00 pm');
});

test('a second day starts a new group with its own date', () => {
  const html = renderWith(
    withDoses([
      doseRow('2026-08-30', '08:00', 'given'),
      doseRow('2026-08-31', '08:00', 'given'),
    ]),
  );
  assert.equal(html.split('2026-08-30').length - 1, 1);
  assert.equal(html.split('2026-08-31').length - 1, 1);
});

test('the status is printed in words, never as the stored enum', () => {
  // "given" alone in a column is ambiguous to a reader who has not been told
  // the vocabulary — and "missed" reads as an accusation rather than a report.
  const html = renderWith(
    withDoses([
      doseRow('2026-08-30', '08:00', 'given'),
      doseRow('2026-08-30', '12:00', 'late'),
      doseRow('2026-08-30', '20:00', 'missed'),
    ]),
  );
  assert.ok(html.includes('Given on time'));
  assert.ok(html.includes('Given late'));
  assert.ok(html.includes('Not given'));
  // The class hooks still carry the enum; the visible cell must not.
  assert.ok(!html.includes('>given<'), 'the raw enum leaked into a cell');
  assert.ok(!html.includes('>missed<'), 'the raw enum leaked into a cell');
});

test('an ad-hoc dose with no slot does not print a fabricated time', () => {
  const html = renderWith(withDoses([doseRow('2026-08-30', '', 'given')]));
  assert.ok(html.includes('—'), 'an unscheduled dose should read as a dash');
  assert.ok(!html.includes('12:00 am'), 'an empty slot must not become midnight');
});

/* ------------------------------------------------------------------ */
/* Dog facts                                                           */
/* ------------------------------------------------------------------ */

test('an undiagnosed dog does not get a "Diagnosis" row', () => {
  // 'undiagnosed' is the field's empty value. Printing it states the absence
  // of a finding as though it were one, in a document about what IS known.
  const html = renderWith(emptySummary(), { ...bareDog, diagnosisStatus: 'undiagnosed' });
  assert.ok(!html.includes('undiagnosed'), 'the empty diagnosis was printed');
  assert.ok(!html.includes('Diagnosis'), 'an empty Diagnosis row was printed');
});

test('a real diagnosis is still printed — it is what a referral vet reads first', () => {
  for (const status of ['suspected', 'diagnosed']) {
    const html = renderWith(emptySummary(), { ...bareDog, diagnosisStatus: status });
    assert.ok(html.includes('Diagnosis'), `${status} lost its row`);
    assert.ok(html.includes(status), `${status} was not printed`);
  }
});

/* ------------------------------------------------------------------ */
/* Video clips                                                         */
/* ------------------------------------------------------------------ */

/**
 * ── WHY THESE EXIST ───────────────────────────────────────────────────
 *
 * The report used to embed each clip's poster frame as `<img src="file://…">`.
 * In a PDF that is a broken-image glyph whenever the path does not resolve,
 * and an empty grey square whenever there is no thumbnail at all — which is
 * ALWAYS the case for a clip whose bytes are on another phone, because the
 * still is extracted from the file and lives with it.
 *
 * So: no `<img>` anywhere near a clip, and a line of text saying where the
 * footage actually is. The `<img>` assertion is the regression guard — it is
 * the specific thing that printed wrong on a real report.
 */

const clipSeizure = (videos: unknown[]) => ({
  id: 's1', dogId: 'd1', start: new Date(2026, 7, 30, 9, 0).getTime(),
  end: null, durationSec: 40, durationConfidence: 'high', retrospective: false,
  preIctalObs: [], preIctalNote: '', ictalObs: [], awareness: null,
  autonomic: [], position: null, postBehavior: [], severityOwner: null,
  recoverySec: null, notes: '', videos,
});

const clip = (over: Record<string, unknown> = {}) => ({
  id: 'v1', seizureId: 's1', dogId: 'd1', source: 'recorded', fileUri: 'x.mp4',
  isLocal: true, originDeviceId: null, timestamp: 0, importedAt: 0,
  captureConfidence: 'device', thumbUri: '', durationSec: 12, note: '',
  preNote: '', ictalNote: '', postNote: '', ...over,
});

const withClips = (videos: unknown[]) => ({
  ...emptySummary(),
  seizureCount: 1,
  isEmpty: false,
  videoCount: videos.length,
  seizures: [clipSeizure(videos)],
});

const render = (summary: unknown, deviceNames?: Record<string, string>) =>
  renderReportHtml({
    summary: summary as never,
    dog: bareDog as never,
    dogName: 'Lucy',
    breedLabel: 'Labrador Retriever',
    rangeLabel: 'Sunday 30 Aug 2026',
    ...(deviceNames ? { deviceNames } : {}),
  });

test('a clip prints an icon, never an image tag', () => {
  const html = render(withClips([clip({ thumbUri: 'file:///data/thumb.jpg' })]));
  // The regression: a file:// still that the PDF renderer cannot resolve.
  assert.ok(!html.includes('<img'), 'the report still embeds an image');
  assert.ok(!html.includes('file:///data/thumb.jpg'), 'a local file path leaked into the PDF');
  assert.ok(!html.includes('noshot'), 'the empty-square fallback is still being rendered');
  assert.ok(html.includes('class="vicon"'), 'no video icon was drawn');
});

test('a clip says where its footage is', () => {
  const html = render(withClips([clip()]));
  assert.ok(html.includes('Video 1 of 1'));
  assert.ok(html.includes('saved in the app on this phone'));
  // Matched loosely: the sentence wraps across lines in the template, and a
  // test that pinned the exact whitespace would break on a reflow.
  assert.match(
    html,
    /recordings themselves are not part of this\s+document/,
    'the report should say the files are not attached',
  );
});

test('filmed in the app, imported, and remote each read differently', () => {
  assert.match(
    clipLocation({ isLocal: true, source: 'recorded', originDeviceId: null }),
    /Filmed in the PawTrack app/,
  );
  assert.match(
    clipLocation({ isLocal: true, source: 'uploaded', originDeviceId: null }),
    /photo library/,
  );
  // The one that matters: the row synced but the bytes never leave the phone
  // that filmed them, so a second device has a record and no file.
  assert.match(
    clipLocation({ isLocal: false, source: 'recorded', originDeviceId: 'dev-2' }),
    /Not on this phone/,
  );
});

test('a remote clip names the phone that holds it when the registry knows it', () => {
  const remote = clip({ isLocal: false, originDeviceId: 'dev-2' });
  const html = render(withClips([remote]), { 'dev-2': "Sam's iPhone" });
  assert.ok(html.includes('Sam&#39;s iPhone'), 'the device name should be printed, escaped');
  assert.ok(!html.includes("Sam's iPhone"), 'the apostrophe must be escaped');
});

test('an unknown device degrades to the same wording the gallery uses', () => {
  const remote = clip({ isLocal: false, originDeviceId: 'never-seen' });
  // No map passed at all: a phone that has never synced the registry.
  assert.ok(render(withClips([remote])).includes('another device'));
  // Present but missing this id — the same outcome, not a crash or a raw UUID.
  assert.ok(render(withClips([remote]), { other: 'x' }).includes('another device'));
  assert.ok(!render(withClips([remote])).includes('never-seen'), 'a raw device id leaked');
});

test('a clip note still cannot inject markup', () => {
  const html = render(withClips([clip({ ictalNote: '<script>alert(1)</script>' })]));
  assert.ok(!html.includes('<script>'), 'a clip note escaped into markup');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('legacy clips are described, not left blank', () => {
  // Filmed before the app recorded how a video got in. It is still on the
  // phone, so saying nothing would be worse than saying the general truth.
  assert.match(
    clipLocation({ isLocal: true, source: 'legacy', originDeviceId: null }),
    /saved in the app on this phone/,
  );
});
