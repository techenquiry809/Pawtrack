/**
 * Claiming the records that were already on this phone.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Everyone using the app today has records with `user_id IS NULL`, written
 * before accounts existed. Reads are fenced by owner (src/db/scope.ts), so the
 * moment someone signs in, those rows stop matching and their dog's entire
 * history appears to vanish. Skipping this step is not a missing feature; it
 * is data loss as far as the owner is concerned.
 *
 * ── WHY IT ASKS FIRST ─────────────────────────────────────────────────
 *
 * If someone signs into an account that already has a different dog, silently
 * merging two animals' seizure histories is unrecoverable. There is no undo
 * that can separate them again afterwards, and a vet report built from the
 * merge would be actively misleading.
 *
 * So the decision is put to the owner, with both dogs named, and the
 * destructive branch is behind a second confirmation.
 */

import { getDb } from '@/db/client';
import { enqueueMany } from '@/db/outbox';
import { SYNC_TABLES, q } from '@/db/syncSchema';
import { getSupabase } from '@/services/supabase';

export type ClaimSituation = {
  /** Dogs on this phone that belong to no account yet. */
  unclaimed: { id: string; name: string }[];
  /** Dogs already in the account being signed into. */
  inAccount: { id: string; name: string }[];
  /** Total unclaimed rows across every table — what the owner stands to lose. */
  unclaimedRowCount: number;
  /**
   * True when the owner must be asked. Claiming silently is only safe when
   * there is nothing to merge INTO.
   */
  needsDecision: boolean;
};

/**
 * Work out what the owner is about to be asked, without changing anything.
 *
 * Call this after a successful sign-in and before the first sync.
 */
export async function describeClaim(): Promise<ClaimSituation> {
  const db = await getDb();

  const unclaimed = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM dogs
      WHERE user_id IS NULL AND deleted_at IS NULL ORDER BY created_at ASC`,
  );

  let unclaimedRowCount = 0;
  for (const spec of SYNC_TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${q(spec.table)}
        WHERE user_id IS NULL AND deleted_at IS NULL`,
    );
    unclaimedRowCount += row?.n ?? 0;
  }

  // The account's existing dogs come from the server, not from local SQLite:
  // this device may never have seen them, and that is exactly the case the
  // prompt has to describe.
  const inAccount: { id: string; name: string }[] = [];
  const supabase = getSupabase();
  if (supabase) {
    const { data } = await supabase
      .from('dogs')
      .select('id, name')
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    for (const row of data ?? []) {
      inAccount.push({ id: row.id as string, name: row.name as string });
    }
  }

  return {
    unclaimed,
    inAccount,
    unclaimedRowCount,
    // Nothing to claim, or an empty account to claim into: no question worth
    // asking. Only a genuine merge of two populated sets needs a decision.
    needsDecision: unclaimed.length > 0 && inAccount.length > 0,
  };
}

/**
 * Hand every unclaimed row to this account and queue it all for push.
 *
 * One transaction. A half-claimed database — the dog assigned but its seizures
 * still ownerless — would show the owner a dog with no history, which is a
 * worse state than either end of the operation.
 */
export async function claimLocalData(userId: string): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  let claimed = 0;

  await db.withTransactionAsync(async () => {
    for (const spec of SYNC_TABLES) {
      const rows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM ${q(spec.table)} WHERE user_id IS NULL`,
      );
      if (rows.length === 0) continue;

      // updated_at moves so these rows win against anything stale the account
      // already holds for the same id — which cannot normally happen, but a
      // restored backup makes it possible.
      await db.runAsync(
        `UPDATE ${q(spec.table)} SET user_id = ?, updated_at = ? WHERE user_id IS NULL`,
        [userId, now],
      );

      await enqueueMany(db, spec.table, rows.map((r) => r.id), 'upsert', now);
      claimed += rows.length;
    }
  });

  console.log(`[sync] claimed ${claimed} local rows for ${userId}`);
  return claimed;
}

/**
 * The destructive branch: keep only what is in the account.
 *
 * ── WHAT THIS ACTUALLY DOES, AND WHY IT IS A HARD DELETE ──────────────
 *
 * These rows have never been on any server. They have no id anywhere else, no
 * tombstone would ever be delivered to anyone, and nothing can conflict with
 * them. A tombstone here would be a delete instruction addressed to a row no
 * other device has ever heard of — so the rows are simply removed.
 *
 * Video FILES are returned rather than deleted, so the caller can remove them
 * from disk. They are the one thing here that exists nowhere else.
 *
 * The UI must put a second confirmation in front of this.
 */
export async function discardUnclaimedData(): Promise<{
  deletedRows: number;
  orphanedFiles: { fileUri: string; thumbUri: string }[];
}> {
  const db = await getDb();
  let deletedRows = 0;

  const orphanedFiles = await db.getAllAsync<{
    file_uri: string;
    thumb_uri: string;
  }>(
    `SELECT f.file_uri, f.thumb_uri
       FROM video_files f
       JOIN videos v ON v.id = f.video_id
      WHERE v.user_id IS NULL`,
  );

  await db.withTransactionAsync(async () => {
    // Children before parents: these are real DELETEs, so the foreign keys are
    // live and would cascade unpredictably if a parent went first.
    for (const spec of [...SYNC_TABLES].reverse()) {
      const result = await db.runAsync(
        `DELETE FROM ${q(spec.table)} WHERE user_id IS NULL`,
      );
      deletedRows += result.changes ?? 0;
    }

    // Any queued intent for those rows is meaningless now.
    await db.runAsync(
      `DELETE FROM outbox WHERE row_id NOT IN (
         SELECT id FROM dogs UNION SELECT id FROM seizures
         UNION SELECT id FROM videos UNION SELECT id FROM seizure_edits
         UNION SELECT id FROM medications UNION SELECT id FROM medication_reminders
         UNION SELECT id FROM medication_doses UNION SELECT id FROM daily_checkins
         UNION SELECT id FROM meals
       )`,
    );

    await db.runAsync(
      `DELETE FROM video_files WHERE video_id NOT IN (SELECT id FROM videos)`,
    );
  });

  return {
    deletedRows,
    orphanedFiles: orphanedFiles.map((f) => ({
      fileUri: f.file_uri,
      thumbUri: f.thumb_uri ?? '',
    })),
  };
}
