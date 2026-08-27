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

  {
    version: 4,
    name: 'check-in day key, medication reminders and dose log',
    up: async (db) => {
      /* ---------------- One check-in per dog per local day -------------
       * The old table keyed on `timestamp` and duplicates were prevented in
       * app code — a SELECT-then-UPDATE that two rapid saves can race past.
       * This moves the guarantee into the database.
       *
       * `check_in_date` is the LOCAL calendar day as 'YYYY-MM-DD'. Local, not
       * UTC: a check-in at 11pm belongs to the day the owner thinks it does.
       */
      await db.execAsync(`
        ALTER TABLE daily_checkins ADD COLUMN check_in_date TEXT NOT NULL DEFAULT '';
      `);

      // Backfill from the existing epoch column. SQLite's 'localtime' modifier
      // applies the device's current offset — right for every row an owner
      // actually recorded on the device they are holding.
      await db.execAsync(`
        UPDATE daily_checkins
           SET check_in_date = date(timestamp / 1000, 'unixepoch', 'localtime')
         WHERE check_in_date = '';
      `);

      // A unique index fails outright if duplicates already exist, so collapse
      // them first. Keep the most recently updated row for each day and drop
      // the rest — the newest edit is the one the owner last confirmed.
      await db.execAsync(`
        DELETE FROM daily_checkins
         WHERE id NOT IN (
           SELECT id FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY dog_id, check_in_date
                      ORDER BY updated_at DESC, created_at DESC, rowid DESC
                    ) AS rn
               FROM daily_checkins
           ) WHERE rn = 1
         );
      `);

      await db.execAsync(`
        CREATE UNIQUE INDEX idx_checkins_dog_date
          ON daily_checkins (dog_id, check_in_date);
      `);

      /* ---------------- Medication reminders ---------------------------
       * Their own table, not a column on `medications`. Dogs on
       * anticonvulsants are routinely dosed two or three times a day, so a
       * single nullable time column would need rebuilding immediately.
       *
       * NOTE: medications.scheduled_time and medications.notification_id are
       * now dead. They are deliberately left in place — a dead column costs
       * nothing, and DROP COLUMN on a shipped table is a real risk.
       */
      await db.execAsync(`
        CREATE TABLE medication_reminders (
          id              TEXT PRIMARY KEY NOT NULL,
          medication_id   TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
          -- Local wall-clock 'HH:MM', 24h. Stored as clock time, never as an
          -- instant, so 8am stays 8am after the owner changes timezone.
          time_hhmm       TEXT NOT NULL,
          enabled         INTEGER NOT NULL DEFAULT 1,
          -- Handle returned by expo-notifications, so we can cancel precisely.
          notification_id TEXT,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );
        CREATE INDEX idx_reminders_med ON medication_reminders(medication_id);
        -- The same time twice on one medication is always a mistake.
        CREATE UNIQUE INDEX idx_reminders_med_time
          ON medication_reminders (medication_id, time_hhmm);
      `);

      /* ---------------- Dose log ---------------------------------------
       * Records what actually happened, which is a different question from
       * what was prescribed. Feeds the check-in's "medication given on time?"
       * and the vet report.
       */
      await db.execAsync(`
        CREATE TABLE medication_doses (
          id             TEXT PRIMARY KEY NOT NULL,
          medication_id  TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
          dog_id         TEXT NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
          -- The local day this dose belonged to, so a late-night dose is not
          -- filed under tomorrow.
          dose_date      TEXT NOT NULL,
          -- The reminder time it corresponds to, or '' for an ad-hoc record.
          scheduled_hhmm TEXT NOT NULL DEFAULT '',
          -- 'given' | 'late' | 'missed'. Owner-reported, never inferred.
          status         TEXT NOT NULL,
          recorded_at    INTEGER NOT NULL,
          note           TEXT NOT NULL DEFAULT '',
          created_at     INTEGER NOT NULL
        );
        CREATE INDEX idx_doses_dog_date ON medication_doses(dog_id, dose_date DESC);
        -- One record per medication, per day, per scheduled time.
        CREATE UNIQUE INDEX idx_doses_unique
          ON medication_doses (medication_id, dose_date, scheduled_hhmm);
      `);
    },
  },

  {
    version: 5,
    name: 'dog photo',
    up: async (db) => {
      // Path inside the app's document directory, same rule as seizure videos:
      // the bytes live on disk, only the path goes in the database. An empty
      // string means no photo, which keeps the column NOT NULL and avoids a
      // three-state null/empty/set muddle in every consumer.
      await db.execAsync(`
        ALTER TABLE dogs ADD COLUMN photo_uri TEXT NOT NULL DEFAULT '';
      `);
    },
  },

  {
    version: 6,
    name: 'backfilled check-ins',
    up: async (db) => {
      // A check-in filled in days later, from memory, is not the same evidence
      // as one recorded that evening — and check-ins are the CONTROL DATASET
      // the pattern analysis measures seizure days against. Seizures already
      // carry `retrospective` for exactly this reason; this is its counterpart.
      //
      // Existing rows default to 0: every check-in written before this column
      // existed came from the same-day form, which is true.
      await db.execAsync(`
        ALTER TABLE daily_checkins ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },

  {
    version: 7,
    name: 'store file paths relative to the document directory',
    up: async (db) => {
      /**
       * Absolute paths embed the app container UUID, which iOS reassigns on
       * reinstall. Every stored photo and video reference written before this
       * migration points at a container that may no longer exist.
       *
       * Rewrite them to the portion after '/Documents/', which is stable.
       * '/Documents/' is 11 characters, so instr(...) + 11 lands on the first
       * character after it. Rows that never contained the marker are left
       * alone rather than mangled.
       */
      await db.execAsync(`
        UPDATE dogs
           SET photo_uri = substr(photo_uri, instr(photo_uri, '/Documents/') + 11)
         WHERE photo_uri <> '' AND instr(photo_uri, '/Documents/') > 0;

        UPDATE videos
           SET file_uri = substr(file_uri, instr(file_uri, '/Documents/') + 11)
         WHERE file_uri <> '' AND instr(file_uri, '/Documents/') > 0;
      `);
    },
  },
  {
    version: 8,
    name: 'video provenance, thumbnails and notes',
    up: async (db) => {
      /**
       * THE PROBLEM THIS FIXES
       *
       * `timestamp` was written as Date.now() at the moment a file entered the
       * app. For a video recorded live during a seizure that is correct to the
       * second. For a video the owner filmed last Tuesday on the normal camera
       * app and imported afterwards it is simply wrong — and nothing on the row
       * said which of the two it was.
       *
       * After this migration:
       *   timestamp          WHEN THE SEIZURE IN THE VIDEO HAPPENED
       *   imported_at        when the file entered the app
       *   capture_confidence how the app knows the timestamp
       *
       * capture_confidence is deliberately not defaulted to 'device' for every
       * existing row. Rows written by the import path never had a real capture
       * time, so they are backfilled 'unknown' rather than being dressed up as
       * measured. A gallery that shows an owner-typed date and a stopwatch date
       * identically is the same class of error as a repaired duration.
       */
      await db.execAsync(`
        ALTER TABLE videos ADD COLUMN imported_at INTEGER NOT NULL DEFAULT 0;
        UPDATE videos SET imported_at = timestamp WHERE imported_at = 0;

        ALTER TABLE videos
          ADD COLUMN capture_confidence TEXT NOT NULL DEFAULT 'device';
        UPDATE videos
           SET capture_confidence = 'unknown'
         WHERE source IN ('uploaded', 'legacy');

        -- Poster frame, extracted once at import and stored like any other
        -- app-owned file: RELATIVE to the document directory, never absolute.
        ALTER TABLE videos ADD COLUMN thumb_uri TEXT NOT NULL DEFAULT '';

        -- The gallery reads newest-first across a whole dog, not per seizure.
        CREATE INDEX idx_videos_timestamp ON videos(timestamp DESC);
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
