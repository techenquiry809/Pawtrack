/**
 * Regression test for "every saved seizure is immediately marked abandoned".
 *
 * ── THE BUG ───────────────────────────────────────────────────────────
 *
 * recovery.tsx's finish() saved the record — finalizeSeizure sets
 * status='complete' — and then called clearDraft(), which was bound to the
 * store's `cancel` action → discardSeizure() → UPDATE ... status='abandoned'.
 * Every read in the app filters on status='complete', so every seizure an owner
 * successfully saved disappeared from history, analytics and vet reports.
 *
 * Fixed in two places, and this file covers the second one:
 *   1. recovery.tsx now uses a separate `clearDraft` action on the success path
 *   2. discardSeizure only touches rows still 'in_progress'  ← tested here
 *
 * The guard is the one that matters long-term: a destructive UPDATE keyed on
 * nothing but the id is one careless call site away from doing this again.
 *
 * These run against node:sqlite rather than expo-sqlite — the statement under
 * test is plain SQL, and this keeps the test runnable without a simulator.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

/** The columns of `seizures` this statement actually touches. */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE seizures (
      id              TEXT PRIMARY KEY NOT NULL,
      status          TEXT NOT NULL DEFAULT 'complete',
      last_touched_at INTEGER,
      updated_at      INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

/** Byte-for-byte the statement in seizureRepo.discardSeizure. */
const DISCARD_SQL = `UPDATE seizures SET status = 'abandoned', last_touched_at = ?, updated_at = ?
      WHERE id = ? AND status = 'in_progress'`;

function discard(db: DatabaseSync, id: string): void {
  const now = Date.now();
  db.prepare(DISCARD_SQL).run(now, now, id);
}

function statusOf(db: DatabaseSync, id: string): string {
  const row = db.prepare('SELECT status FROM seizures WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  return row?.status ?? '<missing>';
}

test('a saved seizure survives a stray discard', () => {
  const db = freshDb();
  db.exec("INSERT INTO seizures (id, status) VALUES ('s1', 'complete')");

  // Exactly what the old success path did, one statement after finalizing.
  discard(db, 's1');

  assert.equal(
    statusOf(db, 's1'),
    'complete',
    'a complete record must never be reachable by discardSeizure',
  );
  db.close();
});

test('an in-progress seizure is still discardable', () => {
  const db = freshDb();
  db.exec("INSERT INTO seizures (id, status) VALUES ('s2', 'in_progress')");

  discard(db, 's2');

  assert.equal(statusOf(db, 's2'), 'abandoned', 'the real discard path must work');
  db.close();
});

test('discarding an already-abandoned seizure is a no-op, not an error', () => {
  const db = freshDb();
  db.exec("INSERT INTO seizures (id, status) VALUES ('s3', 'abandoned')");

  discard(db, 's3');

  assert.equal(statusOf(db, 's3'), 'abandoned');
  db.close();
});

test('the save-then-discard sequence that lost every seizure', () => {
  const db = freshDb();
  // openSeizure inserts in_progress...
  db.exec("INSERT INTO seizures (id, status) VALUES ('s4', 'in_progress')");
  // ...finalizeSeizure flips it to complete...
  db.exec("UPDATE seizures SET status = 'complete' WHERE id = 's4'");
  // ...and then the old clearDraft() fired.
  discard(db, 's4');

  assert.equal(
    statusOf(db, 's4'),
    'complete',
    'this is the exact sequence that made saved seizures vanish',
  );
  db.close();
});
