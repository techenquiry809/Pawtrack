/**
 * Pull — reading the account's history back down.
 *
 * ── THE CURSOR IS A SEQUENCE, NOT A TIMESTAMP ─────────────────────────
 *
 * Each table has a `sync_seq` stamped by a single global Postgres sequence,
 * and this device remembers the highest one it has seen. A timestamp cursor
 * would SKIP ROWS: two phones whose clocks differ by 40 seconds can produce a
 * row whose `now()` is already behind a cursor another device has advanced
 * past, and that row is then never seen again.
 *
 * This is the same refusal to trust a wall clock that src/utils/clock.ts makes
 * about seizure duration, applied to replication.
 *
 * ── PULL RUNS AFTER PUSH, ALWAYS ──────────────────────────────────────
 *
 * The worker pushes first. That matters: once a local edit has been pushed,
 * the server has already applied the conflict rules to it, so whatever comes
 * back is the resolved answer rather than something that might clobber an
 * edit this phone has not sent yet. The `pending` guard below is the belt to
 * that braces — see applyRow().
 */

import { getDb } from '@/db/client';
import {
  SYNC_TABLES,
  q,
  type SyncTableSpec,
} from '@/db/syncSchema';
import {
  getCursor,
  setCursor,
  lowestCursor,
  resetCursorsForUser,
} from '@/db/syncState';
import { getSupabase } from '@/services/supabase';

const PAGE = 500;

export type PullResult = {
  applied: number;
  /** Videos tombstoned by this pull; the caller deletes their local bytes. */
  removedVideoIds: string[];
  /** True when the cursor was behind the purge horizon and we started over. */
  fullResync: boolean;
};

/**
 * Whether this device can still catch up incrementally.
 *
 * Server tombstones are purged after a retention window. A device whose cursor
 * predates the purge never sees those deletions, and would push the deleted
 * rows back on its next sync — resurrecting records the owner removed. When
 * that has happened the only correct answer is to start over.
 *
 * Rare by construction: it takes a device that has not synced in 90 days.
 */
async function needsFullResync(owner: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('sync_meta')
    .select('tombstone_horizon_seq')
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;

  const horizon = Number(data.tombstone_horizon_seq ?? 0);
  if (horizon <= 0) return false;

  return (await lowestCursor(owner)) < horizon;
}

/**
 * Wipe ONE ACCOUNT'S synced rows and start that account from sequence zero.
 *
 * ── WHY THE OWNER FILTER IS NOT OPTIONAL ──────────────────────────────
 *
 * One phone can hold rows for more than one account (see db/scope.ts, which
 * is the whole reason every read is fenced). This used to delete by the
 * outbox guard alone — every row in every synced table, whoever it belonged
 * to — and then call the device-wide `resetCursors()`.
 *
 * The account being resynced re-downloads what it lost, so on that side the
 * damage repairs itself. The OTHER account's rows are not re-downloaded by
 * anything: nothing is signed in as them, their cursor is gone too, and the
 * next time they sign in their pull starts from zero and re-fetches from the
 * server — which sounds like a recovery and is not one for the rows the
 * server never had. Anything of theirs still queued in the outbox survived
 * on a `row_id` match, but a row of theirs that had already been pushed and
 * then edited offline was simply gone.
 *
 * It is scoped to `owner` now, and NULL-owner rows are left alone: those are
 * the pre-accounts rows that `adoptOrphanedLocalData` claims, and they exist
 * nowhere but this phone.
 *
 * `video_files` is deliberately untouched. It holds the location of bytes on
 * THIS phone, which no server round trip can restore — clearing it would turn
 * a routine catch-up into permanent loss of every recording on the device.
 *
 * The outbox is untouched too. Anything queued here has not reached the server
 * and must survive to be pushed after the resync.
 */
async function fullResync(owner: string): Promise<void> {
  console.warn('[sync] cursor is behind the tombstone horizon; full resync');
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    // Children first so foreign keys stay satisfied at every step.
    for (const spec of [...SYNC_TABLES].reverse()) {
      // Rows still queued for push have never reached the server; deleting
      // them here would lose them for good.
      await db.runAsync(
        `DELETE FROM ${q(spec.table)}
          WHERE user_id = ?
            AND id NOT IN (SELECT row_id FROM outbox WHERE table_name = ?)`,
        [owner, spec.table],
      );
    }
  });

  await resetCursorsForUser(owner);
}

/**
 * Apply one server row to local SQLite.
 *
 * Returns the row id when a video was tombstoned, so the caller can delete the
 * bytes this device is still holding.
 */
async function applyRow(
  spec: SyncTableSpec,
  row: Record<string, unknown>,
): Promise<{ removedVideo?: string }> {
  const db = await getDb();
  const id = row.id as string;
  const synced = Object.keys(spec.columns);

  /*
   * ── DEVICE-LOCAL COLUMNS STILL HAVE TO BE SUPPLIED ON INSERT ────────
   *
   * `spec.deviceLocal` names the columns that deliberately do not sync —
   * `videos.file_uri` and `thumb_uri`, because the bytes never leave the
   * phone. They were left out of the INSERT entirely, which is correct as a
   * statement about syncing and wrong as SQL: migration 9 moved the paths
   * into `video_files` and left these behind as dead columns, still declared
   * NOT NULL with no default. So the insert failed:
   *
   *     NOT NULL constraint failed: videos.file_uri
   *
   * and because a sync is one transaction, the failure took the entire pull
   * with it. Any account holding a video could not sync at all, on any
   * device — including the device that recorded it, as soon as its own rows
   * came back from the server. It stayed invisible only while the server had
   * no schema and the pull never returned a row.
   *
   * Empty string, not a real path: on the device that owns the bytes the
   * value is unused (videoRepo joins video_files for the path), and on any
   * other device there is no file, which is exactly what '' means to
   * `isLocal` in videoRepo.
   *
   * They are placed ONLY in the insert, never in the update assignments
   * below — a pull must never overwrite a path this device is holding.
   */
  const deviceLocal = Object.keys(spec.deviceLocal ?? {});
  const columns = [...synced, ...deviceLocal];

  const values = columns.map((column) => {
    if (!(column in spec.columns)) return '';
    const value = row[column];
    if (spec.columns[column] === 'bool') return value ? 1 : 0;
    return value ?? null;
  });

  const assignments = synced
    .filter((c) => c !== 'id')
    .map((c) => `${q(c)} = excluded.${q(c)}`)
    .join(', ');

  let removedVideo: string | undefined;

  await db.withTransactionAsync(async () => {
    // A pending outbox entry means this device holds an edit the server has
    // not seen. Overwriting it here would discard that edit silently. Skip:
    // the next push sends it, the server resolves it, and the pull after that
    // brings back the answer.
    //
    // A tombstone is the exception. Deletion is terminal and always wins —
    // a resurrected seizure record is worse than a lost edit.
    const incomingDeleted = row.deleted_at !== null && row.deleted_at !== undefined;
    if (!incomingDeleted) {
      const pending = await db.getFirstAsync<{ row_id: string }>(
        'SELECT row_id FROM outbox WHERE table_name = ? AND row_id = ?',
        [spec.table, id],
      );
      if (pending) return;
    }

    await db.runAsync(
      `INSERT INTO ${q(spec.table)} (${columns.map(q).join(', ')})
       VALUES (${columns.map(() => '?').join(',')})
       ON CONFLICT(id) DO UPDATE SET ${assignments}`,
      values as (string | number | null)[],
    );

    if (spec.table === 'videos' && incomingDeleted) {
      const held = await db.getFirstAsync<{ video_id: string }>(
        'SELECT video_id FROM video_files WHERE video_id = ?',
        [id],
      );
      if (held) removedVideo = id;
    }
  });

  return { removedVideo };
}

/**
 * One table, from THIS ACCOUNT's cursor to the end of the server's history.
 *
 * `owner` is threaded down from the session rather than read from module
 * state: the cursor it selects decides which rows are asked for, and a cursor
 * belonging to somebody else skips this account's history without erroring.
 * See migration 15.
 */
async function pullTable(owner: string, spec: SyncTableSpec): Promise<{
  applied: number;
  removedVideoIds: string[];
}> {
  const supabase = getSupabase();
  if (!supabase) return { applied: 0, removedVideoIds: [] };

  let applied = 0;
  const removedVideoIds: string[] = [];
  let cursor = await getCursor(owner, spec.table);

  // Bounded: 200 pages of 500 is 100k rows, far past any real account, and it
  // guarantees a server that keeps returning the same page cannot hang a sync.
  for (let page = 0; page < 200; page += 1) {
    const { data, error } = await supabase
      .from(spec.table)
      .select('*')
      .gt('sync_seq', cursor)
      .order('sync_seq', { ascending: true })
      .limit(PAGE);

    if (error) throw new Error(`[sync] pull ${spec.table} failed: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const { removedVideo } = await applyRow(spec, row);
      if (removedVideo) removedVideoIds.push(removedVideo);
      applied += 1;
      const seq = Number(row.sync_seq ?? 0);
      if (seq > cursor) cursor = seq;
    }

    // Advance after every page, not only at the end. A pull interrupted
    // halfway then resumes from where it got to instead of replaying.
    await setCursor(owner, spec.table, cursor);

    if (rows.length < PAGE) break;
  }

  return { applied, removedVideoIds };
}

/**
 * Pull every table, parents before children.
 *
 * The order is not an optimisation: a video arriving before its seizure
 * violates a foreign key and takes the page down with it.
 */
export async function pullAll(): Promise<PullResult> {
  const supabase = getSupabase();
  if (!supabase) return { applied: 0, removedVideoIds: [], fullResync: false };

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { applied: 0, removedVideoIds: [], fullResync: false };
  }
  const owner = sessionData.session.user.id;

  let didFullResync = false;
  if (await needsFullResync(owner)) {
    await fullResync(owner);
    didFullResync = true;
  }

  let applied = 0;
  const removedVideoIds: string[] = [];

  for (const spec of SYNC_TABLES) {
    const result = await pullTable(owner, spec);
    applied += result.applied;
    removedVideoIds.push(...result.removedVideoIds);
  }

  return { applied, removedVideoIds, fullResync: didFullResync };
}
