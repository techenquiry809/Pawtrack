/**
 * Database connection.
 *
 * One shared connection for the whole app, opened once and reused. Screens
 * never touch this directly — they go through the repositories in
 * src/db/repositories/. That separation is what keeps SQL out of components.
 */

import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

const DB_NAME = 'paws-journal.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await runMigrations(db);
      return db;
    });
  }
  return dbPromise;
}

/** Test/debug helper — forces the next getDb() to reopen and re-migrate. */
export function resetDbHandle(): void {
  dbPromise = null;
}

/* ------------------------------------------------------------------ */
/* Mapping helpers                                                     */
/* ------------------------------------------------------------------ */
/**
 * SQLite has no boolean or array type. We store booleans as 0/1 and arrays as
 * JSON strings. These helpers keep that conversion in one place so a mistake
 * can't quietly differ between repositories.
 */

export const toSqlBool = (value: boolean): number => (value ? 1 : 0);
export const fromSqlBool = (value: number | null): boolean => value === 1;

export const toSqlJson = (value: unknown): string => JSON.stringify(value ?? null);

export function fromSqlJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    // Corrupt JSON in a health record is worth knowing about, but must not
    // crash the app mid-seizure. Fall back and keep going.
    console.warn('[db] Could not parse stored JSON, using fallback.');
    return fallback;
  }
}

/** Collision-resistant enough for a local-only, single-device dataset. */
export function uid(): string {
  return (
    'id_' +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36)
  );
}
