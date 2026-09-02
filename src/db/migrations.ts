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

  {
    version: 9,
    name: 'sync: ownership, tombstones, outbox and local file split',
    up: async (db) => {
      /**
       * Everything this app needs to become multi-device, and nothing that
       * changes how it behaves offline. After this migration the app still
       * runs exactly as before — no screen reads any of these columns yet.
       *
       * FOUR THINGS THE SYNC SPEC ASSUMED WERE ALREADY HERE, AND WERE NOT:
       *
       *  1. `updated_at` on videos, meals, seizure_edits and medication_doses.
       *     Last-write-wins compares updated_at. Those four tables never had
       *     one — videos has no row-mutation timestamp at all, only the
       *     clinical `timestamp` and `imported_at`. Without this, conflict
       *     resolution on a video edit has nothing to compare and the newer
       *     row loses at random.
       *
       *  2. `dog_id` on videos, seizure_edits and medication_reminders. They
       *     reach their dog only through a parent. Denormalising it is what
       *     lets a tombstone cascade and an RLS policy address a row directly,
       *     and it is the column a future dog_members join has to key on.
       *
       *  3. `origin_device_id` on videos, which the "recorded on another
       *     device" tile needs and which nothing was writing.
       *
       *  4. Tombstones do not cascade. SQLite's ON DELETE CASCADE fires on a
       *     real DELETE; once a parent is only marked deleted_at, its children
       *     stay live and sync to other devices as orphans. The columns are
       *     added here; src/db/tombstone.ts is what walks the subtree.
       */

      /* ---------------- Ownership -------------------------------------
       * Nullable on purpose. Every row written before the user signed in has
       * no owner, and claiming them is a decision the OWNER makes at first
       * login — see claimLocalData() in src/services/sync/claim.ts. A NOT NULL
       * default would silently assign a stranger's records to whoever signs in
       * on this phone next.
       */
      await db.execAsync(`
        ALTER TABLE dogs                 ADD COLUMN user_id TEXT;
        ALTER TABLE seizures             ADD COLUMN user_id TEXT;
        ALTER TABLE videos               ADD COLUMN user_id TEXT;
        ALTER TABLE seizure_edits        ADD COLUMN user_id TEXT;
        ALTER TABLE medications          ADD COLUMN user_id TEXT;
        ALTER TABLE medication_reminders ADD COLUMN user_id TEXT;
        ALTER TABLE medication_doses     ADD COLUMN user_id TEXT;
        ALTER TABLE daily_checkins       ADD COLUMN user_id TEXT;
        ALTER TABLE meals                ADD COLUMN user_id TEXT;
      `);

      /* ---------------- Tombstones ------------------------------------
       * A hard DELETE cannot be replicated: the next pull from a device that
       * had not heard about it would helpfully restore the row. Every delete
       * becomes an UPDATE from here on.
       */
      await db.execAsync(`
        ALTER TABLE dogs                 ADD COLUMN deleted_at INTEGER;
        ALTER TABLE seizures             ADD COLUMN deleted_at INTEGER;
        ALTER TABLE videos               ADD COLUMN deleted_at INTEGER;
        ALTER TABLE seizure_edits        ADD COLUMN deleted_at INTEGER;
        ALTER TABLE medications          ADD COLUMN deleted_at INTEGER;
        ALTER TABLE medication_reminders ADD COLUMN deleted_at INTEGER;
        ALTER TABLE medication_doses     ADD COLUMN deleted_at INTEGER;
        ALTER TABLE daily_checkins       ADD COLUMN deleted_at INTEGER;
        ALTER TABLE meals                ADD COLUMN deleted_at INTEGER;
      `);

      /* ---------------- The missing updated_at columns -----------------
       * Backfilled from the most honest value each table already has, so a
       * pre-existing row does not arrive at the server looking like it was
       * written at the epoch and lose every conflict.
       */
      await db.execAsync(`
        ALTER TABLE videos           ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
        UPDATE videos           SET updated_at = MAX(COALESCE(imported_at, 0), timestamp)
                                WHERE updated_at = 0;

        ALTER TABLE videos           ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
        UPDATE videos           SET created_at = COALESCE(NULLIF(imported_at, 0), timestamp)
                                WHERE created_at = 0;

        ALTER TABLE meals            ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
        UPDATE meals            SET updated_at = created_at  WHERE updated_at = 0;

        ALTER TABLE seizure_edits    ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
        UPDATE seizure_edits    SET updated_at = edited_at   WHERE updated_at = 0;

        ALTER TABLE medication_doses ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
        UPDATE medication_doses SET updated_at = recorded_at WHERE updated_at = 0;
      `);

      /* ---------------- Denormalised dog_id ----------------------------
       * Backfilled through the parent each table already points at. A row
       * whose parent is missing keeps NULL and is skipped by the push, which
       * is correct: an orphan has no owner to file it under.
       */
      await db.execAsync(`
        ALTER TABLE videos               ADD COLUMN dog_id TEXT;
        UPDATE videos
           SET dog_id = (SELECT s.dog_id FROM seizures s WHERE s.id = videos.seizure_id);

        ALTER TABLE seizure_edits        ADD COLUMN dog_id TEXT;
        UPDATE seizure_edits
           SET dog_id = (SELECT s.dog_id FROM seizures s WHERE s.id = seizure_edits.seizure_id);

        ALTER TABLE medication_reminders ADD COLUMN dog_id TEXT;
        UPDATE medication_reminders
           SET dog_id = (SELECT m.dog_id FROM medications m
                          WHERE m.id = medication_reminders.medication_id);
      `);

      /* ---------------- Video provenance -------------------------------
       * Which physical phone recorded this. NULL on every existing row and
       * that is honest: those were filmed before the app tracked devices, and
       * guessing "this one" would be wrong for anyone restoring a backup.
       */
      await db.execAsync(`
        ALTER TABLE videos ADD COLUMN origin_device_id TEXT;
      `);

      /* ---------------- Where this device is in the server's history ---- */
      await db.execAsync(`
        CREATE TABLE sync_cursors (
          table_name     TEXT PRIMARY KEY NOT NULL,
          last_seen_seq  INTEGER NOT NULL DEFAULT 0,
          last_pulled_at INTEGER
        );
      `);

      /* ---------------- The outbox -------------------------------------
       * Local writes append here inside the SAME transaction as the row write;
       * the sync worker drains it. If those two could diverge we would lose
       * writes, which on this dataset means losing seizures.
       */
      await db.execAsync(`
        CREATE TABLE outbox (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name  TEXT NOT NULL,
          row_id      TEXT NOT NULL,
          op          TEXT NOT NULL CHECK (op IN ('upsert','delete')),
          queued_at   INTEGER NOT NULL,
          attempts    INTEGER NOT NULL DEFAULT 0,
          last_error  TEXT
        );
        -- One pending intent per row: re-editing a seizure five times before
        -- the phone finds signal should push once, not five times. The write
        -- side is an UPSERT where 'delete' outranks 'upsert' — see
        -- src/db/outbox.ts. A plain INSERT here would throw on the second
        -- edit, and naive conflict-ignore would drop deletes.
        CREATE UNIQUE INDEX idx_outbox_row ON outbox(table_name, row_id);
        CREATE INDEX idx_outbox_drain ON outbox(id);
      `);

      /* ---------------- Local file locations ---------------------------
       * NEVER SYNCED.
       *
       * The video ROW is clinical data — "a recording exists for this seizure"
       * is meaningful to a vet on any device — so it syncs. The BYTES are
       * local, so the paths must not: a file:// uri from device A resolves to
       * nothing on device B, and iOS reassigns the container UUID anyway (see
       * src/services/fileStore.ts).
       *
       * A video is present on this device IFF a row exists here. That is the
       * whole test.
       */
      await db.execAsync(`
        CREATE TABLE video_files (
          video_id  TEXT PRIMARY KEY NOT NULL,
          file_uri  TEXT NOT NULL,
          thumb_uri TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO video_files (video_id, file_uri, thumb_uri)
          SELECT id, file_uri, COALESCE(thumb_uri, '') FROM videos;
      `);

      /**
       * videos.file_uri and videos.thumb_uri are deliberately LEFT IN PLACE
       * and left to go stale. Dropping a column in SQLite means a full table
       * rebuild, which is a real risk on a shipped health database for no
       * benefit. Stop READING them — videoRepo now joins video_files — and
       * drop them in a later migration once this one has been in the wild long
       * enough to trust.
       */

      /* ---------------- Device identity and sync bookkeeping ------------
       * Separate from `app_state` on purpose. app_state holds UI preferences
       * that belong to the person using the phone; this holds machine identity
       * that must survive a sign-out and must never be cleared when an account
       * is removed from the device.
       */
      await db.execAsync(`
        CREATE TABLE sync_state (
          key   TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);

      // A stable identity for this INSTALL, generated once and kept across
      // sign-outs — it identifies the phone, not the session. Generated in SQL
      // so it exists before any JS runs and cannot be forgotten by a caller.
      // Standard UUIDv4 shape: version nibble 4, variant nibble 8/9/a/b.
      await db.execAsync(`
        INSERT INTO sync_state (key, value)
        SELECT 'device_id', lower(
          hex(randomblob(4)) || '-' ||
          hex(randomblob(2)) || '-4' ||
          substr(hex(randomblob(2)), 2) || '-' ||
          substr('89ab', abs(random()) % 4 + 1, 1) ||
          substr(hex(randomblob(2)), 2) || '-' ||
          hex(randomblob(6))
        )
        WHERE NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'device_id');
      `);

      /* ---------------- Views that bake in the two easy-to-forget rules -
       * Every read now needs `deleted_at IS NULL` and an owner filter. Both
       * are one query away from being forgotten, and both bugs are invisible
       * until they are not: a deleted seizure reappearing in a vet report, or
       * one account's records showing under another's on a shared phone.
       *
       * These views make the predicates structural. Repositories read from
       * them; only the sync layer reads the base tables, because it is the one
       * caller that legitimately needs to see tombstones.
       */
      await db.execAsync(`
        CREATE VIEW dogs_live                 AS SELECT * FROM dogs                 WHERE deleted_at IS NULL;
        CREATE VIEW seizures_live             AS SELECT * FROM seizures             WHERE deleted_at IS NULL;
        CREATE VIEW videos_live               AS SELECT * FROM videos               WHERE deleted_at IS NULL;
        CREATE VIEW seizure_edits_live        AS SELECT * FROM seizure_edits        WHERE deleted_at IS NULL;
        CREATE VIEW medications_live          AS SELECT * FROM medications          WHERE deleted_at IS NULL;
        CREATE VIEW medication_reminders_live AS SELECT * FROM medication_reminders WHERE deleted_at IS NULL;
        CREATE VIEW medication_doses_live     AS SELECT * FROM medication_doses     WHERE deleted_at IS NULL;
        CREATE VIEW daily_checkins_live       AS SELECT * FROM daily_checkins       WHERE deleted_at IS NULL;
        CREATE VIEW meals_live                AS SELECT * FROM meals                WHERE deleted_at IS NULL;
      `);
    },
  },

  {
    version: 10,
    name: 'mood-only check-ins',
    up: async (db) => {
      /**
       * Marks a check-in row that exists ONLY because the owner tapped a face
       * on Home, and never described the rest of the day.
       *
       * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────
       *
       * Tapping "How is Lucy's day?" now saves immediately, which means it can
       * CREATE today's row rather than only edit an existing one. But
       * daily_checkins.stress is NOT NULL DEFAULT 2, and appetite/water/gi
       * default to 'normal' — so a row conjured from one tap would assert that
       * the owner rated stress 2 and called appetite normal on a day they said
       * nothing of the kind.
       *
       * That is not a cosmetic problem. These rows ARE the control dataset:
       * `stressAssociation` in src/features/analytics compares owner-rated
       * stress on seizure days against quiet days, so fabricated 2s would move
       * a number a vet might read. A fabricated control dataset is worse than
       * an absent one.
       *
       * `sleep_hrs` already had the honest shape — nullable, with analytics
       * filtering on `c.sleepHrs !== null`. This flag extends the same idea to
       * the columns that could not be made nullable without a table rebuild:
       * the value is present, but the flag says nobody stood behind it.
       *
       * 0 for every existing row, which is true — every row written before now
       * came from the full form.
       */
      await db.execAsync(`
        ALTER TABLE daily_checkins
          ADD COLUMN mood_only INTEGER NOT NULL DEFAULT 0;
      `);

      // The _live views were created with SELECT *, which SQLite froze to the
      // column list as it stood. A view does not pick up a column added later,
      // so it has to be recreated or `mood_only` is invisible to every read.
      await db.execAsync(`
        DROP VIEW IF EXISTS daily_checkins_live;
        CREATE VIEW daily_checkins_live AS
          SELECT * FROM daily_checkins WHERE deleted_at IS NULL;
      `);
    },
  },

  {
    version: 11,
    name: 'per-phase symptom notes on videos',
    up: async (db) => {
      /**
       * What the owner saw before, during and after the seizure in THIS clip.
       *
       * ── WHY THESE ARE ON THE VIDEO AND NOT JUST THE SEIZURE ───────────
       *
       * The seizure record already carries structured observations
       * (pre_ictal_obs, ictal_obs, post_behavior) chosen from fixed
       * vocabularies. These are different, and deliberately free text.
       *
       * The case they exist for is an IMPORTED clip: an owner films a seizure
       * on the normal camera app and adds it days later, so there was never a
       * live capture and the seizure row is thin. What they can still describe
       * is what the footage shows — "she was circling for about a minute
       * before this starts", "the video cuts out while she is still paddling".
       * That is an observation about the recording, not a second opinion about
       * the seizure, and forcing it into the seizure's chip vocabulary would
       * lose exactly the detail that makes it worth having.
       *
       * Free text also keeps them OUT of the analytics vocabularies, which is
       * correct: these are notes for a vet to read, not values to count.
       *
       * Empty string rather than NULL, matching every other note column in the
       * schema, so no consumer has to handle three states.
       */
      await db.execAsync(`
        ALTER TABLE videos ADD COLUMN pre_note   TEXT NOT NULL DEFAULT '';
        ALTER TABLE videos ADD COLUMN ictal_note TEXT NOT NULL DEFAULT '';
        ALTER TABLE videos ADD COLUMN post_note  TEXT NOT NULL DEFAULT '';
      `);

      // Same trap migration 10 hit: SQLite expands `SELECT *` in a view at
      // CREATE time and freezes the column list, so videos_live cannot see a
      // column added afterwards. Without this the three fields would be
      // invisible to every read in the app — videoRepo reads the view.
      await db.execAsync(`
        DROP VIEW IF EXISTS videos_live;
        CREATE VIEW videos_live AS
          SELECT * FROM videos WHERE deleted_at IS NULL;
      `);
    },
  },

  {
    version: 12,
    name: 'outbox retry backoff needs a last-attempt timestamp',
    up: async (db) => {
      /**
       * When the last push of this entry was attempted.
       *
       * ── WHY THE `attempts` COLUMN WAS NOT ENOUGH ──────────────────────
       *
       * `attempts` has been incremented by recordFailure since migration 1,
       * and `backoffMs()` has existed to turn it into a delay — but nothing
       * ever read them together, because there was no way to know WHEN the
       * last attempt happened. A count on its own cannot answer "may this be
       * retried yet", so every trigger re-sent the same failing batch at full
       * rate.
       *
       * NULL means "never attempted", which is the correct state for a freshly
       * queued row and is why the column is nullable rather than defaulted to
       * 0 — a default of 0 would read as "attempted at the epoch", i.e. always
       * due, which is accidentally right today and would be silently wrong the
       * moment the predicate changed.
       *
       * Wall clock, deliberately, unlike src/utils/clock.ts. A duration must
       * never be measured with a clock that can jump; a retry WINDOW may be,
       * because the worst an NTP correction can do here is retry a little
       * early or a little late. Neither loses data.
       *
       * The outbox is local-only — it is not in SYNC_TABLES and has no `_live`
       * view — so this needs no view rebuild, unlike migrations 10 and 11.
       */
      await db.execAsync(
        'ALTER TABLE outbox ADD COLUMN last_attempt_at INTEGER;',
      );
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

/**
 * Test seam.
 *
 * Exposed so migrations.test.ts can replay the schema an existing user is
 * actually on — run 1..8, write rows the way the old code wrote them, then
 * apply 9 and check the backfills. Without this the only reachable state is a
 * database created at version 9, where every backfill is a no-op and the
 * upgrade path — the one that runs on real phones holding real records — is
 * never exercised.
 *
 * Read-only by convention. Nothing in the app should iterate this.
 */
export const MIGRATIONS_FOR_TEST: readonly Migration[] = migrations;
