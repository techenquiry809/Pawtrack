/**
 * Adopting records that were written before accounts were required.
 *
 * ── WHAT THIS IS NOW, AND WHAT IT USED TO BE ──────────────────────────
 *
 * It used to be a decision. The app could be used with no account at all, so
 * signing in could find a phone holding one dog's history and an account
 * holding another's, and the owner had to be asked which to keep. That screen,
 * its "keep only what's in my account" branch, and the banner that announced a
 * silent merge are all gone, because the situation they existed for cannot
 * happen any more: an account is required before a single record can be
 * written.
 *
 * What remains is a one-way UPGRADE PATH. Anyone who used the app before this
 * change has rows on their phone with `user_id IS NULL`, and reads are fenced
 * by owner (src/db/scope.ts) — so the moment sign-in became compulsory, those
 * rows stopped matching any query and their dog's entire history would appear
 * to have been deleted. It has not been; it is simply unowned. This hands it
 * to the first account that signs in on that phone.
 *
 * ── WHY THIS IS SAFE TO DO SILENTLY NOW, HAVING NOT BEEN BEFORE ───────
 *
 * The old flow asked first because a merge could combine two ANIMALS'
 * histories irreversibly. That risk came from the account already holding
 * dogs of its own while the phone held different ones.
 *
 * It cannot arise here. These rows predate the requirement to sign in, so they
 * were written by whoever was holding this phone, and the account signing in
 * on that same phone is that person. There is no second party to confuse them
 * with, and asking would be a question about a situation that no longer
 * exists.
 *
 * ── WHEN IT STOPS RUNNING ─────────────────────────────────────────────
 *
 * On its own, and permanently, once there is nothing left unowned — which for
 * every new install is from the very first launch. The count query below is
 * indexed and returns zero immediately in that case.
 */

import { getDb } from '@/db/client';
import { enqueueMany } from '@/db/outbox';
import { SYNC_TABLES, q } from '@/db/syncSchema';

export type AdoptionResult = {
  /** Rows handed to the account across every table. */
  rows: number;
  /** Names of the dogs those rows belong to. For logging, not for a prompt. */
  dogs: string[];
};

/**
 * Is there anything left over from before accounts were required?
 *
 * Split out so the common case — a normal install, nothing unowned — costs one
 * cheap count rather than opening a transaction over nine tables on every
 * single sign-in.
 */
export async function hasOrphanedLocalData(): Promise<boolean> {
  const db = await getDb();
  for (const spec of SYNC_TABLES) {
    // `SELECT 1 ... LIMIT 1`, not COUNT(*). This runs on every launch, and the
    // question is "is there at least one", not "how many" — COUNT would scan
    // every row of every table to answer something the first hit settles.
    const row = await db.getFirstAsync<{ one: number }>(
      `SELECT 1 AS one FROM ${q(spec.table)} WHERE user_id IS NULL LIMIT 1`,
    );
    if (row) return true;
  }
  return false;
}

/**
 * Hand every unowned row to this account and queue it all for push.
 *
 * One transaction. A half-adopted database — the dog assigned but its seizures
 * still unowned — would show the owner a dog with no history, which is a worse
 * state than either end of the operation.
 */
export async function adoptOrphanedLocalData(
  userId: string,
): Promise<AdoptionResult> {
  const db = await getDb();
  const now = Date.now();
  let claimed = 0;

  // Read before the UPDATE, while `user_id IS NULL` still selects them.
  const dogs = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM dogs WHERE user_id IS NULL AND deleted_at IS NULL
      ORDER BY created_at ASC`,
  );

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

      // The owner is passed EXPLICITLY rather than left to enqueue's default.
      // These entries are being handed to a specific account in the same
      // transaction that assigns the rows to it, and that account is the one
      // named here — not whatever a module-level store happens to hold by the
      // time the queue drains. See migration 13.
      await enqueueMany(db, spec.table, rows.map((r) => r.id), 'upsert', userId, now);
      claimed += rows.length;
    }
  });

  if (claimed > 0) {
    // The account id is deliberately NOT logged. This line ships in release
    // builds, and the device log is readable over adb / Console.app by anyone
    // with the phone — putting a stable identifier for the person who owns
    // these veterinary records into it buys nothing a count does not.
    console.log(`[sync] adopted ${claimed} pre-account rows`);
  }
  return { rows: claimed, dogs: dogs.map((d) => d.name) };
}
