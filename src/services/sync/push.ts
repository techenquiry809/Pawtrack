/**
 * Push — draining the outbox into Supabase.
 *
 * ── WHAT GETS SENT ────────────────────────────────────────────────────
 *
 * The row's CURRENT state, not a diff of what changed.
 *
 * Diffs need ordered, exactly-once delivery to be correct. Current-state
 * upserts are idempotent, and idempotent is what survives a retry when the
 * train goes into a tunnel halfway through the request. If the same row is
 * pushed three times the account ends up in the same place.
 *
 * ── ONE REQUEST, NOT ONE PER ROW ──────────────────────────────────────
 *
 * Everything goes through a single `sync_push` RPC. A user coming back from a
 * week somewhere with no signal, holding 300 queued rows, makes one call. That
 * function body is also one Postgres transaction, which is what stops a device
 * revoked mid-sync from leaving half a batch behind.
 */

import { getDb } from '@/db/client';
import * as outbox from '@/db/outbox';
import {
  PUSH_EXCLUDED_COLUMNS,
  SYNC_TABLES,
  q,
  syncSpec,
  type SyncTableSpec,
} from '@/db/syncSchema';
import { getDeviceId } from '@/db/syncState';
import { getSupabase } from '@/services/supabase';

export type PushResult = {
  /** Rows accepted by the server this run. */
  pushed: number;
  /** Rows still queued after this run. */
  remaining: number;
  /** Natural-key collisions the server resolved onto an existing row. */
  remapped: number;
};

type Remap = { table: string; sent_id: string; id: string };

const BATCH = 200;

/**
 * Turn a local SQLite row into the JSON the server expects.
 *
 * Only two transformations happen, and both are declared in the manifest
 * rather than guessed from the value:
 *
 *   - boolean columns go 0/1 → true/false, because SQLite has no boolean and
 *     Postgres does.
 *   - user_id is dropped. The server sets it from auth.uid(); sending it is at
 *     best redundant and at worst reads as an attempt to write into another
 *     account, which RLS rejects — failing the whole batch for nothing.
 *
 * Everything else passes through untouched, JSON columns included. They are
 * TEXT on both sides precisely so nothing reformats them in transit.
 */
function serialize(spec: SyncTableSpec, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, type] of Object.entries(spec.columns)) {
    if (PUSH_EXCLUDED_COLUMNS.has(column)) continue;
    const value = row[column];
    out[column] = type === 'bool' ? value === 1 || value === true : value ?? null;
  }
  return out;
}

/**
 * Drain one batch.
 *
 * Returns without doing anything when there is no session or no client — a
 * build with no Supabase config, or a signed-out user, still queues writes
 * locally and simply never sends them. That is a working app, not an error.
 */
export async function pushOnce(): Promise<PushResult> {
  const supabase = getSupabase();
  if (!supabase) return { pushed: 0, remaining: 0, remapped: 0 };

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { pushed: 0, remaining: 0, remapped: 0 };

  const db = await getDb();
  const batch = await outbox.peek(db, BATCH);
  if (batch.length === 0) return { pushed: 0, remaining: 0, remapped: 0 };

  const byTable = new Map<string, typeof batch>();
  for (const entry of batch) {
    const list = byTable.get(entry.tableName);
    if (list) list.push(entry);
    else byTable.set(entry.tableName, [entry]);
  }

  const tables: Record<string, { op: string; row: Record<string, unknown> }[]> = {};
  const settled: number[] = [];

  // SYNC_TABLES order is FK order, so a parent is always serialized — and
  // therefore applied — before its children.
  for (const spec of SYNC_TABLES) {
    const entries = byTable.get(spec.table);
    if (!entries || entries.length === 0) continue;

    const ids = entries.map((e) => e.rowId);
    const holes = ids.map(() => '?').join(',');

    // Read from the BASE table, not the _live view: a tombstone is exactly
    // what we are here to deliver, and the view would hide it.
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT ${Object.keys(spec.columns).map(q).join(', ')}
         FROM ${q(spec.table)} WHERE id IN (${holes})`,
      ids,
    );
    const byId = new Map(rows.map((r) => [r.id as string, r]));

    const payloadRows: { op: string; row: Record<string, unknown> }[] = [];
    for (const entry of entries) {
      const row = byId.get(entry.rowId);

      // Queued but gone. Nothing to send and nothing to retry — drop the
      // entry rather than letting it fail forever.
      if (!row) {
        settled.push(entry.id);
        continue;
      }

      // An orphan whose parent never resolved. The server's foreign keys would
      // reject it and take the whole batch down with it, so it is held back:
      // the row stays queued and will go out once its parent exists.
      const needsDog = 'dog_id' in spec.columns;
      if (needsDog && !row.dog_id) {
        console.warn(`[sync] ${spec.table}/${entry.rowId} has no dog_id; holding`);
        continue;
      }

      payloadRows.push({ op: entry.op, row: serialize(spec, row) });
    }

    if (payloadRows.length > 0) tables[spec.table] = payloadRows;
  }

  const sentEntryIds = batch
    .filter((e) => !settled.includes(e.id))
    .filter((e) => tables[e.tableName]?.some((r) => r.row.id === e.rowId))
    .map((e) => e.id);

  if (Object.keys(tables).length === 0) {
    await outbox.clear(db, settled);
    return {
      pushed: 0,
      remaining: await outbox.pendingCount(db),
      remapped: 0,
    };
  }

  const deviceId = await getDeviceId();
  const { data, error } = await supabase.rpc('sync_push', {
    payload: { device_id: deviceId, tables },
  });

  if (error) {
    // Keep every entry. A queued seizure is never dropped because a push
    // failed — the sign-out warning and the devices screen surface a stuck
    // outbox to the owner instead of silently discarding it.
    await outbox.recordFailure(db, sentEntryIds, error.message);
    throw new Error(`[sync] push failed: ${error.message}`);
  }

  const remaps = ((data as { remaps?: Remap[] } | null)?.remaps ?? []) as Remap[];
  for (const remap of remaps) await applyRemap(remap);

  await outbox.clear(db, [...settled, ...sentEntryIds]);

  return {
    pushed: sentEntryIds.length,
    remaining: await outbox.pendingCount(db),
    remapped: remaps.length,
  };
}

/**
 * Collapse a local row that lost a natural-key race.
 *
 * ── THE SITUATION ─────────────────────────────────────────────────────
 *
 * Two phones, both offline, both record a check-in for the same dog on the
 * same local day. They generate different ids for what is, clinically, one
 * check-in. Whichever reaches the server first owns the row; the second is
 * told the canonical id.
 *
 * Left unhandled, that device keeps its own row forever and the owner sees the
 * same day twice — which for the analytics control dataset is worse than
 * cosmetic, because a duplicated day double-counts.
 *
 * Only check-ins and doses can hit this, and neither has children, so
 * rewriting the primary key is safe. Nothing references these rows.
 */
async function applyRemap(remap: Remap): Promise<void> {
  const spec = syncSpec(remap.table);
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM ${q(spec.table)} WHERE id = ?`,
      [remap.id],
    );

    if (existing) {
      // The canonical row is already here — a pull brought it. Our duplicate
      // is redundant; drop it outright rather than tombstoning, because it
      // never existed on the server and a tombstone would be a delete
      // instruction for a row nothing else has ever seen.
      await db.runAsync(`DELETE FROM ${q(spec.table)} WHERE id = ?`, [remap.sent_id]);
    } else {
      await db.runAsync(
        `UPDATE ${q(spec.table)} SET id = ? WHERE id = ?`,
        [remap.id, remap.sent_id],
      );
    }

    await db.runAsync(
      'DELETE FROM outbox WHERE table_name = ? AND row_id = ?',
      [remap.table, remap.sent_id],
    );
  });

  console.warn(
    `[sync] ${remap.table}: local row ${remap.sent_id} merged into ${remap.id}`,
  );
}

/** Drain until the queue is empty or a batch fails. */
export async function pushAll(): Promise<PushResult> {
  let pushed = 0;
  let remapped = 0;
  let remaining = 0;

  // Bounded so a row the server keeps accepting-but-not-clearing cannot spin
  // forever. Twenty batches is 4000 rows, far past any real backlog.
  for (let i = 0; i < 20; i += 1) {
    const result = await pushOnce();
    pushed += result.pushed;
    remapped += result.remapped;
    remaining = result.remaining;
    if (result.pushed === 0 || result.remaining === 0) break;
  }

  return { pushed, remaining, remapped };
}
