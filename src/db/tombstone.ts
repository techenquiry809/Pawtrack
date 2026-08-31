/**
 * Soft deletes, and the subtree walk that makes them correct.
 *
 * ── WHY DELETES BECAME UPDATES ────────────────────────────────────────
 *
 * A hard DELETE cannot be replicated. Device A deletes a seizure; device B has
 * never heard of the deletion, still holds the row, and pushes it on its next
 * sync — helpfully restoring it. The only way to communicate "this is gone" is
 * to keep a row that says so.
 *
 * ── THE PART THAT IS EASY TO GET WRONG ────────────────────────────────
 *
 * The old code relied on `ON DELETE CASCADE` to clear a seizure's videos and
 * edit rows, and a dog's entire history. Foreign keys fire on a real DELETE.
 * They do not fire on an UPDATE that happens to set a column called
 * deleted_at.
 *
 * So the moment deletes became soft, every cascade in the schema silently
 * stopped working. Tombstoning a seizure would leave its videos live: they
 * sync to another device as orphans attached to a record that device has
 * already hidden, and they keep a "video exists" badge on a seizure that no
 * longer does. Tombstoning a dog would leave that dog's ENTIRE history live
 * and unreachable.
 *
 * This module walks the subtree explicitly, from src/db/syncSchema.ts's
 * TOMBSTONE_CHILDREN, which is derived from the same parent declarations the
 * sync order uses — so the two cannot disagree.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from './client';
import { enqueue } from './outbox';
import { TOMBSTONE_CHILDREN, q, syncSpec } from './syncSchema';

/**
 * Mark a row and everything beneath it as deleted, queueing each for push.
 *
 * Runs the whole subtree in ONE transaction. A partially tombstoned dog — some
 * seizures gone, others not — is a worse state than either outcome, and it is
 * exactly what an interrupted multi-statement walk would leave behind.
 *
 * Idempotent: rows already carrying a deleted_at are skipped, so a re-delete
 * costs one indexed lookup per table and changes nothing. That matters because
 * a dog reaches its videos twice — directly by dog_id and again through
 * seizures — and both paths are correct.
 */
export async function tombstone(
  table: string,
  rowId: string,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await tombstoneWithin(db, table, [rowId], now);
  });
}

/**
 * The same walk, for a caller that is ALREADY inside a transaction.
 *
 * Exported separately rather than detected, because nesting
 * `withTransactionAsync` on one connection is not a transaction — it is a
 * silent no-op on the inner call, and the atomicity you thought you had is
 * gone.
 */
export async function tombstoneWithin(
  db: SQLiteDatabase,
  table: string,
  rowIds: string[],
  now: number = Date.now(),
): Promise<void> {
  if (rowIds.length === 0) return;

  // Validates the table name and throws on anything not in the manifest, which
  // is what makes the interpolation below safe.
  syncSpec(table);

  const holes = rowIds.map(() => '?').join(',');

  // Only rows that are still live. Re-tombstoning would bump updated_at and
  // re-queue a push for a row the server already has as deleted.
  const live = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM ${q(table)} WHERE id IN (${holes}) AND deleted_at IS NULL`,
    rowIds,
  );
  if (live.length === 0) return;

  const liveIds = live.map((r) => r.id);
  const liveHoles = liveIds.map(() => '?').join(',');

  // updated_at moves with deleted_at. Last-write-wins compares updated_at, and
  // a tombstone that kept the old value would lose to any concurrent edit
  // made on another device before the delete.
  await db.runAsync(
    `UPDATE ${q(table)} SET deleted_at = ?, updated_at = ?
      WHERE id IN (${liveHoles})`,
    [now, now, ...liveIds],
  );

  for (const id of liveIds) {
    await enqueue(db, table, id, 'delete', now);
  }

  // Depth is bounded by the schema (dog → seizure → video is the deepest
  // path), so recursion is safe and reads better than an explicit queue.
  for (const child of TOMBSTONE_CHILDREN[table] ?? []) {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM ${q(child.table)}
        WHERE ${q(child.localColumn)} IN (${liveHoles}) AND deleted_at IS NULL`,
      liveIds,
    );
    if (rows.length > 0) {
      await tombstoneWithin(db, child.table, rows.map((r) => r.id), now);
    }
  }
}

/**
 * Every video file the caller must now delete from disk.
 *
 * ── THE DELETION ASYMMETRY, DECIDED DELIBERATELY ──────────────────────
 *
 * Deleting a video ROW is a clinical edit and syncs: the record of "a
 * recording exists" is gone everywhere. Deleting a FILE is device-local
 * housekeeping and does not sync.
 *
 * So removing a video on device A tombstones the row everywhere, and every
 * device drops its own local copy when it sees that tombstone. But a device
 * that frees up space by deleting local files does not destroy the record for
 * everyone else.
 *
 * Returned rather than deleted here because this layer never touches the
 * filesystem — see the rule at the top of src/db/videoRepo.ts. A failed file
 * delete should leave an orphaned file, not a half-deleted record.
 */
export async function collectOrphanedFiles(
  videoIds: string[],
): Promise<{ videoId: string; fileUri: string; thumbUri: string }[]> {
  if (videoIds.length === 0) return [];
  const db = await getDb();
  const holes = videoIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{
    video_id: string;
    file_uri: string;
    thumb_uri: string;
  }>(
    `SELECT video_id, file_uri, thumb_uri FROM video_files
      WHERE video_id IN (${holes})`,
    videoIds,
  );
  return rows.map((r) => ({
    videoId: r.video_id,
    fileUri: r.file_uri,
    thumbUri: r.thumb_uri ?? '',
  }));
}

/** Forget where a video's bytes were. Does not touch the clinical row. */
export async function forgetVideoFiles(videoIds: string[]): Promise<void> {
  if (videoIds.length === 0) return;
  const db = await getDb();
  const holes = videoIds.map(() => '?').join(',');
  await db.runAsync(
    `DELETE FROM video_files WHERE video_id IN (${holes})`,
    videoIds,
  );
}
