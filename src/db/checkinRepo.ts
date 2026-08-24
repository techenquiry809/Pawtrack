/**
 * Daily check-in repository.
 *
 * One check-in per dog per calendar day. Saving twice in a day updates the
 * existing row rather than creating a duplicate, so the control dataset stays
 * one-row-per-day for the analytics engine.
 */

import { getDb, uid, toSqlBool, fromSqlBool } from './client';
import { startOfDay, DAY_MS } from '@/utils/time';
import type { DailyCheckin } from '@/types/domain';

type CheckinRow = {
  id: string;
  dog_id: string;
  timestamp: number;
  sleep_hrs: number | null;
  appetite: string;
  water: string;
  energy: number;
  stress: number;
  med_on_time: number;
  gi: string;
  unusual: string;
  created_at: number;
  updated_at: number;
};

const rowToCheckin = (r: CheckinRow): DailyCheckin => ({
  id: r.id,
  dogId: r.dog_id,
  timestamp: r.timestamp,
  sleepHrs: r.sleep_hrs,
  appetite: r.appetite as DailyCheckin['appetite'],
  water: r.water as DailyCheckin['water'],
  energy: r.energy,
  stress: r.stress,
  medOnTime: fromSqlBool(r.med_on_time),
  gi: r.gi as DailyCheckin['gi'],
  unusual: r.unusual,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getTodaysCheckin(dogId: string): Promise<DailyCheckin | null> {
  const db = await getDb();
  const dayStart = startOfDay(Date.now());
  const row = await db.getFirstAsync<CheckinRow>(
    'SELECT * FROM daily_checkins WHERE dog_id = ? AND timestamp >= ? AND timestamp < ? LIMIT 1',
    [dogId, dayStart, dayStart + DAY_MS],
  );
  return row ? rowToCheckin(row) : null;
}

export async function listCheckins(dogId: string): Promise<DailyCheckin[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CheckinRow>(
    'SELECT * FROM daily_checkins WHERE dog_id = ? ORDER BY timestamp DESC',
    [dogId],
  );
  return rows.map(rowToCheckin);
}

export type CheckinInput = Omit<
  DailyCheckin,
  'id' | 'dogId' | 'timestamp' | 'createdAt' | 'updatedAt'
>;

/** Creates today's check-in, or updates it if one already exists. */
export async function upsertTodaysCheckin(
  dogId: string,
  input: CheckinInput,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const existing = await getTodaysCheckin(dogId);

  if (existing) {
    await db.runAsync(
      `UPDATE daily_checkins SET sleep_hrs=?, appetite=?, water=?, energy=?,
       stress=?, med_on_time=?, gi=?, unusual=?, updated_at=? WHERE id=?`,
      [
        input.sleepHrs, input.appetite, input.water, input.energy,
        input.stress, toSqlBool(input.medOnTime), input.gi, input.unusual,
        now, existing.id,
      ],
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO daily_checkins (
      id, dog_id, timestamp, sleep_hrs, appetite, water, energy, stress,
      med_on_time, gi, unusual, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uid(), dogId, now, input.sleepHrs, input.appetite, input.water,
      input.energy, input.stress, toSqlBool(input.medOnTime), input.gi,
      input.unusual, now, now,
    ],
  );
}
