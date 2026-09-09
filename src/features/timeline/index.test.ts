/**
 * What the merged feed is allowed to say about a check-in.
 *
 * These guard bugs that were shipped, not hypotheticals:
 *
 *   - a check-in filled in for a past day printed "12:00 pm", because the
 *     midday sorting sentinel written by checkinRepo.upsertCheckinForDate was
 *     rendered as though it were an observed clock time
 *   - a single tap on Home produced a feed line identical to a fully answered
 *     day, so the two were indistinguishable in the record an owner shows a vet
 *   - the free-text note — the only field in the owner's own words — never
 *     reached the feed at all
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildEvents, groupByDay } from './index.ts';
import type { DailyCheckin, MedicationDose, Seizure } from '../../types/domain.ts';

const ALL = { seizure: true, medication: true, checkin: true };

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m, d, h, min, 0, 0).getTime();

/** A fully answered day, with every field at the value the form's defaults use. */
function checkin(over: Partial<DailyCheckin> = {}): DailyCheckin {
  return {
    id: 'c1',
    dogId: 'dog1',
    timestamp: at(2026, 8, 9, 16, 4),
    checkInDate: '2026-09-09',
    sleepHrs: null,
    appetite: 'normal',
    water: 'normal',
    energy: 4,
    stress: 2,
    medOnTime: true,
    gi: 'none',
    backfilled: false,
    moodOnly: false,
    unusual: '',
    createdAt: at(2026, 8, 9, 16, 4),
    updatedAt: at(2026, 8, 9, 16, 4),
    ...over,
  };
}

const only = (checkins: DailyCheckin[]) =>
  buildEvents({ seizures: [], doses: [], checkins, include: ALL });

test('a same-day check-in keeps its clock time and carries no "filled in later"', () => {
  const [e] = only([checkin()]);
  assert.equal(e?.showTime, true);
  assert.equal(e?.retrospective, false);
});

test('a backfilled check-in never offers its midday sentinel as a time', () => {
  // What upsertCheckinForDate writes for a recalled day: local midday of the
  // day being described, so it sorts correctly. Not an observation.
  const [e] = only([
    checkin({ backfilled: true, timestamp: at(2026, 8, 7, 12), checkInDate: '2026-09-07' }),
  ]);
  assert.equal(e?.showTime, false, 'midday is a sorting key, not a clock reading');
  assert.equal(e?.retrospective, true, 'the row must still say the day was recalled');
});

test('a backfilled check-in is still grouped under the day it describes', () => {
  const events = only([
    checkin({ backfilled: true, timestamp: at(2026, 8, 7, 12), checkInDate: '2026-09-07' }),
  ]);
  const [section] = groupByDay(events, () => 'day');
  assert.equal(section?.day, at(2026, 8, 7, 0, 0));
});

test('a mood-only row says so, and never reads like an answered day', () => {
  const tapped = only([checkin({ moodOnly: true, energy: 3 })])[0];
  const answered = only([checkin({ energy: 3 })])[0];

  assert.match(tapped!.detail, /mood only/i);
  assert.notEqual(
    tapped!.detail,
    answered!.detail,
    'a single tap and a fully answered day must not produce the same line',
  );
});

test('a mood-only row reports no observation but its energy', () => {
  // Every other column on such a row is a schema default nobody answered.
  const [e] = only([checkin({ moodOnly: true, energy: 2 })]);
  assert.match(e!.detail, /Energy 2\/5/);
  for (const invented of ['appetite', 'water', 'stress', 'sleep', 'medication']) {
    assert.doesNotMatch(e!.detail, new RegExp(invented, 'i'), `invented "${invented}"`);
  }
});

test('an answered day reports stress and the free-text note', () => {
  const [e] = only([
    checkin({ stress: 5, sleepHrs: 7.5, unusual: 'Wobbly after her walk' }),
  ]);
  assert.match(e!.detail, /7\.5h sleep/);
  assert.match(e!.detail, /energy 4\/5/);
  assert.match(e!.detail, /stress 5\/5/);
  assert.match(e!.detail, /Wobbly after her walk/);
});

test('a long note is cut rather than allowed to push the facts off the row', () => {
  const note = 'x'.repeat(200);
  const [e] = only([checkin({ unusual: note })]);
  assert.ok(e!.detail.length < 140, `line ran to ${e!.detail.length} characters`);
  assert.match(e!.detail, /…/);
});

test('an empty note adds nothing — no stray quotes, no trailing separator', () => {
  const [e] = only([checkin({ unusual: '   ' })]);
  assert.doesNotMatch(e!.detail, /[“”]/);
  assert.doesNotMatch(e!.detail, /·\s*$/);
});

test('doses always show a time; an untimed seizure never does', () => {
  const dose: MedicationDose & { medicationName: string } = {
    id: 'd1',
    dogId: 'dog1',
    medicationId: 'm1',
    medicationName: 'Keppra',
    scheduledFor: at(2026, 8, 9, 8),
    recordedAt: at(2026, 8, 9, 8, 3),
    status: 'given',
    createdAt: at(2026, 8, 9, 8, 3),
    updatedAt: at(2026, 8, 9, 8, 3),
  } as MedicationDose & { medicationName: string };

  const seizure = {
    id: 's1',
    dogId: 'dog1',
    start: at(2026, 8, 9, 0),
    ictalObs: [],
    timingConfidence: 'unknown',
    retrospective: true,
  } as unknown as Seizure;

  const events = buildEvents({
    seizures: [seizure],
    doses: [dose],
    checkins: [],
    include: ALL,
  });

  assert.equal(events.find((e) => e.kind === 'medication')?.showTime, true);
  assert.equal(events.find((e) => e.kind === 'seizure')?.showTime, false);
});
