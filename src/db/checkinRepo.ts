/**
 * Daily check-in repository.
 *
 * One check-in per dog per calendar day. Saving twice in a day updates the
 * existing row rather than creating a duplicate, so the control dataset stays
 * one-row-per-day for the analytics engine.
 */

import { getDb, uid, toSqlBool, fromSqlBool } from './client';
import { newRowOwner, ownerScope } from './scope';
import { enqueue } from './outbox';
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
  mood_only: number;
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
  moodOnly: fromSqlBool(r.mood_only),
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
  const owner = ownerScope();
  const row = await db.getFirstAsync<CheckinRow>(
    `SELECT * FROM daily_checkins_live
      WHERE dog_id = ? AND check_in_date = ? AND ${owner.sql}`,
    [dogId, dayKey, ...owner.params],
  );
  return row ? rowToCheckin(row) : null;
}

/**
 * Check-ins across an inclusive span of day keys, oldest first.
 *
 * Inclusive at both ends, unlike the seizure range: a day key IS the bucket, so
 * there is no midnight to fall on the wrong side of. `'2026-08-24'` through
 * `'2026-08-30'` is the seven days a week report names, and string comparison
 * on `YYYY-MM-DD` is the same ordering as date comparison.
 */
export async function listCheckinsBetween(
  dogId: string,
  fromKey: string,
  toKey: string,
): Promise<DailyCheckin[]> {
  const db = await getDb();
  const owner = ownerScope();
  const rows = await db.getAllAsync<CheckinRow>(
    `SELECT * FROM daily_checkins_live
      WHERE dog_id = ? AND check_in_date >= ? AND check_in_date <= ? AND ${owner.sql}
      ORDER BY check_in_date ASC`,
    [dogId, fromKey, toKey, ...owner.params],
  );
  return rows.map(rowToCheckin);
}

export async function getTodaysCheckin(dogId: string): Promise<DailyCheckin | null> {
  return getCheckinForDate(dogId, localDayKey());
}

export async function listCheckins(dogId: string): Promise<DailyCheckin[]> {
  const db = await getDb();
  const owner = ownerScope();
  const rows = await db.getAllAsync<CheckinRow>(
    `SELECT * FROM daily_checkins_live
      WHERE dog_id = ? AND ${owner.sql} ORDER BY timestamp DESC`,
    [dogId, ...owner.params],
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
  | 'id' | 'dogId' | 'timestamp' | 'checkInDate' | 'createdAt' | 'updatedAt'
  // Both are DERIVED here, never supplied by a screen. `backfilled` comes from
  // comparing the target day to today; `moodOnly` records how the row was
  // created. A caller that could set either could lie about both.
  | 'backfilled' | 'moodOnly'
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

  /**
   * RETURNING id is not decoration.
   *
   * This statement mints a fresh uid() every call, but ON CONFLICT means it
   * usually UPDATES a row that already has an id of its own. Queueing the
   * generated id would enqueue a row that does not exist — the outbox would
   * push nothing and the edit would never leave the phone. The database tells
   * us which row it actually wrote, and that is the one we queue.
   *
   * The unique index carries a `WHERE deleted_at IS NULL` predicate on the
   * server (a partial index, so a deleted day can be re-recorded later); the
   * local index from migration 4 is unconditional, which is stricter and
   * therefore safe — it just means a tombstoned check-in still reserves its
   * day locally until the tombstone is purged.
   */
  await db.withTransactionAsync(async () => {
    const written = await db.getFirstAsync<{ id: string }>(
      `INSERT INTO daily_checkins (
         id, user_id, dog_id, timestamp, check_in_date, sleep_hrs, appetite, water,
         energy, stress, med_on_time, gi, unusual, backfilled, mood_only,
         created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)
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
         -- The owner has now actually described this day, so the row stops
         -- being mood-only and rejoins the control dataset.
         mood_only   = 0,
         updated_at  = excluded.updated_at,
         -- An edit revives a day the owner had deleted. Without this the row
         -- stays tombstoned and the check-in they just typed is invisible.
         deleted_at  = NULL
       RETURNING id`,
      [
        uid(), newRowOwner(), dogId, timestamp, dayKey, input.sleepHrs,
        input.appetite, input.water, input.energy, input.stress,
        toSqlBool(input.medOnTime), input.gi, input.unusual,
        toSqlBool(backfilled), now, now,
      ],
    );

    if (written) await enqueue(db, 'daily_checkins', written.id, 'upsert', now);
  });
}

/**
 * Set the mood/energy for a day WITHOUT touching anything else on the row.
 *
 * ── WHY THIS IS NOT upsertCheckinForDate ──────────────────────────────
 *
 * That function writes the WHOLE row, because it is backing a form where the
 * owner answered every question. Calling it from a single tap on Home would
 * overwrite appetite, water, stress and GI with whatever the form's defaults
 * happen to be — silently discarding real answers the owner gave earlier in
 * the day.
 *
 * So the ON CONFLICT clause here updates exactly two columns. Everything else
 * on an existing row is left alone, which is the "keep everything else"
 * guarantee.
 *
 * ── ONE ROW PER DAY, LAST TAP WINS ────────────────────────────────────
 *
 * Enforced by the unique index on (dog_id, check_in_date), not by the caller
 * remembering. Tapping four faces in a row produces one record holding the
 * fourth — the same rule the check-in form has always followed.
 *
 * ── WHAT mood_only IS PROTECTING ──────────────────────────────────────
 *
 * When no row exists yet, this creates one, and the columns it cannot fill
 * honestly take their schema defaults — stress 2, appetite 'normal'. Those are
 * not observations; nobody stood behind them. `mood_only = 1` says so, and
 * stressAssociation in src/features/analytics skips such rows, so a tap can
 * never move a figure a vet might read.
 *
 * Saving the full form later flips the flag back to 0.
 */
export async function setEnergyForDate(
  dogId: string,
  dayKey: string,
  energy: number,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const today = localDayKey(now);

  if (dayKey > today) {
    throw new Error('Cannot record a mood for a future date.');
  }

  const backfilled = dayKey !== today;
  const timestamp = backfilled ? middayOf(dayKey) : now;

  await db.withTransactionAsync(async () => {
    const written = await db.getFirstAsync<{ id: string }>(
      `INSERT INTO daily_checkins (
         id, user_id, dog_id, timestamp, check_in_date, energy,
         backfilled, mood_only, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,1,?,?)
       ON CONFLICT(dog_id, check_in_date) DO UPDATE SET
         -- Deliberately ONLY these. Every other column on an existing row is
         -- an answer the owner gave, and a mood tap must not disturb it.
         energy     = excluded.energy,
         updated_at = excluded.updated_at,
         -- A tap revives a day the owner had deleted, same as the form does.
         deleted_at = NULL
       RETURNING id`,
      [
        uid(), newRowOwner(), dogId, timestamp, dayKey, energy,
        toSqlBool(backfilled), now, now,
      ],
    );

    if (written) await enqueue(db, 'daily_checkins', written.id, 'upsert', now);
  });
}

/** Convenience wrapper for the common case — the Home screen's mood row. */
export async function setTodaysEnergy(
  dogId: string,
  energy: number,
): Promise<void> {
  return setEnergyForDate(dogId, localDayKey(), energy);
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
