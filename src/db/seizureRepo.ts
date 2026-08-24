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
  fromSqlJson,
} from './client';
import type {
  Seizure,
  SeizureContext,
  SeizureWithVideos,
  Video,
} from '@/types/domain';

const EMPTY_CONTEXT: SeizureContext = {
  food: '', sleep: '', exercise: '', medication: '',
  stress: '', environment: '', illness: '', exposure: '',
};

type SeizureRow = {
  id: string;
  dog_id: string;
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
    start: row.start,
    end: row.end,
    durationSec: row.duration_sec,
    timingConfidence: row.timing_confidence as Seizure['timingConfidence'],
    retrospective: fromSqlBool(row.retrospective),
    preIctalObs: fromSqlJson<string[]>(row.pre_ictal_obs, []),
    preIctalNote: row.pre_ictal_note,
    ictalObs: fromSqlJson<string[]>(row.ictal_obs, []),
    awareness: row.awareness,
    autonomic: fromSqlJson<string[]>(row.autonomic, []),
    position: row.position,
    postBehavior: fromSqlJson<string[]>(row.post_behavior, []),
    severityOwner: row.severity_owner,
    recoveryStart: row.recovery_start,
    recoveryEnd: row.recovery_end,
    recoverySec: row.recovery_sec,
    context: fromSqlJson<SeizureContext>(row.context_json, EMPTY_CONTEXT),
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

export async function listSeizures(dogId: string): Promise<Seizure[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SeizureRow>(
    'SELECT * FROM seizures WHERE dog_id = ? ORDER BY start DESC',
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
    'SELECT * FROM seizures WHERE dog_id = ? AND start >= ? ORDER BY start DESC',
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
    'SELECT * FROM seizures WHERE dog_id = ? AND start < ? ORDER BY start DESC LIMIT 1',
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
    'SELECT COUNT(*) AS n FROM seizures WHERE dog_id = ? AND start >= ? AND start <= ?',
    [dogId, windowStart, atEpochMs],
  );
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export type NewSeizureInput = Omit<
  Seizure,
  'id' | 'createdAt' | 'updatedAt' | 'timeSincePrevSec'
>;

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
      context_json, notes, time_since_prev_sec, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.dogId, input.start, input.end, input.durationSec,
      input.timingConfidence, toSqlBool(input.retrospective),
      toSqlJson(input.preIctalObs), input.preIctalNote,
      toSqlJson(input.ictalObs), input.awareness,
      toSqlJson(input.autonomic), input.position,
      toSqlJson(input.postBehavior), input.severityOwner,
      input.recoveryStart, input.recoveryEnd, input.recoverySec,
      toSqlJson(input.context), input.notes,
      timeSincePrevSec, now, now,
    ],
  );
  return id;
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
