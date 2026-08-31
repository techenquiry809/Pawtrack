/**
 * Sync bookkeeping: this device's identity, and how far it has read.
 *
 * Deliberately a different table from `app_state`.
 *
 * app_state holds preferences belonging to the PERSON using the phone — the
 * active dog, the settings blob. sync_state holds facts about the MACHINE:
 * its device id, and per-table cursors into the server's history. The
 * distinction matters at exactly one moment, and it is a moment that happens:
 * signing out clears the person, and must not clear the machine.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from './client';
import { SYNC_TABLE_NAMES } from './syncSchema';

const DEVICE_ID_KEY = 'device_id';

async function read(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

async function write(
  db: SQLiteDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/**
 * This install's stable id.
 *
 * Seeded by migration 9 in SQL, so it exists before any JS runs and no caller
 * can forget to create it. It identifies the PHONE, not the session: it
 * survives sign-out, survives switching accounts, and is what
 * `videos.origin_device_id` points at so a tile on another device can say
 * "Recorded on Sam's iPhone" instead of printing a UUID at the owner.
 *
 * It does NOT survive a reinstall, which is correct — a reinstalled app is a
 * new local store with no files in it, and pretending otherwise would leave
 * video rows claiming bytes that are gone.
 */
export async function getDeviceId(): Promise<string> {
  const db = await getDb();
  const existing = await read(db, DEVICE_ID_KEY);
  if (existing) return existing;

  // Migration 9 seeds this. Reaching here means a database that predates it or
  // one whose sync_state was cleared; regenerate rather than throwing, because
  // an app that will not start is a worse failure than a device that looks new.
  const { randomUUID } = await import('expo-crypto');
  const fresh = randomUUID();
  await write(db, DEVICE_ID_KEY, fresh);
  console.warn('[sync] device_id was missing; generated a new one');
  return fresh;
}

export async function getSyncValue(key: string): Promise<string | null> {
  const db = await getDb();
  return read(db, key);
}

export async function setSyncValue(key: string, value: string): Promise<void> {
  const db = await getDb();
  await write(db, key, value);
}

/* ------------------------------------------------------------------ */
/* Cursors                                                             */
/* ------------------------------------------------------------------ */
/**
 * How far into the server's history this device has read, per table.
 *
 * Per-device BY CONSTRUCTION: cursors live in local SQLite, so two devices
 * sitting at different points is the normal case rather than an error to
 * reconcile. That is the whole reason the cursor is a server-assigned sequence
 * number and not a timestamp — see the note on sync_seq_global in
 * supabase/migrations/20260828000100_core_schema.sql.
 */
export async function getCursor(tableName: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_seen_seq: number }>(
    'SELECT last_seen_seq FROM sync_cursors WHERE table_name = ?',
    [tableName],
  );
  return row?.last_seen_seq ?? 0;
}

export async function setCursor(
  tableName: string,
  seq: number,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_cursors (table_name, last_seen_seq, last_pulled_at)
     VALUES (?, ?, ?)
     ON CONFLICT(table_name) DO UPDATE SET
       -- Never move a cursor backwards. Two pulls can overlap on a slow
       -- network, and the later-finishing one may be carrying the older page.
       last_seen_seq  = MAX(sync_cursors.last_seen_seq, excluded.last_seen_seq),
       last_pulled_at = excluded.last_pulled_at`,
    [tableName, seq, now],
  );
}

/** The oldest cursor across all tables — compared against the purge horizon. */
export async function lowestCursor(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number | null }>(
    'SELECT MIN(last_seen_seq) AS n FROM sync_cursors',
  );
  // A table never pulled has no row at all, which is cursor 0.
  const rows = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM sync_cursors',
  );
  if ((rows?.c ?? 0) < SYNC_TABLE_NAMES.length) return 0;
  return row?.n ?? 0;
}

/** Wipe every cursor, forcing the next pull to start from the beginning. */
export async function resetCursors(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_cursors');
}
