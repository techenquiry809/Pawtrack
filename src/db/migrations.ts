/**
 * Database migrations.
 *
 * WHY SQLITE INSTEAD OF THE OLD SINGLE-JSON-BLOB?
 * The web prototype stored everything as one JSON string. That is fine at toy
 * scale but has three problems for a real health app:
 *   1. Every save rewrites the entire dataset — risk of losing everything on a
 *      partial write.
 *   2. No way to query ("seizures in the last 30 days") without loading all.
 *   3. No safe path to add multi-caregiver sync later.
 * SQLite fixes all three and ships with Expo.
 *
 * HOW MIGRATIONS WORK HERE
 * SQLite has a built-in `user_version` integer. We use it as our schema
 * version number. On launch we read it, then run every migration newer than it
 * in order, inside a transaction. Never edit a migration that has already
 * shipped — add a new one. Editing shipped migrations corrupts existing users.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

type Migration = {
  version: number;
  name: string;
  up: (db: SQLiteDatabase) => Promise<void>;
};

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE dogs (
          id                TEXT PRIMARY KEY NOT NULL,
          name              TEXT NOT NULL,
          breed_id          TEXT,
          breed_name        TEXT NOT NULL DEFAULT '',
          breed_source      TEXT NOT NULL DEFAULT '',
          breed_user_desc   TEXT NOT NULL DEFAULT '',
          sex               TEXT NOT NULL DEFAULT '',
          age_years         REAL,
          weight_kg         REAL,
          dob               TEXT NOT NULL DEFAULT '',
          diagnosis_status  TEXT NOT NULL DEFAULT 'undiagnosed',
          first_seizure_date TEXT NOT NULL DEFAULT '',
          seizure_type      TEXT NOT NULL DEFAULT '',
          allergies         TEXT NOT NULL DEFAULT '',
          diet              TEXT NOT NULL DEFAULT '',
          vet_json          TEXT NOT NULL DEFAULT '{}',
          emergency_vet_json TEXT NOT NULL DEFAULT '{}',
          emergency_plan_json TEXT NOT NULL DEFAULT '{}',
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );

        CREATE TABLE seizures (
          id                TEXT PRIMARY KEY NOT NULL,
          dog_id            TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
          start             INTEGER NOT NULL,
          end               INTEGER,
          duration_sec      INTEGER NOT NULL DEFAULT 0,
          timing_confidence TEXT NOT NULL DEFAULT 'exact',
          retrospective     INTEGER NOT NULL DEFAULT 0,
          pre_ictal_obs     TEXT NOT NULL DEFAULT '[]',
          pre_ictal_note    TEXT NOT NULL DEFAULT '',
          ictal_obs         TEXT NOT NULL DEFAULT '[]',
          awareness         TEXT,
          autonomic         TEXT NOT NULL DEFAULT '[]',
          position          TEXT,
          post_behavior     TEXT NOT NULL DEFAULT '[]',
          severity_owner    TEXT,
          recovery_start    INTEGER,
          recovery_end      INTEGER,
          recovery_sec      INTEGER,
          context_json      TEXT NOT NULL DEFAULT '{}',
          notes             TEXT NOT NULL DEFAULT '',
          time_since_prev_sec INTEGER,
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );
        -- History and analytics both query by dog + recency constantly.
        CREATE INDEX idx_seizures_dog_start ON seizures(dog_id, start DESC);

        CREATE TABLE videos (
          id           TEXT PRIMARY KEY NOT NULL,
          seizure_id   TEXT NOT NULL REFERENCES seizures(id) ON DELETE CASCADE,
          source       TEXT NOT NULL,
          file_uri     TEXT NOT NULL,
          timestamp    INTEGER NOT NULL,
          duration_sec INTEGER,
          note         TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX idx_videos_seizure ON videos(seizure_id);

        CREATE TABLE medications (
          id              TEXT PRIMARY KEY NOT NULL,
          dog_id          TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
          name            TEXT NOT NULL,
          dose            TEXT NOT NULL DEFAULT '',
          unit            TEXT NOT NULL DEFAULT '',
          frequency       TEXT NOT NULL DEFAULT '',
          scheduled_time  TEXT NOT NULL DEFAULT '',
          prescriber      TEXT NOT NULL DEFAULT '',
          notification_id TEXT,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );
        CREATE INDEX idx_medications_dog ON medications(dog_id);

        CREATE TABLE daily_checkins (
          id          TEXT PRIMARY KEY NOT NULL,
          dog_id      TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
          timestamp   INTEGER NOT NULL,
          sleep_hrs   REAL,
          appetite    TEXT NOT NULL DEFAULT 'normal',
          water       TEXT NOT NULL DEFAULT 'normal',
          energy      INTEGER NOT NULL DEFAULT 3,
          stress      INTEGER NOT NULL DEFAULT 2,
          med_on_time INTEGER NOT NULL DEFAULT 1,
          gi          TEXT NOT NULL DEFAULT 'none',
          unusual     TEXT NOT NULL DEFAULT '',
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        CREATE INDEX idx_checkins_dog_ts ON daily_checkins(dog_id, timestamp DESC);

        CREATE TABLE meals (
          id          TEXT PRIMARY KEY NOT NULL,
          dog_id      TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
          timestamp   INTEGER NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          is_new_food INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL
        );
        CREATE INDEX idx_meals_dog_ts ON meals(dog_id, timestamp DESC);

        -- Simple key/value for app settings and the active dog selection.
        CREATE TABLE app_state (
          key   TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
    },
  },

  {
    version: 2,
    name: 'seizure edit audit trail',
    up: async (db) => {
      // The original spec asked for at minimum created_at/updated_at (already
      // present) and ideally a change log. This gives us the change log
      // without touching the seizures table itself.
      await db.execAsync(`
        CREATE TABLE seizure_edits (
          id          TEXT PRIMARY KEY NOT NULL,
          seizure_id  TEXT NOT NULL REFERENCES seizures(id) ON DELETE CASCADE,
          edited_at   INTEGER NOT NULL,
          summary     TEXT NOT NULL
        );
        CREATE INDEX idx_seizure_edits ON seizure_edits(seizure_id, edited_at DESC);
      `);
    },
  },

  {
    version: 3,
    name: 'seizure record durability',
    up: async (db) => {
      // Makes SQLite the source of truth from the first tap, so a force-quit
      // or OS memory kill mid-seizure cannot lose the record.
      //
      // DEFAULT 'complete' on status is what backfills existing rows
      // correctly: every row that already exists was written by the old
      // finalize-only path, so it is by definition finished. Get this wrong
      // and every historical seizure disappears from history.
      await db.execAsync(`
        -- Lifecycle of the RECORD, not a clinical field.
        --   in_progress : row exists, seizure is being captured right now
        --   complete    : owner finished the flow; safe for history + exports
        --   abandoned   : owner explicitly discarded it
        ALTER TABLE seizures ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';

        -- How far duration_sec on this row can be trusted.
        --   high            : monotonic and wall clocks agreed
        --   clock_corrected : they disagreed; the monotonic value was used
        --   recovered       : reconstructed after a crash; end time is an estimate
        --   unreliable      : could not be derived; duration_sec is 0/NULL
        --   legacy          : written before this migration existed
        ALTER TABLE seizures
          ADD COLUMN duration_confidence TEXT NOT NULL DEFAULT 'legacy';

        -- Updated on every phase transition. After a crash this is our best
        -- estimate of when capture actually stopped — far better than "now",
        -- which would report a 6-hour seizure if the owner finds the orphaned
        -- row the next morning.
        ALTER TABLE seizures ADD COLUMN last_touched_at INTEGER;

        -- Minutes ahead of UTC at the moment of capture, so a past record
        -- still renders in the timezone it happened in after the owner travels.
        ALTER TABLE seizures ADD COLUMN tz_offset_min INTEGER;

        -- Supports the two hot queries: the orphan lookup on launch, and every
        -- history/analytics query, which must now filter out partial rows.
        CREATE INDEX IF NOT EXISTS idx_seizures_status_start
          ON seizures (status, start DESC);
      `);
    },
  },
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  // Foreign keys are OFF by default in SQLite — turn them on so our
  // ON DELETE CASCADE rules actually fire.
  await db.execAsync('PRAGMA foreign_keys = ON;');
  // WAL mode: better concurrency and far more crash-resistant writes, which
  // matters when the app may be force-quit mid-seizure.
  await db.execAsync('PRAGMA journal_mode = WAL;');

  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const current = row?.user_version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    await db.withTransactionAsync(async () => {
      await migration.up(db);
      // The version bump MUST be inside the same transaction as the schema
      // change. If it were written afterwards and the app died in between,
      // the next launch would replay the migration against tables that
      // already exist and the app would fail to start, permanently.
      //
      // PRAGMA cannot be parameterised, and the value is an integer literal
      // from our own code, so interpolation is safe here.
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

export const LATEST_SCHEMA_VERSION =
  migrations[migrations.length - 1]?.version ?? 0;
