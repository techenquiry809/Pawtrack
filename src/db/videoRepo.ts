/**
 * Video repository — the only place in the app that writes video SQL.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM seizureRepo ──────────────────
 *
 * The videos table used to be owned by seizureRepo, which was right while a
 * video was only ever a child of the seizure you were already looking at. The
 * gallery changed that: it reads videos across a whole dog, newest first,
 * joined back to their seizure for context. That is a different access pattern
 * with a different shape, and bolting it onto a 600-line seizure repository
 * would have buried it.
 *
 * seizureRepo re-exports attachVideo/detachVideo from here so existing callers
 * keep working and the videos table still has exactly ONE owner.
 *
 * ── THE RULE THAT MATTERS ─────────────────────────────────────────────
 *
 * This file never touches the filesystem. It writes and deletes rows; the
 * caller deletes bytes (see services/videoService.ts). Keeping them apart is
 * what lets a failed file delete leave an orphaned file rather than a
 * half-deleted record, which is the cheaper of the two failures.
 */

import { getDb, uid } from './client';
import type {
  CaptureConfidence,
  GalleryEntry,
  Video,
  VideoSource,
} from '@/types/domain';
import type { DurationConfidence } from '@/utils/clock';

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

type VideoRow = {
  id: string;
  seizure_id: string;
  source: string;
  file_uri: string;
  timestamp: number;
  imported_at: number;
  capture_confidence: string;
  thumb_uri: string;
  duration_sec: number | null;
  note: string;
};

const COLUMNS = `
  id, seizure_id, source, file_uri, timestamp, imported_at,
  capture_confidence, thumb_uri, duration_sec, note
`;

function rowToVideo(row: VideoRow): Video {
  return {
    id: row.id,
    seizureId: row.seizure_id,
    source: row.source as VideoSource,
    fileUri: row.file_uri,
    timestamp: row.timestamp,
    importedAt: row.imported_at,
    captureConfidence: row.capture_confidence as CaptureConfidence,
    thumbUri: row.thumb_uri,
    durationSec: row.duration_sec,
    note: row.note,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Every video on one seizure, oldest first — the order they were filmed. */
export async function listForSeizure(seizureId: string): Promise<Video[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VideoRow>(
    `SELECT ${COLUMNS} FROM videos WHERE seizure_id = ? ORDER BY timestamp ASC`,
    [seizureId],
  );
  return rows.map(rowToVideo);
}

export async function getVideo(videoId: string): Promise<Video | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VideoRow>(
    `SELECT ${COLUMNS} FROM videos WHERE id = ?`,
    [videoId],
  );
  return row ? rowToVideo(row) : null;
}

type GalleryRow = VideoRow & {
  seizure_start: number;
  seizure_duration_sec: number;
  seizure_duration_confidence: string;
  seizure_ictal_obs: string;
  seizure_post_behavior: string;
  seizure_retrospective: number;
};

/** Counts entries in a stored JSON array without trusting it to BE an array. */
function countJsonArray(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * The gallery feed: every video belonging to a FINISHED seizure for this dog,
 * newest first, with just enough of the seizure to render a tile.
 *
 * The `status = 'complete'` filter is not optional. A video attached to an
 * in-progress row belongs to a seizure the owner has not finished describing;
 * showing it in a browsable gallery would present a half-written record as a
 * historical fact — the same rule every other read in the app follows.
 */
export async function listGallery(dogId: string): Promise<GalleryEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<GalleryRow>(
    `SELECT
       v.id, v.seizure_id, v.source, v.file_uri, v.timestamp, v.imported_at,
       v.capture_confidence, v.thumb_uri, v.duration_sec, v.note,
       s.start               AS seizure_start,
       s.duration_sec        AS seizure_duration_sec,
       s.duration_confidence AS seizure_duration_confidence,
       s.ictal_obs           AS seizure_ictal_obs,
       s.post_behavior       AS seizure_post_behavior,
       s.retrospective       AS seizure_retrospective
     FROM videos v
     JOIN seizures s ON s.id = v.seizure_id
     WHERE s.dog_id = ? AND s.status = 'complete'
     ORDER BY v.timestamp DESC`,
    [dogId],
  );

  return rows.map((row) => ({
    video: rowToVideo(row),
    seizureStart: row.seizure_start,
    seizureDurationSec: row.seizure_duration_sec,
    seizureDurationConfidence:
      row.seizure_duration_confidence as DurationConfidence,
    observationCount:
      countJsonArray(row.seizure_ictal_obs) +
      countJsonArray(row.seizure_post_behavior),
    retrospective: row.seizure_retrospective === 1,
  }));
}

/** How many videos this dog has, for the Records tab's Gallery segment badge. */
export async function countGallery(dogId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM videos v JOIN seizures s ON s.id = v.seizure_id
      WHERE s.dog_id = ? AND s.status = 'complete'`,
    [dogId],
  );
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export type NewVideoInput = Omit<Video, 'id'>;

export async function attachVideo(video: NewVideoInput): Promise<string> {
  const db = await getDb();
  const id = uid();
  await db.runAsync(
    `INSERT INTO videos (
       id, seizure_id, source, file_uri, timestamp, imported_at,
       capture_confidence, thumb_uri, duration_sec, note
     ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      video.seizureId,
      video.source,
      video.fileUri,
      video.timestamp,
      video.importedAt,
      video.captureConfidence,
      video.thumbUri,
      video.durationSec,
      video.note,
    ],
  );
  return id;
}

/**
 * Removes the row and hands back the paths the caller must delete from disk.
 *
 * Returns both paths rather than just the video: a thumbnail left behind after
 * its video is gone is an orphan nothing in the app can ever reach or remove.
 */
export async function detachVideo(
  videoId: string,
): Promise<{ fileUri: string; thumbUri: string } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ file_uri: string; thumb_uri: string }>(
    'SELECT file_uri, thumb_uri FROM videos WHERE id = ?',
    [videoId],
  );
  await db.runAsync('DELETE FROM videos WHERE id = ?', [videoId]);
  if (!row) return null;
  return { fileUri: row.file_uri, thumbUri: row.thumb_uri ?? '' };
}

/**
 * Fields an owner may correct after the fact.
 *
 * `captureConfidence` is in here on purpose: the moment an owner edits the date
 * on an imported video, that date became owner-stated and the row must say so,
 * even if it previously said 'unknown'. Callers do not get to leave it behind.
 */
export type VideoPatch = {
  note?: string;
  timestamp?: number;
  captureConfidence?: CaptureConfidence;
  thumbUri?: string;
};

const PATCH_COLUMNS: Record<keyof VideoPatch, string> = {
  note: 'note',
  timestamp: 'timestamp',
  captureConfidence: 'capture_confidence',
  thumbUri: 'thumb_uri',
};

export async function updateVideo(
  videoId: string,
  patch: VideoPatch,
): Promise<void> {
  const entries = (Object.keys(patch) as (keyof VideoPatch)[]).filter(
    (key) => patch[key] !== undefined,
  );
  if (entries.length === 0) return;

  const db = await getDb();
  const assignments = entries.map((key) => `${PATCH_COLUMNS[key]} = ?`);
  const values = entries.map((key) => patch[key] as string | number);

  await db.runAsync(
    `UPDATE videos SET ${assignments.join(', ')} WHERE id = ?`,
    [...values, videoId],
  );
}

/**
 * Thumbnail extraction is best-effort and happens off the critical path, so it
 * gets its own tiny write rather than forcing callers through updateVideo.
 */
export async function setThumbnail(
  videoId: string,
  thumbUri: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE videos SET thumb_uri = ? WHERE id = ?', [
    thumbUri,
    videoId,
  ]);
}
