/**
 * Removing data from THIS phone, and deleting the account entirely.
 *
 * ── THE DISTINCTION THAT MATTERS ──────────────────────────────────────
 *
 *   Sign out                   changes nothing about the data
 *   Remove from this phone     deletes local rows AND local video files
 *   Delete account             the above, everywhere, permanently
 *
 * Sign-out deliberately does not wipe. Every row carries a user_id and reads
 * filter on the active session, so a different person signing in on the same
 * phone sees their own data while the first user's records survive for when
 * they sign back in. Wiping on sign-out would also destroy an undrained
 * outbox — records that exist nowhere else yet.
 *
 * The middle option is for genuinely handing the device on, and it is the one
 * that must delete the FILES too. Video bytes never leave the phone by design,
 * so a "removal" that left them behind would leave the whole recording archive
 * of a dog's seizures on a device being given away.
 */

import { getDb } from '@/db/client';
import { SYNC_TABLES, q } from '@/db/syncSchema';
import { resetCursors } from '@/db/syncState';
import { deleteVideoFile } from '@/services/videoService';
import { getSupabase } from '@/services/supabase';

export type WipeResult = { deletedRows: number; deletedFiles: number };

/**
 * Delete one account's rows and video files from this device.
 *
 * Hard deletes, not tombstones. A tombstone is a message to other devices
 * saying "this record is gone"; that is emphatically NOT what is meant here.
 * The records still exist in the account and on every other device — this
 * phone is simply no longer holding a copy. Tombstoning would propagate the
 * removal and destroy the data everywhere, which is the opposite of the intent.
 */
export async function removeAccountDataFromDevice(
  userId: string,
): Promise<WipeResult> {
  const db = await getDb();
  let deletedRows = 0;
  let deletedFiles = 0;

  // Collect file paths BEFORE the rows go, or there is nothing left to join on.
  const files = await db.getAllAsync<{ file_uri: string; thumb_uri: string }>(
    `SELECT f.file_uri, f.thumb_uri
       FROM video_files f
       JOIN videos v ON v.id = f.video_id
      WHERE v.user_id = ?`,
    [userId],
  );

  await db.withTransactionAsync(async () => {
    for (const spec of [...SYNC_TABLES].reverse()) {
      const result = await db.runAsync(
        `DELETE FROM ${q(spec.table)} WHERE user_id = ?`,
        [userId],
      );
      deletedRows += result.changes ?? 0;
    }

    await db.runAsync(
      'DELETE FROM video_files WHERE video_id NOT IN (SELECT id FROM videos)',
    );
    // Queued intents for rows that no longer exist here.
    await db.runAsync(
      `DELETE FROM outbox WHERE row_id NOT IN (
         SELECT id FROM dogs UNION SELECT id FROM seizures
         UNION SELECT id FROM videos UNION SELECT id FROM seizure_edits
         UNION SELECT id FROM medications UNION SELECT id FROM medication_reminders
         UNION SELECT id FROM medication_doses UNION SELECT id FROM daily_checkins
         UNION SELECT id FROM meals
       )`,
    );
  });

  // Files last. A failure here leaves an orphaned file rather than a row
  // pointing at bytes that are gone — the cheaper of the two failures, and the
  // same rule the repositories follow.
  for (const file of files) {
    if (file.file_uri) {
      deleteVideoFile(file.file_uri);
      deletedFiles += 1;
    }
    if (file.thumb_uri) deleteVideoFile(file.thumb_uri);
  }

  // The next sign-in on this device starts from the beginning of history.
  await resetCursors();

  return { deletedRows, deletedFiles };
}

/**
 * Delete the account and everything in it, everywhere.
 *
 * Server side is one RPC — every user_id column cascades from auth.users. The
 * local wipe is NOT optional and NOT a nicety: the video files are the one
 * part of this dataset that exists nowhere but the phone, so deleting the
 * account without deleting them would leave the recordings behind on a device
 * whose owner has just asked for all of it to be gone.
 */
export async function deleteAccount(userId: string): Promise<WipeResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Accounts are not configured in this build.');

  // Sign the account's OTHER devices out first, while there is still a user to
  // do it on behalf of. Deleting the auth.users row revokes nothing by itself:
  // Supabase access tokens are stateless JWTs that stay valid until they
  // expire, so a phone that was mid-session keeps a working token for up to an
  // hour afterwards.
  //
  // This is best-effort and deliberately not fatal. Even if it fails, the
  // window is not a data-exposure one — every row is removed by the cascade
  // from auth.users, so a lingering token authenticates as a user who owns
  // nothing and every query returns empty. Ordering matters though: this has
  // to happen BEFORE the delete, because afterwards there is no session left
  // to authorise it.
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
  if (signOutError) {
    console.warn('[account] could not sign out other devices', signOutError.message);
  }

  const { error } = await supabase.rpc('delete_own_account');
  if (error) throw new Error(`Could not delete the account: ${error.message}`);

  const result = await removeAccountDataFromDevice(userId);

  // Clear this device's session last, so the app is not sitting on a token for
  // a user that no longer exists.
  await supabase.auth.signOut({ scope: 'local' });

  return result;
}
