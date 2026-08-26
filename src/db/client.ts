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
    dbPromise = SQLite.openDatabaseAsync(DB_NAME)
      .then(async (db) => {
        await runMigrations(db);
        return db;
      })
      .catch((error) => {
        // Do not leave a rejected promise cached: every later getDb() would
        // reuse it and fail forever, even if the original problem was
        // transient. Clearing the handle lets a retry actually retry.
        dbPromise = null;
        throw error;
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

/**
 * Reads a stored JSON OBJECT and guarantees every key is present.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * `fromSqlJson` returns whatever parsed. `'{}'` is perfectly valid JSON, so it
 * comes back as `{}` and every field on it is `undefined` — which is how
 * `dog.emergencyVet.phone.trim()` threw "Cannot read property 'trim' of
 * undefined" on the More screen.
 *
 * That is not an exotic case: `'{}'` is the COLUMN DEFAULT for vet_json,
 * emergency_vet_json, emergency_plan_json and context_json, so any row written
 * without those columns — a migration, a restore, a partial import — produces
 * an object that looks fine to TypeScript and explodes at the first property
 * read.
 *
 * Merging onto a complete default makes a partial object impossible.
 */
export function fromSqlObject<T extends object>(
  value: string | null,
  defaults: T,
): T {
  const raw = fromSqlJson<Partial<T> | null>(value, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...defaults };
  return { ...defaults, ...raw };
}

/**
 * Reads a stored JSON ARRAY, falling back when the value is not one.
 *
 * Same failure mode as above in reverse: a column holding `'{}'` typed as
 * `string[]` survives compilation and throws on the first `.slice()`.
 */
export function fromSqlArray<T>(value: string | null): T[] {
  const raw = fromSqlJson<unknown>(value, null);
  return Array.isArray(raw) ? (raw as T[]) : [];
}

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
