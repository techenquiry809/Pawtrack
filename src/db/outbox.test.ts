/**
 * The outbox's conflict rule, and the tombstone cascade.
 *
 * ── WHY THESE TWO ─────────────────────────────────────────────────────
 *
 * They are the two places where the sync design's correctness rests on a
 * statement being written a particular way, and where a reasonable-looking
 * alternative silently loses data rather than throwing.
 *
 * 1. THE OUTBOX UPSERT. `idx_outbox_row` is UNIQUE on (table_name, row_id), so
 *    a plain INSERT throws on the second edit of a row. The obvious fix is
 *    INSERT OR IGNORE, which does not throw and introduces a worse bug: a row
 *    queued as 'upsert' and then deleted keeps the stale 'upsert' intent, so
 *    the delete never leaves the phone and the record reappears on every other
 *    device on their next pull.
 *
 * 2. THE TOMBSTONE CASCADE. Deletes became UPDATEs so they can be replicated.
 *    ON DELETE CASCADE fires on a DELETE and NOT on an UPDATE that happens to
 *    set a column called deleted_at — so every cascade in the schema stopped
 *    working the moment deletes went soft, without any error to notice. A
 *    tombstoned seizure would leave its videos live and orphaned.
 *
 * These run against node:sqlite rather than expo-sqlite: the statements under
 * test are plain SQL, and this keeps them runnable without a simulator.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE outbox (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name  TEXT NOT NULL,
      row_id      TEXT NOT NULL,
      op          TEXT NOT NULL CHECK (op IN ('upsert','delete')),
      queued_at   INTEGER NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT
    );
    CREATE UNIQUE INDEX idx_outbox_row ON outbox(table_name, row_id);

    CREATE TABLE seizures (
      id         TEXT PRIMARY KEY NOT NULL,
      dog_id     TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    );
    CREATE TABLE videos (
      id         TEXT PRIMARY KEY NOT NULL,
      dog_id     TEXT,
      seizure_id TEXT NOT NULL REFERENCES seizures(id) ON DELETE CASCADE,
      updated_at INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    );
    CREATE TABLE seizure_edits (
      id         TEXT PRIMARY KEY NOT NULL,
      dog_id     TEXT,
      seizure_id TEXT NOT NULL REFERENCES seizures(id) ON DELETE CASCADE,
      updated_at INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    );
  `);
  return db;
}

/** Byte-for-byte the statement in src/db/outbox.ts enqueue(). */
const ENQUEUE_SQL = `INSERT INTO outbox (table_name, row_id, op, queued_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(table_name, row_id) DO UPDATE SET
       op = CASE
              WHEN excluded.op = 'delete' OR outbox.op = 'delete' THEN 'delete'
              ELSE excluded.op
            END,
       queued_at = excluded.queued_at,
       attempts = 0,
       last_error = NULL`;

function enqueue(
  db: DatabaseSync,
  table: string,
  rowId: string,
  op: 'upsert' | 'delete',
  now = Date.now(),
): void {
  db.prepare(ENQUEUE_SQL).run(table, rowId, op, now);
}

function queued(db: DatabaseSync): { table_name: string; row_id: string; op: string }[] {
  return db
    .prepare('SELECT table_name, row_id, op FROM outbox ORDER BY id')
    .all() as { table_name: string; row_id: string; op: string }[];
}

/* ------------------------------------------------------------------ */
/* The outbox upsert                                                   */
/* ------------------------------------------------------------------ */

test('editing the same row five times offline queues one push, not five', () => {
  const db = freshDb();

  // An owner correcting a seizure on a train with no signal.
  for (let i = 0; i < 5; i += 1) enqueue(db, 'seizures', 's1', 'upsert');

  const rows = queued(db);
  assert.equal(rows.length, 1, 'one pending intent per row');
  assert.equal(rows[0]?.op, 'upsert');
  db.close();
});

test('a plain INSERT would have thrown here — the upsert is load-bearing', () => {
  const db = freshDb();
  enqueue(db, 'seizures', 's1', 'upsert');

  assert.throws(
    () =>
      db
        .prepare(
          'INSERT INTO outbox (table_name, row_id, op, queued_at) VALUES (?,?,?,?)',
        )
        .run('seizures', 's1', 'upsert', Date.now()),
    /UNIQUE/i,
    'the unique index is real; enqueue must not be a bare INSERT',
  );
  db.close();
});

test('a delete beats an upsert already in the queue', () => {
  const db = freshDb();

  enqueue(db, 'seizures', 's1', 'upsert');
  enqueue(db, 'seizures', 's1', 'delete');

  assert.equal(
    queued(db)[0]?.op,
    'delete',
    'INSERT OR IGNORE would have left this as upsert and the delete would ' +
      'never have reached the server',
  );
  db.close();
});

test('an edit after a delete does NOT resurrect the row', () => {
  const db = freshDb();

  enqueue(db, 'seizures', 's1', 'delete');
  // A late write from a screen that has not unmounted yet.
  enqueue(db, 'seizures', 's1', 'upsert');

  assert.equal(
    queued(db)[0]?.op,
    'delete',
    'a tombstone is terminal — a resurrected seizure record is worse than a ' +
      'lost edit',
  );
  db.close();
});

test('the same row id in two tables is two separate intents', () => {
  const db = freshDb();

  // Legacy ids are not globally unique across tables, so the index is on the
  // pair. Collapsing on row_id alone would drop one of these.
  enqueue(db, 'seizures', 'shared_id', 'upsert');
  enqueue(db, 'videos', 'shared_id', 'delete');

  assert.equal(queued(db).length, 2);
  db.close();
});

test('a re-edit resets the failure count so it is not stuck in backoff', () => {
  const db = freshDb();
  enqueue(db, 'seizures', 's1', 'upsert');
  db.exec("UPDATE outbox SET attempts = 7, last_error = 'boom'");

  enqueue(db, 'seizures', 's1', 'upsert');

  const row = db.prepare('SELECT attempts, last_error FROM outbox').get() as {
    attempts: number;
    last_error: string | null;
  };
  assert.equal(row.attempts, 0, 'new content deserves a fresh run at the ladder');
  assert.equal(row.last_error, null);
  db.close();
});

/* ------------------------------------------------------------------ */
/* The tombstone cascade                                               */
/* ------------------------------------------------------------------ */

test('ON DELETE CASCADE does not fire for a tombstone — the bug this guards', () => {
  const db = freshDb();
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    INSERT INTO seizures (id, dog_id) VALUES ('s1', 'd1');
    INSERT INTO videos (id, dog_id, seizure_id) VALUES ('v1', 'd1', 's1');
  `);

  // What deleteSeizure does now: an UPDATE, not a DELETE.
  db.prepare('UPDATE seizures SET deleted_at = ? WHERE id = ?').run(1000, 's1');

  const video = db.prepare('SELECT deleted_at FROM videos WHERE id = ?').get('v1') as
    | { deleted_at: number | null }
    | undefined;

  assert.equal(
    video?.deleted_at,
    null,
    'the foreign key does NOT see this as a delete — which is exactly why ' +
      'tombstone() has to walk the subtree itself',
  );
  db.close();
});

/**
 * The walk from src/db/tombstone.ts, in the shape the real one has: mark the
 * live rows, queue each, then recurse into the children.
 */
function tombstoneSeizure(db: DatabaseSync, id: string, now = 1000): void {
  const live = db
    .prepare('SELECT id FROM seizures WHERE id = ? AND deleted_at IS NULL')
    .all(id) as { id: string }[];
  if (live.length === 0) return;

  db.prepare('UPDATE seizures SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    now,
    id,
  );
  enqueue(db, 'seizures', id, 'delete', now);

  for (const child of ['videos', 'seizure_edits'] as const) {
    const rows = db
      .prepare(`SELECT id FROM ${child} WHERE seizure_id = ? AND deleted_at IS NULL`)
      .all(id) as { id: string }[];
    for (const row of rows) {
      db.prepare(
        `UPDATE ${child} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, row.id);
      enqueue(db, child, row.id, 'delete', now);
    }
  }
}

test('tombstoning a seizure tombstones its videos and edit rows', () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO seizures (id, dog_id) VALUES ('s1', 'd1');
    INSERT INTO videos (id, dog_id, seizure_id) VALUES ('v1', 'd1', 's1');
    INSERT INTO videos (id, dog_id, seizure_id) VALUES ('v2', 'd1', 's1');
    INSERT INTO seizure_edits (id, dog_id, seizure_id) VALUES ('e1', 'd1', 's1');
  `);

  tombstoneSeizure(db, 's1');

  const liveVideos = db
    .prepare('SELECT COUNT(*) AS n FROM videos WHERE deleted_at IS NULL')
    .get() as { n: number };
  const liveEdits = db
    .prepare('SELECT COUNT(*) AS n FROM seizure_edits WHERE deleted_at IS NULL')
    .get() as { n: number };

  assert.equal(liveVideos.n, 0, 'orphaned videos would sync to other devices');
  assert.equal(liveEdits.n, 0);
  db.close();
});

test('every tombstoned row is queued for push, not just the parent', () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO seizures (id, dog_id) VALUES ('s1', 'd1');
    INSERT INTO videos (id, dog_id, seizure_id) VALUES ('v1', 'd1', 's1');
    INSERT INTO seizure_edits (id, dog_id, seizure_id) VALUES ('e1', 'd1', 's1');
  `);

  tombstoneSeizure(db, 's1');

  const rows = queued(db);
  assert.equal(rows.length, 3, 'a child tombstone nobody pushes is a local-only delete');
  assert.ok(rows.every((r) => r.op === 'delete'));
  db.close();
});

test('re-tombstoning is a no-op, so a dog reaching a video twice is safe', () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO seizures (id, dog_id) VALUES ('s1', 'd1');
    INSERT INTO videos (id, dog_id, seizure_id) VALUES ('v1', 'd1', 's1');
  `);

  tombstoneSeizure(db, 's1', 1000);
  tombstoneSeizure(db, 's1', 2000);

  const seizure = db
    .prepare('SELECT deleted_at FROM seizures WHERE id = ?')
    .get('s1') as { deleted_at: number };

  assert.equal(
    seizure.deleted_at,
    1000,
    'the second pass must not re-stamp; a dog cascades to its videos both ' +
      'directly and through seizures, and both paths are correct',
  );
  db.close();
});

test('a tombstone moves updated_at, or it loses last-write-wins', () => {
  const db = freshDb();
  db.exec("INSERT INTO seizures (id, dog_id, updated_at) VALUES ('s1', 'd1', 500)");

  tombstoneSeizure(db, 's1', 1000);

  const row = db
    .prepare('SELECT updated_at FROM seizures WHERE id = ?')
    .get('s1') as { updated_at: number };

  assert.equal(
    row.updated_at,
    1000,
    'a tombstone keeping its old updated_at would lose to any concurrent ' +
      'edit made on another device before the delete',
  );
  db.close();
});
