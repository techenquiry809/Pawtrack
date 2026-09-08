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
 * How far into the server's history this device has read, per ACCOUNT and
 * per table.
 *
 * Per-device BY CONSTRUCTION: cursors live in local SQLite, so two devices
 * sitting at different points is the normal case rather than an error to
 * reconcile. That is the whole reason the cursor is a server-assigned sequence
 * number and not a timestamp — see the note on sync_seq_global in
 * supabase/migrations/20260828000100_core_schema.sql.
 *
 * ── AND PER ACCOUNT, WHICH IS NOT OPTIONAL ────────────────────────────
 *
 * `sync_seq` comes from one GLOBAL sequence that every account writes into,
 * so a cursor is a position in a shared stream. Keyed on the table alone, the
 * position account A reached would be handed to account B on the same phone,
 * and B's pull would skip every row B wrote below it — silently, with the sync
 * reporting success. See migration 15 for the full account.
 *
 * `owner` is therefore required on every one of these, and comes from the
 * session the pull is authenticating with rather than from module state, for
 * the same reason `outbox.peek` takes one: it makes the scoping a fence rather
 * than a convention.
 */
export async function getCursor(
  owner: string,
  tableName: string,
): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_seen_seq: number }>(
    'SELECT last_seen_seq FROM sync_cursors WHERE user_id = ? AND table_name = ?',
    [owner, tableName],
  );
  // No row means this account has never pulled this table on this device, and
  // 0 is the correct answer: read the server's history from the beginning.
  return row?.last_seen_seq ?? 0;
}

export async function setCursor(
  owner: string,
  tableName: string,
  seq: number,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_cursors (user_id, table_name, last_seen_seq, last_pulled_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, table_name) DO UPDATE SET
       -- Never move a cursor backwards. Two pulls can overlap on a slow
       -- network, and the later-finishing one may be carrying the older page.
       last_seen_seq  = MAX(sync_cursors.last_seen_seq, excluded.last_seen_seq),
       last_pulled_at = excluded.last_pulled_at`,
    [owner, tableName, seq, now],
  );
}

/**
 * The oldest cursor across all tables FOR ONE ACCOUNT — compared against the
 * purge horizon.
 *
 * Scoped to the account for the same reason the cursors are: another account's
 * position says nothing about whether THIS one has fallen behind the server's
 * tombstone purge, and mixing them in would trigger a full resync for a user
 * who does not need one, or skip it for a user who does.
 */
export async function lowestCursor(owner: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number | null }>(
    'SELECT MIN(last_seen_seq) AS n FROM sync_cursors WHERE user_id = ?',
    [owner],
  );
  // A table never pulled has no row at all, which is cursor 0.
  const rows = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM sync_cursors WHERE user_id = ?',
    [owner],
  );
  if ((rows?.c ?? 0) < SYNC_TABLE_NAMES.length) return 0;
  return row?.n ?? 0;
}

/**
 * Wipe every cursor on the device, forcing the next pull to start over.
 *
 * Deliberately NOT account-scoped: the two callers are the tombstone-horizon
 * resync and "remove this account's data from this phone", and both are about
 * the device's local store as a whole.
 */
export async function resetCursors(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_cursors');
}

/** Forget one account's position, so its next pull re-reads from the start. */
export async function resetCursorsForUser(owner: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_cursors WHERE user_id = ?', [owner]);
}

/**
 * Drop any cursor that cannot be attributed to an account, on sign-in.
 *
 * Migration 15 clears the pre-fix rows, so on a database that migrated cleanly
 * this finds nothing and costs one indexed DELETE. It exists for the database
 * that did NOT: a restored backup, a partially-applied upgrade, or any future
 * write that forgets to pass an owner. An unattributed cursor is the exact
 * shape of the bug migration 15 exists to end, and the cheapest correct
 * response to finding one is to throw it away — a re-pull is idempotent, a
 * skipped seizure is not.
 *
 * NOT a blanket `resetCursors()` on every sign-in. That would force a full
 * re-read of the entire account history each time anyone signed in, including
 * the ordinary single-account case, to defend against a state the composite
 * primary key already makes unreachable.
 */
export async function dropUnownedCursors(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `DELETE FROM sync_cursors WHERE user_id IS NULL OR user_id = ''`,
  );
  return result.changes ?? 0;
}
