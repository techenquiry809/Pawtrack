/**
 * Migration 9, against the database an existing user is actually holding.
 *
 * ── WHY THIS TEST EARNS ITS KEEP ──────────────────────────────────────
 *
 * A migration that throws does not fail a screen — it fails `getDb()`, which
 * every launch awaits before rendering anything. The app does not start. There
 * is no partial degradation and no way for the owner to work around it, and
 * the records are on the far side of the failure.
 *
 * Migration 9 is also almost entirely BACKFILL, and a backfill can only be
 * checked against data written by the old code. A database created fresh at
 * version 9 has nothing to backfill, so every UPDATE in it is a silent no-op
 * and the test passes while proving nothing. So these tests replay 1..8, write
 * rows exactly as the pre-sync repositories wrote them, and only then apply 9.
 *
 * Runs on node:sqlite through a small adapter — the migrations are plain SQL
 * and this keeps them checkable without a simulator.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { LATEST_SCHEMA_VERSION, MIGRATIONS_FOR_TEST } from './migrations.ts';

/* ------------------------------------------------------------------ */
/* An expo-sqlite shape over node:sqlite                               */
/* ------------------------------------------------------------------ */

type Params = readonly unknown[];

function adapt(db: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: Params = []) =>
      db.prepare(sql).run(...(params as never[])),
    getFirstAsync: async <T,>(sql: string, params: Params = []): Promise<T | null> =>
      (db.prepare(sql).get(...(params as never[])) as T) ?? null,
    getAllAsync: async <T,>(sql: string, params: Params = []): Promise<T[]> =>
      db.prepare(sql).all(...(params as never[])) as T[],
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/**
 * Applies migrations up to and including `through`.
 *
 * Skips anything already applied, exactly as runMigrations() does — a helper
 * that replayed from 1 every call would make "upgrade an existing database"
 * untestable, which is the only thing this file is for.
 */
async function migrateTo(db: DatabaseSync, through: number): Promise<void> {
  const shim = adapt(db);
  db.exec('PRAGMA foreign_keys = ON;');

  const { user_version: current } = db
    .prepare('PRAGMA user_version')
    .get() as { user_version: number };

  for (const migration of MIGRATIONS_FOR_TEST) {
    if (migration.version <= current) continue;
    if (migration.version > through) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migration.up(shim as any);
    db.exec(`PRAGMA user_version = ${migration.version}`);
  }
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

function one<T>(db: DatabaseSync, sql: string, params: Params = []): T {
  return db.prepare(sql).get(...(params as never[])) as T;
}

/**
 * A database as the pre-sync app left it: schema 8, with rows written the way
 * the old repositories wrote them.
 */
async function legacyDb(): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, 8);

  db.exec(`
    INSERT INTO dogs (id, name, created_at, updated_at)
      VALUES ('id_dog1', 'Lucy', 100, 100);

    INSERT INTO seizures (id, dog_id, start, created_at, updated_at)
      VALUES ('id_seiz1', 'id_dog1', 1000, 1000, 1000);

    -- Written by the old attachVideo: paths on the row, no created/updated_at
    -- columns existed at all.
    INSERT INTO videos (id, seizure_id, source, file_uri, timestamp,
                        imported_at, capture_confidence, thumb_uri, note)
      VALUES ('id_vid1', 'id_seiz1', 'recorded', 'videos/a.mp4', 5000,
              6000, 'device', 'thumbs/a.jpg', '');

    INSERT INTO seizure_edits (id, seizure_id, edited_at, summary)
      VALUES ('id_edit1', 'id_seiz1', 7000, 'Changed end time');

    INSERT INTO medications (id, dog_id, name, created_at, updated_at)
      VALUES ('id_med1', 'id_dog1', 'Phenobarbital', 200, 200);

    INSERT INTO medication_reminders (id, medication_id, time_hhmm, created_at, updated_at)
      VALUES ('id_rem1', 'id_med1', '08:00', 300, 300);

    INSERT INTO medication_doses (id, medication_id, dog_id, dose_date, status,
                                  recorded_at, created_at)
      VALUES ('id_dose1', 'id_med1', 'id_dog1', '2026-08-01', 'given', 8000, 8000);

    INSERT INTO meals (id, dog_id, timestamp, created_at)
      VALUES ('id_meal1', 'id_dog1', 9000, 9000);

    INSERT INTO daily_checkins (id, dog_id, timestamp, check_in_date,
                                created_at, updated_at)
      VALUES ('id_chk1', 'id_dog1', 400, '2026-08-01', 400, 400);
  `);

  return db;
}

/* ------------------------------------------------------------------ */
/* It applies at all                                                   */
/* ------------------------------------------------------------------ */

test('every migration applies to a fresh database', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  const { user_version } = one<{ user_version: number }>(db, 'PRAGMA user_version');
  // Tracks the constant rather than a literal, so adding a migration does not
  // require editing this test — a test that has to be edited on every change
  // gets edited without being read.
  assert.equal(
    user_version,
    LATEST_SCHEMA_VERSION,
    'schema version must land on the newest migration',
  );
  db.close();
});

/* ------------------------------------------------------------------ */
/* Migration 10 — mood-only check-ins                                  */
/* ------------------------------------------------------------------ */

test('migration 10 adds mood_only, defaulting existing rows to answered', async () => {
  const db = await legacyDb();
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  assert.ok(columns(db, 'daily_checkins').includes('mood_only'));

  const existing = one<{ mood_only: number }>(
    db, 'SELECT mood_only FROM daily_checkins WHERE id = ?', ['id_chk1'],
  );
  assert.equal(
    existing.mood_only,
    0,
    'every row written before this migration came from the full form',
  );
  db.close();
});

test('the daily_checkins_live view exposes mood_only', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  // SQLite expands `SELECT *` in a view at CREATE time and freezes the column
  // list, so a view made in migration 9 does not see a column added in 10.
  // Migration 10 recreates it; without that, mood_only is invisible to every
  // read in the app and the flag silently does nothing.
  const cols = (
    db.prepare('PRAGMA table_info(daily_checkins_live)').all() as { name: string }[]
  ).map((c) => c.name);

  assert.ok(
    cols.includes('mood_only'),
    'the view must be recreated after adding a column, or the flag is unreadable',
  );
  db.close();
});

test('migration 9 applies to a database that already has real records', async () => {
  const db = await legacyDb();

  // The whole point: this is the statement that runs on a real phone.
  await migrateTo(db, 9);

  const dogs = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM dogs');
  const seizures = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM seizures');
  assert.equal(dogs.n, 1, 'an existing dog must survive the upgrade');
  assert.equal(seizures.n, 1);
  db.close();
});

/* ------------------------------------------------------------------ */
/* The columns the sync spec assumed already existed                   */
/* ------------------------------------------------------------------ */

test('the four tables that had no updated_at now have one, backfilled', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  // videos had NO row-mutation timestamp at all — only the clinical
  // `timestamp` and `imported_at`. Last-write-wins had nothing to compare.
  const video = one<{ updated_at: number; created_at: number }>(
    db,
    'SELECT updated_at, created_at FROM videos WHERE id = ?',
    ['id_vid1'],
  );
  assert.equal(video.updated_at, 6000, 'max(imported_at, timestamp)');
  assert.equal(video.created_at, 6000);

  const meal = one<{ updated_at: number }>(
    db, 'SELECT updated_at FROM meals WHERE id = ?', ['id_meal1'],
  );
  assert.equal(meal.updated_at, 9000, 'meals had only created_at');

  const edit = one<{ updated_at: number }>(
    db, 'SELECT updated_at FROM seizure_edits WHERE id = ?', ['id_edit1'],
  );
  assert.equal(edit.updated_at, 7000, 'seizure_edits had only edited_at');

  const dose = one<{ updated_at: number }>(
    db, 'SELECT updated_at FROM medication_doses WHERE id = ?', ['id_dose1'],
  );
  assert.equal(dose.updated_at, 8000, 'medication_doses had only recorded_at');

  db.close();
});

test('a backfilled updated_at is never left at 0', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  // A row arriving at the server stamped with the epoch loses every conflict
  // it is ever in, silently.
  for (const table of ['videos', 'meals', 'seizure_edits', 'medication_doses']) {
    const zeros = one<{ n: number }>(
      db, `SELECT COUNT(*) AS n FROM ${table} WHERE updated_at = 0`,
    );
    assert.equal(zeros.n, 0, `${table} has a row that would always lose LWW`);
  }
  db.close();
});

test('dog_id is denormalised onto the three tables that lacked it', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  const video = one<{ dog_id: string }>(
    db, 'SELECT dog_id FROM videos WHERE id = ?', ['id_vid1'],
  );
  assert.equal(video.dog_id, 'id_dog1', 'backfilled through the parent seizure');

  const edit = one<{ dog_id: string }>(
    db, 'SELECT dog_id FROM seizure_edits WHERE id = ?', ['id_edit1'],
  );
  assert.equal(edit.dog_id, 'id_dog1');

  const reminder = one<{ dog_id: string }>(
    db, 'SELECT dog_id FROM medication_reminders WHERE id = ?', ['id_rem1'],
  );
  assert.equal(reminder.dog_id, 'id_dog1', 'backfilled through the medication');

  db.close();
});

test('every synced table gains user_id and deleted_at', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  const tables = [
    'dogs', 'seizures', 'videos', 'seizure_edits', 'medications',
    'medication_reminders', 'medication_doses', 'daily_checkins', 'meals',
  ];
  for (const table of tables) {
    const cols = columns(db, table);
    assert.ok(cols.includes('user_id'), `${table} is missing user_id`);
    assert.ok(cols.includes('deleted_at'), `${table} is missing deleted_at`);
  }
  db.close();
});

test('existing rows are left UNCLAIMED, not silently assigned', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  const dog = one<{ user_id: string | null }>(
    db, 'SELECT user_id FROM dogs WHERE id = ?', ['id_dog1'],
  );
  assert.equal(
    dog.user_id,
    null,
    'ownership is a decision the owner makes at first sign-in — a default ' +
      'here would hand one person’s records to whoever signs in next',
  );
  db.close();
});

/* ------------------------------------------------------------------ */
/* video_files: the metadata / bytes split                             */
/* ------------------------------------------------------------------ */

test('video_files is backfilled from the paths already on the rows', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  const file = one<{ file_uri: string; thumb_uri: string }>(
    db, 'SELECT file_uri, thumb_uri FROM video_files WHERE video_id = ?', ['id_vid1'],
  );
  assert.equal(file.file_uri, 'videos/a.mp4', 'losing this loses the recording');
  assert.equal(file.thumb_uri, 'thumbs/a.jpg');
  db.close();
});

test('a video is present on this device iff a video_files row exists', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  // A row pulled from another device: clinical metadata, no local bytes.
  db.exec(`
    INSERT INTO videos (id, dog_id, seizure_id, source, file_uri, timestamp,
                        imported_at, capture_confidence, thumb_uri, note,
                        created_at, updated_at)
      VALUES ('remote1', 'id_dog1', 'id_seiz1', 'recorded', '', 5000, 6000,
              'device', '', '', 6000, 6000);
  `);

  const present = one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM videos v
       JOIN video_files f ON f.video_id = v.id WHERE v.id = ?`,
    ['remote1'],
  );
  assert.equal(present.n, 0, 'the join is the whole presence test');
  db.close();
});

/* ------------------------------------------------------------------ */
/* Device identity                                                     */
/* ------------------------------------------------------------------ */

test('device_id is seeded as a well-formed UUIDv4', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  const row = one<{ value: string }>(
    db, "SELECT value FROM sync_state WHERE key = 'device_id'",
  );
  assert.match(
    row.value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'version nibble must be 4 and the variant nibble 8/9/a/b',
  );
  db.close();
});

/* ------------------------------------------------------------------ */
/* The views that bake in the easy-to-forget predicates                */
/* ------------------------------------------------------------------ */

test('the _live views hide tombstoned rows', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  db.exec("UPDATE seizures SET deleted_at = 123 WHERE id = 'id_seiz1'");

  const base = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM seizures');
  const live = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM seizures_live');

  assert.equal(base.n, 1, 'the base table still holds the tombstone to push');
  assert.equal(live.n, 0, 'a deleted seizure must not reach a vet report');
  db.close();
});

test('a _live view exists for every synced table', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  const views = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all() as {
      name: string;
    }[]
  ).map((v) => v.name);

  for (const table of [
    'dogs', 'seizures', 'videos', 'seizure_edits', 'medications',
    'medication_reminders', 'medication_doses', 'daily_checkins', 'meals',
  ]) {
    assert.ok(views.includes(`${table}_live`), `${table}_live is missing`);
  }
  db.close();
});

/* ------------------------------------------------------------------ */
/* The outbox schema                                                   */
/* ------------------------------------------------------------------ */

test('the outbox enforces one pending intent per row', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  db.prepare(
    'INSERT INTO outbox (table_name, row_id, op, queued_at) VALUES (?,?,?,?)',
  ).run('seizures', 'id_seiz1', 'upsert', 1);

  assert.throws(
    () =>
      db
        .prepare(
          'INSERT INTO outbox (table_name, row_id, op, queued_at) VALUES (?,?,?,?)',
        )
        .run('seizures', 'id_seiz1', 'upsert', 2),
    /UNIQUE/i,
  );
  db.close();
});

test('the outbox rejects an op that is neither upsert nor delete', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  assert.throws(
    () =>
      db
        .prepare(
          'INSERT INTO outbox (table_name, row_id, op, queued_at) VALUES (?,?,?,?)',
        )
        .run('seizures', 'x', 'patch', 1),
    /CHECK/i,
  );
  db.close();
});

/* ------------------------------------------------------------------ */
/* Idempotence                                                         */
/* ------------------------------------------------------------------ */

test('running migrations twice is a no-op, not an error', async () => {
  const db = await legacyDb();
  await migrateTo(db, 9);

  // Exactly what happens on the second launch after an upgrade: every
  // migration is skipped because user_version is already past it.
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  const files = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM video_files');
  assert.equal(files.n, 1, 'a re-run must not duplicate the backfill');
  db.close();
});

/* ------------------------------------------------------------------ */
/* Migration 13 — the outbox learns which account queued each write    */
/* ------------------------------------------------------------------ */

/*
 * The backfill has to be right on the FIRST run against a real device, and it
 * has to take the owner from the referenced ROW rather than from the current
 * session. Taking it from the session would stamp every entry with whoever
 * happened to upgrade the app — which is exactly the cross-account bug the
 * column exists to prevent, just committed permanently at migration time.
 */

test('migration 13 backfills each queued entry from the row it points at', async () => {
  const db = new DatabaseSync(':memory:');
  // Stop one short, so the outbox is still the pre-13 shape when seeded.
  await migrateTo(db, 12);

  const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
  const B = 'bbbbbbbb-0000-0000-0000-00000000000b';

  db.exec(`
    INSERT INTO dogs (id, user_id, name, created_at, updated_at)
      VALUES ('dog-a','${A}','Rex',1,1), ('dog-b','${B}','Bailey',1,1),
             ('dog-n',NULL,'River',1,1);
    INSERT INTO outbox (table_name, row_id, op, queued_at) VALUES
      ('dogs','dog-a','upsert',1),
      ('dogs','dog-b','upsert',2),
      ('dogs','dog-n','upsert',3),
      ('dogs','vanished','upsert',4);
  `);

  await migrateTo(db, 13);

  // Mapped to plain tuples: node:sqlite returns null-prototype row objects,
  // which strict deepEqual rejects on the prototype alone even when every
  // value matches.
  const owners = (
    db
      .prepare('SELECT row_id, user_id FROM outbox ORDER BY row_id')
      .all() as { row_id: string; user_id: string | null }[]
  ).map((r) => `${r.row_id}=${r.user_id ?? 'NULL'}`);

  assert.deepEqual(owners, [
    // Each entry inherits the owner of the row it describes — not a session.
    `dog-a=${A}`,
    `dog-b=${B}`,
    // Queued while signed out. NULL is a real value: belongs to no account
    // yet, and must not become pushable by whoever signs in next.
    'dog-n=NULL',
    // The row is gone, so there is no owner to infer. pushOnce() already
    // discards queued-but-gone entries; what matters is that it is not
    // silently adopted by an account.
    'vanished=NULL',
  ]);
  db.close();
});

test('after migration 13 a push as one account cannot see the other queue', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, 12);

  const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
  const B = 'bbbbbbbb-0000-0000-0000-00000000000b';
  db.exec(`
    INSERT INTO dogs (id, user_id, name, created_at, updated_at)
      VALUES ('dog-a','${A}','Rex',1,1), ('dog-b','${B}','Bailey',1,1);
    INSERT INTO outbox (table_name, row_id, op, queued_at) VALUES
      ('dogs','dog-a','upsert',1), ('dogs','dog-b','upsert',2);
  `);

  await migrateTo(db, 13);

  // Byte-for-byte the predicate in outbox.peek().
  const drainableByB = db
    .prepare('SELECT row_id FROM outbox WHERE user_id = ? ORDER BY id')
    .all(B) as { row_id: string }[];

  assert.deepEqual(
    drainableByB.map((r) => r.row_id),
    ['dog-b'],
    "B's push must not carry A's dog into B's account",
  );
  db.close();
});

/* ------------------------------------------------------------------ */
/* Migration 14 — consent moves off the device                         */
/* ------------------------------------------------------------------ */

/*
 * The device-level consent record and the "not now" flag both describe a world
 * where an account was optional. Leaving them behind would be worse than
 * untidy: they are a second, stale answer to "has this been agreed to?",
 * sitting in the table the app still reads for other things.
 */

test('migration 14 removes the device-level consent and prompt keys', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, 13);

  // OR REPLACE: earlier migrations already seed some sync_state rows (a device
  // id, per-table cursors), and this fixture is about what migration 14 does
  // to the consent keys, not about starting from an empty table.
  db.exec(`
    INSERT OR REPLACE INTO sync_state (key, value) VALUES
      ('consent_terms_version', '2026-09-06'),
      ('consent_privacy_version', '2026-09-06'),
      ('consent_accepted_at', '1788000000000'),
      ('auth_prompt_dismissed', '1'),
      ('device_id', 'keep-me'),
      ('cursor:dogs', '42');
  `);

  await migrateTo(db, 14);

  const left = (
    db.prepare('SELECT key FROM sync_state ORDER BY key').all() as { key: string }[]
  ).map((r) => r.key);

  // Everything about the old anonymous model is gone.
  for (const gone of [
    'consent_terms_version',
    'consent_privacy_version',
    'consent_accepted_at',
    'auth_prompt_dismissed',
  ]) {
    assert.ok(!left.includes(gone), `${gone} must not survive migration 14`);
  }

  // Everything about the MACHINE survives. Wiping device_id or a cursor here
  // would make the phone look like a new device and force a full resync.
  assert.ok(left.includes('device_id'), 'device identity must survive');
  assert.ok(left.includes('cursor:dogs'), 'sync cursors must survive');
  db.close();
});

test('migration 14 is harmless on a database that never had those keys', async () => {
  // Every new install. The DELETEs must match nothing and must not throw.
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  const { user_version } = one<{ user_version: number }>(db, 'PRAGMA user_version');
  assert.equal(user_version, LATEST_SCHEMA_VERSION);
  db.close();
});

/* ------------------------------------------------------------------ */
/* Migration 15 — cursors get an owner                                 */
/* ------------------------------------------------------------------ */
/**
 * The bug this migration ends is silent: a cursor left by one account makes
 * the next account's pull skip rows, and the sync still reports success. So
 * the test has to prove the two things that make the skip impossible — that a
 * position is now stored PER ACCOUNT, and that the unattributable rows from
 * before the fix do not survive to be handed to whoever signs in next.
 */
test('migration 15 discards pre-fix cursors rather than guessing whose they were', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, 14);

  // A device that has synced: the old schema, keyed on table_name alone, with
  // no record anywhere of which account got it to seq 5000.
  db.exec(`
    INSERT INTO sync_cursors (table_name, last_seen_seq, last_pulled_at)
    VALUES ('dogs', 5000, 1788000000000),
           ('seizures', 4900, 1788000000000);
  `);

  await migrateTo(db, 15);

  const { c } = one<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM sync_cursors');
  assert.equal(c, 0, 'an unattributable cursor must not survive to be reused');
});

test('migration 15 keys cursors on the account as well as the table', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, LATEST_SCHEMA_VERSION);

  // Two accounts, same phone, same table. Under the old primary key the second
  // insert would have replaced the first; both must now stand.
  db.exec(`
    INSERT INTO sync_cursors (user_id, table_name, last_seen_seq)
    VALUES ('user-a', 'dogs', 5000),
           ('user-b', 'dogs', 12);
  `);

  const a = one<{ last_seen_seq: number }>(
    db, 'SELECT last_seen_seq FROM sync_cursors WHERE user_id = ? AND table_name = ?',
    ['user-a', 'dogs'],
  );
  const b = one<{ last_seen_seq: number }>(
    db, 'SELECT last_seen_seq FROM sync_cursors WHERE user_id = ? AND table_name = ?',
    ['user-b', 'dogs'],
  );
  assert.equal(a.last_seen_seq, 5000);
  assert.equal(b.last_seen_seq, 12, 'B must not inherit A 5000-row head start');

  // The account that has never pulled this table has no row at all, which is
  // what getCursor() turns into "start from the beginning".
  const missing = db
    .prepare('SELECT last_seen_seq FROM sync_cursors WHERE user_id = ? AND table_name = ?')
    .get('user-c', 'dogs');
  assert.equal(missing, undefined);

  db.close();
});

test('migration 15 still rejects a duplicate cursor for one account', async () => {
  const db = new DatabaseSync(':memory:');
  await migrateTo(db, LATEST_SCHEMA_VERSION);
  db.exec(`INSERT INTO sync_cursors (user_id, table_name, last_seen_seq)
           VALUES ('user-a', 'dogs', 1);`);
  assert.throws(
    () =>
      db.exec(`INSERT INTO sync_cursors (user_id, table_name, last_seen_seq)
               VALUES ('user-a', 'dogs', 2);`),
    /UNIQUE|PRIMARY KEY|constraint/i,
    'the composite key must still be a key',
  );
  db.close();
});
