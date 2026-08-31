/**
 * The outbox — every local write's intent to reach the server.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────
 *
 * An outbox insert happens in the SAME TRANSACTION as the row write it
 * describes. Not before, not after, not in a `.then()`. If those two can
 * diverge, a crash between them loses the write silently: the row is on the
 * phone, nothing knows it needs pushing, and it is missing from the account
 * forever. On this dataset a lost write is a lost seizure.
 *
 * That is why every function here takes a `db` handle rather than calling
 * getDb() itself — the caller is already inside `withTransactionAsync` and
 * must stay there.
 *
 * ── WHY ONE ROW PER PENDING INTENT ────────────────────────────────────
 *
 * `idx_outbox_row` is UNIQUE on (table_name, row_id). An owner correcting a
 * seizure five times on a train with no signal should produce one push, not
 * five, because the push sends the row's CURRENT state anyway (see
 * services/sync/push.ts). Five queued entries would be four redundant
 * round trips describing the same final row.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

export type OutboxOp = 'upsert' | 'delete';

export type OutboxEntry = {
  id: number;
  tableName: string;
  rowId: string;
  op: OutboxOp;
  queuedAt: number;
  attempts: number;
  lastError: string | null;
};

/**
 * Queue one row.
 *
 * ── WHY THIS IS AN UPSERT AND WHY 'delete' WINS ───────────────────────
 *
 * A plain INSERT throws on the second edit of the same row, against a UNIQUE
 * index. `INSERT OR IGNORE` avoids the throw and introduces a worse bug: a row
 * queued as 'upsert' and then deleted would keep the stale 'upsert' intent, so
 * the delete never leaves the phone and the record reappears on every other
 * device.
 *
 * So: last write wins on everything EXCEPT the op, where 'delete' is terminal
 * and outranks any 'upsert' on either side. That matches the server's rule in
 * sync_apply_row — a tombstone is a terminal state, and a resurrected seizure
 * record is worse than a lost edit.
 */
export async function enqueue(
  db: SQLiteDatabase,
  tableName: string,
  rowId: string,
  op: OutboxOp,
  now: number = Date.now(),
): Promise<void> {
  await db.runAsync(
    `INSERT INTO outbox (table_name, row_id, op, queued_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(table_name, row_id) DO UPDATE SET
       op = CASE
              WHEN excluded.op = 'delete' OR outbox.op = 'delete' THEN 'delete'
              ELSE excluded.op
            END,
       queued_at = excluded.queued_at,
       -- New content deserves a fresh run at the backoff ladder rather than
       -- inheriting the failures of the version it replaces.
       attempts = 0,
       last_error = NULL`,
    [tableName, rowId, op, now],
  );
}

/** Queue several rows of one table. Used by the claim flow and by cascades. */
export async function enqueueMany(
  db: SQLiteDatabase,
  tableName: string,
  rowIds: string[],
  op: OutboxOp,
  now: number = Date.now(),
): Promise<void> {
  for (const rowId of rowIds) {
    await enqueue(db, tableName, rowId, op, now);
  }
}

/**
 * The next slice to push, oldest first.
 *
 * Ordered by the autoincrement id rather than queued_at: the id is the order
 * the intents were actually recorded, and queued_at is a wall-clock reading
 * that can move backwards under an NTP correction — the same reason
 * src/utils/clock.ts refuses to time a seizure with it.
 */
export async function peek(
  db: SQLiteDatabase,
  limit = 200,
): Promise<OutboxEntry[]> {
  const rows = await db.getAllAsync<{
    id: number;
    table_name: string;
    row_id: string;
    op: OutboxOp;
    queued_at: number;
    attempts: number;
    last_error: string | null;
  }>(`SELECT * FROM outbox ORDER BY id LIMIT ?`, [limit]);

  return rows.map((r) => ({
    id: r.id,
    tableName: r.table_name,
    rowId: r.row_id,
    op: r.op,
    queuedAt: r.queued_at,
    attempts: r.attempts,
    lastError: r.last_error,
  }));
}

/** Clear a drained batch. Called only after the server confirmed the push. */
export async function clear(
  db: SQLiteDatabase,
  entryIds: number[],
): Promise<void> {
  if (entryIds.length === 0) return;
  const holes = entryIds.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM outbox WHERE id IN (${holes})`, entryIds);
}

/**
 * Record a failed attempt and keep the row.
 *
 * Never drops an entry however many times it fails. A queued seizure that the
 * server keeps rejecting is a bug to go and find, not garbage to collect — the
 * "Your devices" screen and the sign-out warning both surface a stuck outbox
 * to the owner rather than quietly discarding it.
 */
export async function recordFailure(
  db: SQLiteDatabase,
  entryIds: number[],
  message: string,
): Promise<void> {
  if (entryIds.length === 0) return;
  const holes = entryIds.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ?
      WHERE id IN (${holes})`,
    [message.slice(0, 500), ...entryIds],
  );
}

/** How many writes are waiting. Drives the sign-out warning. */
export async function pendingCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM outbox',
  );
  return row?.n ?? 0;
}

/**
 * Exponential backoff for a batch that keeps failing, capped at ~5 minutes.
 *
 * Capped low on purpose: this app's whole value is that a record reaches the
 * account. An hour-long backoff on a phone that is only occasionally awake
 * means a seizure logged this morning is still on one device tonight.
 */
export function backoffMs(attempts: number): number {
  return Math.min(300_000, 2_000 * 2 ** Math.min(attempts, 8));
}
