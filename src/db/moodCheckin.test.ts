/**
 * The mood tap on Home: one row per day, last tap wins, nothing else touched.
 *
 * ── WHY THESE THREE RULES NEED A TEST ─────────────────────────────────
 *
 * All three fail SILENTLY. A mood tap that quietly overwrites the appetite the
 * owner recorded this morning produces a plausible-looking check-in with a
 * wrong answer in it, and nothing anywhere reports a problem. The same goes
 * for a second row for the same day, which would double-count that day in the
 * control dataset the seizure analysis measures against.
 *
 * The statement under test is the ON CONFLICT clause in
 * checkinRepo.setEnergyForDate — copied here verbatim, because what makes it
 * correct is precisely which columns it does NOT list.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE daily_checkins (
      id            TEXT PRIMARY KEY NOT NULL,
      user_id       TEXT,
      dog_id        TEXT NOT NULL,
      timestamp     INTEGER NOT NULL,
      check_in_date TEXT NOT NULL DEFAULT '',
      sleep_hrs     REAL,
      appetite      TEXT NOT NULL DEFAULT 'normal',
      water         TEXT NOT NULL DEFAULT 'normal',
      energy        INTEGER NOT NULL DEFAULT 3,
      stress        INTEGER NOT NULL DEFAULT 2,
      med_on_time   INTEGER NOT NULL DEFAULT 1,
      gi            TEXT NOT NULL DEFAULT 'none',
      unusual       TEXT NOT NULL DEFAULT '',
      backfilled    INTEGER NOT NULL DEFAULT 0,
      mood_only     INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      deleted_at    INTEGER
    );
    CREATE UNIQUE INDEX idx_checkins_dog_date
      ON daily_checkins (dog_id, check_in_date);
  `);
  return db;
}

/** Byte-for-byte the statement in checkinRepo.setEnergyForDate. */
const SET_ENERGY = `INSERT INTO daily_checkins (
         id, user_id, dog_id, timestamp, check_in_date, energy,
         backfilled, mood_only, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,1,?,?)
       ON CONFLICT(dog_id, check_in_date) DO UPDATE SET
         energy     = excluded.energy,
         updated_at = excluded.updated_at,
         deleted_at = NULL
       RETURNING id`;

let seq = 0;
function tapMood(db: DatabaseSync, energy: number, now = ++seq + 1000): string {
  const row = db
    .prepare(SET_ENERGY)
    .get(`id_${++seq}`, 'user_a', 'dog1', now, '2026-08-28', energy, 0, now, now) as
    | { id: string }
    | undefined;
  return row?.id ?? '';
}

function dayRows(db: DatabaseSync) {
  return db
    .prepare("SELECT * FROM daily_checkins WHERE check_in_date = '2026-08-28'")
    .all() as Record<string, unknown>[];
}

/* ------------------------------------------------------------------ */
/* One row per day, last tap wins                                      */
/* ------------------------------------------------------------------ */

test('tapping a mood on a fresh day creates exactly one record', () => {
  const db = freshDb();
  tapMood(db, 4);

  const rows = dayRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.energy, 4);
  db.close();
});

test('tapping four different moods leaves ONE record holding the last', () => {
  const db = freshDb();
  tapMood(db, 1);
  tapMood(db, 5);
  tapMood(db, 2);
  tapMood(db, 4);

  const rows = dayRows(db);
  assert.equal(
    rows.length,
    1,
    'a second row for the same day would double-count it in the control dataset',
  );
  assert.equal(rows[0]?.energy, 4, 'the latest tap must win');
  db.close();
});

test('re-tapping keeps the row id stable', () => {
  const db = freshDb();
  const first = tapMood(db, 3);
  const second = tapMood(db, 5);

  assert.equal(
    first,
    second,
    'a changing id would orphan the outbox entry and push a row that does not exist',
  );
  db.close();
});

/* ------------------------------------------------------------------ */
/* Everything else is kept — the rule most likely to regress           */
/* ------------------------------------------------------------------ */

test('a mood tap does not disturb answers already recorded that day', () => {
  const db = freshDb();

  // The owner filled in the full form this morning.
  db.exec(`
    INSERT INTO daily_checkins
      (id, user_id, dog_id, timestamp, check_in_date, sleep_hrs, appetite,
       water, energy, stress, med_on_time, gi, unusual, backfilled, mood_only,
       created_at, updated_at)
    VALUES ('full1', 'user_a', 'dog1', 500, '2026-08-28', 9.5, 'decreased',
            'increased', 2, 5, 0, 'vomit', 'off her food', 0, 0, 500, 500);
  `);

  // This evening they tap a face on Home.
  tapMood(db, 4, 9000);

  const row = dayRows(db)[0]!;
  assert.equal(row.energy, 4, 'the mood should update');

  // Everything the owner actually answered must survive untouched.
  assert.equal(row.sleep_hrs, 9.5);
  assert.equal(row.appetite, 'decreased');
  assert.equal(row.water, 'increased');
  assert.equal(row.stress, 5, 'a fabricated stress of 2 here would skew analytics');
  assert.equal(row.med_on_time, 0);
  assert.equal(row.gi, 'vomit');
  assert.equal(row.unusual, 'off her food');
  db.close();
});

test('a mood tap does NOT flip a fully-answered day back to mood_only', () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO daily_checkins
      (id, user_id, dog_id, timestamp, check_in_date, energy, stress,
       backfilled, mood_only, created_at, updated_at)
    VALUES ('full1', 'user_a', 'dog1', 500, '2026-08-28', 2, 5, 0, 0, 500, 500);
  `);

  tapMood(db, 4, 9000);

  assert.equal(
    dayRows(db)[0]?.mood_only,
    0,
    'the day was genuinely described; a later tap must not mark it unanswered',
  );
  db.close();
});

test('the row a tap CREATES is marked mood_only', () => {
  const db = freshDb();
  tapMood(db, 4);

  assert.equal(
    dayRows(db)[0]?.mood_only,
    1,
    'without this flag the default stress of 2 enters stressAssociation as if ' +
      'the owner had rated it',
  );
  db.close();
});

test('a mood tap revives a day the owner had deleted', () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO daily_checkins
      (id, user_id, dog_id, timestamp, check_in_date, energy, backfilled,
       mood_only, created_at, updated_at, deleted_at)
    VALUES ('gone1', 'user_a', 'dog1', 500, '2026-08-28', 3, 0, 0, 500, 500, 700);
  `);

  tapMood(db, 5, 9000);

  const row = dayRows(db)[0]!;
  assert.equal(row.deleted_at, null, 'otherwise the mood they just set is invisible');
  assert.equal(row.energy, 5);
  db.close();
});

test('updated_at moves, so the change wins last-write-wins on another device', () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO daily_checkins
      (id, user_id, dog_id, timestamp, check_in_date, energy, backfilled,
       mood_only, created_at, updated_at)
    VALUES ('full1', 'user_a', 'dog1', 500, '2026-08-28', 2, 0, 0, 500, 500);
  `);

  tapMood(db, 4, 9000);

  assert.equal(
    dayRows(db)[0]?.updated_at,
    9000,
    'a stale updated_at would lose the mood to an older copy on another phone',
  );
  db.close();
});
