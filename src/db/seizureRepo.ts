/**
 * Seizure repository — the only place in the app that writes seizure SQL.
 *
 * Screens call these functions. They never build queries themselves. If you
 * need a new query, add a named function here rather than exporting the db.
 */

import {
  getDb,
  uid,
  toSqlBool,
  fromSqlBool,
  toSqlJson,
  fromSqlObject,
  fromSqlArray,
} from './client';
import {
  SeizureFinalizeSchema,
  type Seizure,
  type SeizureContext,
  type SeizureFinalize,
  type SeizureWithVideos,
  type Video,
} from '@/types/domain';
import { resolveRecoveredDuration, type DurationConfidence } from '@/utils/clock';

const EMPTY_CONTEXT: SeizureContext = {
  food: '', sleep: '', exercise: '', medication: '',
  stress: '', environment: '', illness: '', exposure: '',
};

type SeizureRow = {
  id: string;
  dog_id: string;
  status: string;
  duration_confidence: string;
  last_touched_at: number | null;
  tz_offset_min: number | null;
  start: number;
  end: number | null;
  duration_sec: number;
  timing_confidence: string;
  retrospective: number;
  pre_ictal_obs: string;
  pre_ictal_note: string;
  ictal_obs: string;
  awareness: string | null;
  autonomic: string;
  position: string | null;
  post_behavior: string;
  severity_owner: string | null;
  recovery_start: number | null;
  recovery_end: number | null;
  recovery_sec: number | null;
  context_json: string;
  notes: string;
  time_since_prev_sec: number | null;
  created_at: number;
  updated_at: number;
};

function rowToSeizure(row: SeizureRow): Seizure {
  return {
    id: row.id,
    dogId: row.dog_id,
    status: row.status as Seizure['status'],
    durationConfidence: row.duration_confidence as Seizure['durationConfidence'],
    lastTouchedAt: row.last_touched_at,
    tzOffsetMin: row.tz_offset_min,
    start: row.start,
    end: row.end,
    durationSec: row.duration_sec,
    timingConfidence: row.timing_confidence as Seizure['timingConfidence'],
    retrospective: fromSqlBool(row.retrospective),
    preIctalObs: fromSqlArray<string>(row.pre_ictal_obs),
    preIctalNote: row.pre_ictal_note,
    ictalObs: fromSqlArray<string>(row.ictal_obs),
    awareness: row.awareness,
    autonomic: fromSqlArray<string>(row.autonomic),
    position: row.position,
    postBehavior: fromSqlArray<string>(row.post_behavior),
    severityOwner: row.severity_owner,
    recoveryStart: row.recovery_start,
    recoveryEnd: row.recovery_end,
    recoverySec: row.recovery_sec,
    context: fromSqlObject<SeizureContext>(row.context_json, EMPTY_CONTEXT),
    notes: row.notes,
    timeSincePrevSec: row.time_since_prev_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type VideoRow = {
  id: string;
  seizure_id: string;
  source: string;
  file_uri: string;
  timestamp: number;
  duration_sec: number | null;
  note: string;
};

const rowToVideo = (row: VideoRow): Video => ({
  id: row.id,
  seizureId: row.seizure_id,
  source: row.source as Video['source'],
  fileUri: row.file_uri,
  timestamp: row.timestamp,
  durationSec: row.duration_sec,
  note: row.note,
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */
/**
 * EVERY list, aggregate and export query below filters on this.
 *
 * A row is inserted the moment the owner taps Record, long before it is a
 * finished record. An `in_progress` row reaching a history list — or worse, a
 * vet report — is the exact failure the durability work exists to prevent.
 * `getSeizure(id)` is the one deliberate exception: it fetches by primary key
 * for the recovery flow, which must be able to see a partial row.
 */
const COMPLETE = "status = 'complete'";


export async function listSeizures(dogId: string): Promise<Seizure[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SeizureRow>(
    `SELECT * FROM seizures WHERE dog_id = ? AND ${COMPLETE} ORDER BY start DESC`,
    [dogId],
  );
  return rows.map(rowToSeizure);
}

export async function listSeizuresSince(
  dogId: string,
  sinceEpochMs: number,
): Promise<Seizure[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SeizureRow>(
    `SELECT * FROM seizures WHERE dog_id = ? AND start >= ? AND ${COMPLETE} ORDER BY start DESC`,
    [dogId, sinceEpochMs],
  );
  return rows.map(rowToSeizure);
}

export async function getSeizure(id: string): Promise<SeizureWithVideos | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SeizureRow>(
    'SELECT * FROM seizures WHERE id = ?',
    [id],
  );
  if (!row) return null;
  const videoRows = await db.getAllAsync<VideoRow>(
    'SELECT * FROM videos WHERE seizure_id = ? ORDER BY timestamp ASC',
    [id],
  );
  return { ...rowToSeizure(row), videos: videoRows.map(rowToVideo) };
}

/** Used to compute "time since previous seizure" and cluster detection. */
export async function getMostRecentSeizure(
  dogId: string,
  beforeEpochMs: number,
): Promise<Seizure | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SeizureRow>(
    `SELECT * FROM seizures WHERE dog_id = ? AND start < ? AND ${COMPLETE} ORDER BY start DESC LIMIT 1`,
    [dogId, beforeEpochMs],
  );
  return row ? rowToSeizure(row) : null;
}

/** How many seizures fall inside the cluster window ending at `atEpochMs`. */
export async function countSeizuresInWindow(
  dogId: string,
  atEpochMs: number,
  windowHours: number,
): Promise<number> {
  const db = await getDb();
  const windowStart = atEpochMs - windowHours * 3_600_000;
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM seizures WHERE dog_id = ? AND start >= ? AND start <= ? AND ${COMPLETE}`,
    [dogId, windowStart, atEpochMs],
  );
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Direct create of an already-finished record — the retrospective path, where
 * the owner logs a seizure after the fact. The live flow does NOT use this; it
 * goes through openSeizure/patchSeizure/finalizeSeizure so the row survives a
 * crash. Lifecycle columns are defaulted rather than demanded of the caller.
 */
export type NewSeizureInput = Omit<
  Seizure,
  | 'id' | 'createdAt' | 'updatedAt' | 'timeSincePrevSec'
  | 'status' | 'durationConfidence' | 'lastTouchedAt' | 'tzOffsetMin'
> & {
  durationConfidence?: DurationConfidence;
  tzOffsetMin?: number | null;
};

export async function createSeizure(input: NewSeizureInput): Promise<string> {
  const db = await getDb();
  const now = Date.now();
  const id = uid();

  const prev = await getMostRecentSeizure(input.dogId, input.start);
  const timeSincePrevSec = prev
    ? Math.round((input.start - prev.start) / 1000)
    : null;

  await db.runAsync(
    `INSERT INTO seizures (
      id, dog_id, start, end, duration_sec, timing_confidence, retrospective,
      pre_ictal_obs, pre_ictal_note, ictal_obs, awareness, autonomic, position,
      post_behavior, severity_owner, recovery_start, recovery_end, recovery_sec,
      context_json, notes, time_since_prev_sec,
      status, duration_confidence, last_touched_at, tz_offset_min,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'complete',?,?,?,?,?)`,
    [
      id, input.dogId, input.start, input.end, input.durationSec,
      input.timingConfidence, toSqlBool(input.retrospective),
      toSqlJson(input.preIctalObs), input.preIctalNote,
      toSqlJson(input.ictalObs), input.awareness,
      toSqlJson(input.autonomic), input.position,
      toSqlJson(input.postBehavior), input.severityOwner,
      input.recoveryStart, input.recoveryEnd, input.recoverySec,
      toSqlJson(input.context), input.notes,
      timeSincePrevSec,
      input.durationConfidence ?? 'unreliable', now,
      input.tzOffsetMin ?? -new Date(input.start).getTimezoneOffset(),
      now, now,
    ],
  );
  return id;
}

/* ------------------------------------------------------------------ */
/* Durable capture lifecycle                                           */
/* ------------------------------------------------------------------ */
/**
 * The row exists from the first tap. This is what makes a force-quit or an OS
 * memory kill mid-seizure survivable:
 *
 *   openSeizure()      first tap — row exists from here on
 *   patchSeizure()     every phase transition and observation change
 *   finalizeSeizure()  recovery screen — marks it complete and visible
 *
 *   findUnfinishedSeizure() / salvageSeizure() / discardSeizure()  crash path
 */

export type OpenSeizureInput = {
  dogId: string;
  startedAtUtc: number;
  tzOffsetMin: number;
  retrospective?: boolean;
};

/**
 * Insert immediately. The caller must not let this block the live screen from
 * rendering — a seizure in progress does not wait for our database. See the
 * degrade-never-block note in activeSeizureStore.
 */
export async function openSeizure(input: OpenSeizureInput): Promise<string> {
  const db = await getDb();
  const id = uid();
  const now = Date.now();

  await db.runAsync(
    `INSERT INTO seizures (
      id, dog_id, start, tz_offset_min, retrospective, timing_confidence,
      status, duration_confidence, last_touched_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,'exact','in_progress','unreliable',?,?,?)`,
    [
      id, input.dogId, input.startedAtUtc, input.tzOffsetMin,
      toSqlBool(input.retrospective ?? false), now, now, now,
    ],
  );
  return id;
}

/** Fields the live, post and recovery phases may write to an open row. */
export type SeizurePatch = Partial<
  Pick<
    Seizure,
    | 'end' | 'preIctalObs' | 'preIctalNote' | 'ictalObs' | 'awareness'
    | 'autonomic' | 'position' | 'postBehavior' | 'severityOwner'
    | 'recoveryStart' | 'recoveryEnd' | 'context' | 'notes'
    | 'timingConfidence'
  >
>;

const PATCH_COLUMNS: Record<keyof SeizurePatch, string> = {
  end: 'end',
  preIctalObs: 'pre_ictal_obs',
  preIctalNote: 'pre_ictal_note',
  ictalObs: 'ictal_obs',
  awareness: 'awareness',
  autonomic: 'autonomic',
  position: 'position',
  postBehavior: 'post_behavior',
  severityOwner: 'severity_owner',
  recoveryStart: 'recovery_start',
  recoveryEnd: 'recovery_end',
  context: 'context_json',
  notes: 'notes',
  timingConfidence: 'timing_confidence',
};

/**
 * Called on every phase transition and observation change. Touching
 * last_touched_at here is what lets crash recovery estimate an honest end time
 * instead of reporting the gap until the owner reopened the app.
 *
 * Deliberately does NOT write to seizure_edits: that audit trail records
 * post-hoc corrections a vet may want to see, and filling it with thirty rows
 * of live capture would bury the edits that matter.
 */
export async function patchSeizure(
  seizureId: string,
  patch: SeizurePatch,
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const column = PATCH_COLUMNS[key as keyof SeizurePatch];
    if (!column || value === undefined) continue;
    sets.push(`${column} = ?`);
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      values.push(toSqlJson(value));
    } else {
      values.push((value ?? null) as string | number | null);
    }
  }

  const now = Date.now();
  sets.push('last_touched_at = ?', 'updated_at = ?');
  values.push(now, now, seizureId);

  // The status guard means a finalized or abandoned row can never be mutated
  // by a late write from a screen that has not unmounted yet.
  await db.runAsync(
    `UPDATE seizures SET ${sets.join(', ')}
      WHERE id = ? AND status = 'in_progress'`,
    values,
  );
}

/**
 * The row becomes visible to history, analytics and exports only at this point.
 * Validation runs first and THROWS on a contradictory duration — the caller is
 * expected to offer the owner a discard rather than write a false figure.
 */
export async function finalizeSeizure(
  seizureId: string,
  input: SeizureFinalize,
  patch: SeizurePatch = {},
): Promise<void> {
  const value = SeizureFinalizeSchema.parse(input);
  const db = await getDb();
  const now = Date.now();

  if (Object.keys(patch).length > 0) await patchSeizure(seizureId, patch);

  const row = await db.getFirstAsync<{ dog_id: string; start: number }>(
    'SELECT dog_id, start FROM seizures WHERE id = ?',
    [seizureId],
  );

  // Cached at write time so history lists never need a second query. Computed
  // here rather than at open, because only now do we know this row is real.
  let timeSincePrevSec: number | null = null;
  if (row) {
    const prev = await getMostRecentSeizure(row.dog_id, row.start);
    if (prev) timeSincePrevSec = Math.round((row.start - prev.start) / 1000);
  }

  const recoverySec = await computeRecoverySec(seizureId);

  await db.runAsync(
    `UPDATE seizures
        SET duration_sec = ?, duration_confidence = ?, recovery_sec = ?,
            time_since_prev_sec = ?, status = 'complete',
            last_touched_at = ?, updated_at = ?
      WHERE id = ? AND status = 'in_progress'`,
    [
      value.durationSeconds ?? 0, value.durationConfidence, recoverySec,
      timeSincePrevSec, now, now, seizureId,
    ],
  );
}

async function computeRecoverySec(seizureId: string): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    recovery_start: number | null;
    recovery_end: number | null;
  }>('SELECT recovery_start, recovery_end FROM seizures WHERE id = ?', [seizureId]);
  if (!row?.recovery_start || !row.recovery_end) return null;
  return Math.max(0, Math.round((row.recovery_end - row.recovery_start) / 1000));
}

export type UnfinishedSeizure = {
  id: string;
  dogId: string;
  dogName: string | null;
  startedAtUtc: number;
  lastTouchedAt: number | null;
};

/**
 * The orphan lookup. Runs on launch and on every return to the foreground.
 *
 * LIMIT 1 is intentional — if two somehow exist we surface the most recent and
 * leave the older for the next pass, rather than throwing a queue of prompts at
 * someone who has just had a bad night.
 */
export async function findUnfinishedSeizure(): Promise<UnfinishedSeizure | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    id: string;
    dog_id: string;
    dog_name: string | null;
    start: number;
    last_touched_at: number | null;
  }>(
    `SELECT s.id, s.dog_id, d.name AS dog_name, s.start, s.last_touched_at
       FROM seizures s
       LEFT JOIN dogs d ON d.id = s.dog_id
      WHERE s.status = 'in_progress'
      ORDER BY s.start DESC
      LIMIT 1`,
  );
  if (!row) return null;
  return {
    id: row.id,
    dogId: row.dog_id,
    dogName: row.dog_name,
    startedAtUtc: row.start,
    lastTouchedAt: row.last_touched_at,
  };
}

/**
 * "Save what we have." Keeps the partial record and flags the duration as an
 * estimate so nothing downstream mistakes it for a measured figure.
 */
export async function salvageSeizure(seizure: UnfinishedSeizure): Promise<void> {
  const { durationSeconds, confidence } = resolveRecoveredDuration(
    seizure.startedAtUtc,
    seizure.lastTouchedAt,
  );
  const db = await getDb();
  const now = Date.now();

  const prev = await getMostRecentSeizure(seizure.dogId, seizure.startedAtUtc);
  const timeSincePrevSec = prev
    ? Math.round((seizure.startedAtUtc - prev.start) / 1000)
    : null;

  await db.runAsync(
    `UPDATE seizures
        SET duration_sec = ?, duration_confidence = ?, end = ?,
            time_since_prev_sec = ?, status = 'complete',
            last_touched_at = ?, updated_at = ?
      WHERE id = ? AND status = 'in_progress'`,
    [
      durationSeconds ?? 0, confidence, seizure.lastTouchedAt,
      timeSincePrevSec, now, now, seizure.id,
    ],
  );
}

/**
 * Explicit owner discard. Soft, not a DELETE — a 3am mis-tap should be
 * recoverable, and an abandoned row is also evidence when diagnosing why the
 * app died.
 */
export async function discardSeizure(seizureId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `UPDATE seizures SET status = 'abandoned', last_touched_at = ?, updated_at = ?
      WHERE id = ?`,
    [now, now, seizureId],
  );
}

/**
 * Partial update. Only the fields you pass are written, so a screen that edits
 * one section can't accidentally blank out another.
 *
 * `editSummary` is recorded in the audit trail — pass a human-readable note
 * like 'Changed end time' so the history is meaningful to a vet later.
 */
export async function updateSeizure(
  id: string,
  patch: Partial<Omit<Seizure, 'id' | 'dogId' | 'createdAt'>>,
  editSummary = 'Record edited',
): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  const columnMap: Record<string, string> = {
    start: 'start', end: 'end', durationSec: 'duration_sec',
    timingConfidence: 'timing_confidence', retrospective: 'retrospective',
    preIctalObs: 'pre_ictal_obs', preIctalNote: 'pre_ictal_note',
    ictalObs: 'ictal_obs', awareness: 'awareness', autonomic: 'autonomic',
    position: 'position', postBehavior: 'post_behavior',
    severityOwner: 'severity_owner', recoveryStart: 'recovery_start',
    recoveryEnd: 'recovery_end', recoverySec: 'recovery_sec',
    context: 'context_json', notes: 'notes',
    timeSincePrevSec: 'time_since_prev_sec',
  };

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const column = columnMap[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    if (typeof value === 'boolean') values.push(toSqlBool(value));
    else if (Array.isArray(value) || (value && typeof value === 'object')) {
      values.push(toSqlJson(value));
    } else values.push((value ?? null) as string | number | null);
  }

  if (sets.length === 0) return;

  sets.push('updated_at = ?');
  values.push(now, id);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE seizures SET ${sets.join(', ')} WHERE id = ?`,
      values,
    );
    await db.runAsync(
      'INSERT INTO seizure_edits (id, seizure_id, edited_at, summary) VALUES (?,?,?,?)',
      [uid(), id, now, editSummary],
    );
  });
}

export async function deleteSeizure(id: string): Promise<void> {
  const db = await getDb();
  // Videos and edit rows cascade automatically (see migrations, foreign keys).
  await db.runAsync('DELETE FROM seizures WHERE id = ?', [id]);
}

export async function getEditHistory(
  seizureId: string,
): Promise<{ editedAt: number; summary: string }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ edited_at: number; summary: string }>(
    'SELECT edited_at, summary FROM seizure_edits WHERE seizure_id = ? ORDER BY edited_at DESC',
    [seizureId],
  );
  return rows.map((r) => ({ editedAt: r.edited_at, summary: r.summary }));
}

/* ------------------------------------------------------------------ */
/* Videos                                                              */
/* ------------------------------------------------------------------ */

export async function attachVideo(
  video: Omit<Video, 'id'>,
): Promise<string> {
  const db = await getDb();
  const id = uid();
  await db.runAsync(
    `INSERT INTO videos (id, seizure_id, source, file_uri, timestamp, duration_sec, note)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id, video.seizureId, video.source, video.fileUri,
      video.timestamp, video.durationSec, video.note,
    ],
  );
  return id;
}

/**
 * Removes the DB row. Deleting the file on disk is the caller's job (see
 * services/videoStorage.ts) so this stays a pure data operation.
 */
export async function detachVideo(videoId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ file_uri: string }>(
    'SELECT file_uri FROM videos WHERE id = ?',
    [videoId],
  );
  await db.runAsync('DELETE FROM videos WHERE id = ?', [videoId]);
  return row?.file_uri ?? null;
}
