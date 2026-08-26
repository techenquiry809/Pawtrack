/**
 * Daily check-in repository.
 *
 * One check-in per dog per calendar day. Saving twice in a day updates the
 * existing row rather than creating a duplicate, so the control dataset stays
 * one-row-per-day for the analytics engine.
 */

import { getDb, uid, toSqlBool, fromSqlBool } from './client';
import { localDayKey } from '@/utils/time';
import type { DailyCheckin } from '@/types/domain';

type CheckinRow = {
  id: string;
  dog_id: string;
  timestamp: number;
  check_in_date: string;
  sleep_hrs: number | null;
  appetite: string;
  water: string;
  energy: number;
  stress: number;
  med_on_time: number;
  gi: string;
  backfilled: number;
  unusual: string;
  created_at: number;
  updated_at: number;
};

const rowToCheckin = (r: CheckinRow): DailyCheckin => ({
  id: r.id,
  dogId: r.dog_id,
  timestamp: r.timestamp,
  checkInDate: r.check_in_date,
  sleepHrs: r.sleep_hrs,
  appetite: r.appetite as DailyCheckin['appetite'],
  water: r.water as DailyCheckin['water'],
  energy: r.energy,
  stress: r.stress,
  medOnTime: fromSqlBool(r.med_on_time),
  gi: r.gi as DailyCheckin['gi'],
  backfilled: fromSqlBool(r.backfilled),
  unusual: r.unusual,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** The check-in for a given local day, or null. */
export async function getCheckinForDate(
  dogId: string,
  dayKey: string,
): Promise<DailyCheckin | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CheckinRow>(
    'SELECT * FROM daily_checkins WHERE dog_id = ? AND check_in_date = ?',
    [dogId, dayKey],
  );
  return row ? rowToCheckin(row) : null;
}

export async function getTodaysCheckin(dogId: string): Promise<DailyCheckin | null> {
  return getCheckinForDate(dogId, localDayKey());
}

export async function listCheckins(dogId: string): Promise<DailyCheckin[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CheckinRow>(
    'SELECT * FROM daily_checkins WHERE dog_id = ? ORDER BY timestamp DESC',
    [dogId],
  );
  return rows.map(rowToCheckin);
}

/**
 * What a screen supplies. `checkInDate` is deliberately absent: the day key is
 * derived here from the clock, so no caller can file a check-in under the
 * wrong day by passing a stale value.
 */
export type CheckinInput = Omit<
  DailyCheckin,
  'id' | 'dogId' | 'timestamp' | 'checkInDate' | 'backfilled' | 'createdAt' | 'updatedAt'
>;


/**
 * Writes the check-in for a specific local day, creating or updating it.
 *
 * A single INSERT ... ON CONFLICT, not a SELECT-then-branch. The old version
 * read first and then chose a path, which two rapid saves can race past — and
 * relying on app logic for a uniqueness rule is exactly what the unique index
 * added in migration 4 exists to stop. The database decides.
 *
 * `timestamp` is set to MIDDAY of the target day rather than the moment of
 * writing, so a backfilled entry sorts into the day it describes on the
 * timeline instead of appearing as though it happened today. When it was
 * actually typed is recorded separately in `updated_at`.
 */
export async function upsertCheckinForDate(
  dogId: string,
  dayKey: string,
  input: CheckinInput,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const today = localDayKey(now);

  if (dayKey > today) {
    // Not a validation nicety: a check-in about tomorrow is not a record of
    // anything, and would poison the control dataset.
    throw new Error('Cannot record a check-in for a future date.');
  }

  const backfilled = dayKey !== today;
  const timestamp = backfilled ? middayOf(dayKey) : now;

  await db.runAsync(
    `INSERT INTO daily_checkins (
       id, dog_id, timestamp, check_in_date, sleep_hrs, appetite, water,
       energy, stress, med_on_time, gi, unusual, backfilled, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(dog_id, check_in_date) DO UPDATE SET
       sleep_hrs   = excluded.sleep_hrs,
       appetite    = excluded.appetite,
       water       = excluded.water,
       energy      = excluded.energy,
       stress      = excluded.stress,
       med_on_time = excluded.med_on_time,
       gi          = excluded.gi,
       unusual     = excluded.unusual,
       -- Once backfilled, always backfilled: editing a recalled entry does not
       -- turn it into a same-day observation.
       backfilled  = MAX(daily_checkins.backfilled, excluded.backfilled),
       updated_at  = excluded.updated_at`,
    [
      uid(), dogId, timestamp, dayKey, input.sleepHrs, input.appetite,
      input.water, input.energy, input.stress, toSqlBool(input.medOnTime),
      input.gi, input.unusual, toSqlBool(backfilled), now, now,
    ],
  );
}

/** Local midday of a 'YYYY-MM-DD' key — safely inside the day on any DST shift. */
function middayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();
}

/** Convenience wrapper for the common case. */
export async function upsertTodaysCheckin(
  dogId: string,
  input: CheckinInput,
): Promise<void> {
  return upsertCheckinForDate(dogId, localDayKey(), input);
}
