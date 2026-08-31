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
 *
 * ── THE SPLIT THIS FILE NOW ENFORCES ──────────────────────────────────
 *
 *   videos        clinical metadata           SYNCS
 *                 id, dog_id, seizure_id, source, timestamp, imported_at,
 *                 capture_confidence, duration_sec, note, origin_device_id
 *
 *   video_files   where the bytes are on THIS phone     NEVER SYNCS
 *                 video_id, file_uri, thumb_uri
 *
 * A video is present on this device IFF a video_files row exists. That is the
 * whole test, and `Video.isLocal` is that test's answer.
 *
 * The paths cannot sync: a file:///…/Documents/… uri from device A resolves to
 * nothing on device B, and iOS reassigns the container UUID on reinstall
 * anyway (src/services/fileStore.ts documents the bug that taught us this).
 * The ROW must sync, because "a recording exists for this seizure" is
 * clinically meaningful on a device that cannot play it.
 */

import { getDb, uid } from './client';
import { newRowOwner, ownerScope } from './scope';
import { enqueue } from './outbox';
import { tombstone, collectOrphanedFiles, forgetVideoFiles } from './tombstone';
import { getDeviceId } from './syncState';
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
  dog_id: string | null;
  seizure_id: string;
  source: string;
  timestamp: number;
  imported_at: number;
  capture_confidence: string;
  duration_sec: number | null;
  note: string;
  pre_note: string;
  ictal_note: string;
  post_note: string;
  origin_device_id: string | null;
  /** From the LEFT JOIN onto video_files. Null when the bytes are elsewhere. */
  file_uri: string | null;
  thumb_uri: string | null;
};

/**
 * The synced columns, plus the local file paths joined on.
 *
 * A LEFT JOIN, not an inner one: a video whose bytes live on another phone
 * must still appear in the gallery, because the record of it is the point.
 */
const COLUMNS = `
  v.id, v.dog_id, v.seizure_id, v.source, v.timestamp, v.imported_at,
  v.capture_confidence, v.duration_sec, v.note,
  v.pre_note, v.ictal_note, v.post_note, v.origin_device_id,
  f.file_uri, f.thumb_uri
`;

const FROM_VIDEOS = `
  FROM videos_live v
  LEFT JOIN video_files f ON f.video_id = v.id
`;

function rowToVideo(row: VideoRow): Video {
  // Presence is decided by the join, never by whether a path string happens to
  // be non-empty — an empty file_uri on a row that IS here would otherwise be
  // indistinguishable from a file that lives on another device.
  const isLocal = row.file_uri !== null && row.file_uri !== '';
  return {
    id: row.id,
    dogId: row.dog_id ?? '',
    seizureId: row.seizure_id,
    source: row.source as VideoSource,
    fileUri: isLocal ? (row.file_uri ?? '') : '',
    isLocal,
    originDeviceId: row.origin_device_id,
    timestamp: row.timestamp,
    importedAt: row.imported_at,
    captureConfidence: row.capture_confidence as CaptureConfidence,
    thumbUri: isLocal ? (row.thumb_uri ?? '') : '',
    durationSec: row.duration_sec,
    note: row.note,
    preNote: row.pre_note ?? '',
    ictalNote: row.ictal_note ?? '',
    postNote: row.post_note ?? '',
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Every video on one seizure, oldest first — the order they were filmed. */
export async function listForSeizure(seizureId: string): Promise<Video[]> {
  const db = await getDb();
  const owner = ownerScope('v');
  const rows = await db.getAllAsync<VideoRow>(
    `SELECT ${COLUMNS} ${FROM_VIDEOS}
      WHERE v.seizure_id = ? AND ${owner.sql}
      ORDER BY v.timestamp ASC`,
    [seizureId, ...owner.params],
  );
  return rows.map(rowToVideo);
}

export async function getVideo(videoId: string): Promise<Video | null> {
  const db = await getDb();
  const owner = ownerScope('v');
  const row = await db.getFirstAsync<VideoRow>(
    `SELECT ${COLUMNS} ${FROM_VIDEOS} WHERE v.id = ? AND ${owner.sql}`,
    [videoId, ...owner.params],
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
 *
 * Videos whose bytes are on another phone ARE included, with isLocal false.
 * Hiding them would misrepresent the record: the clip exists, and the owner
 * needs to know which device to go and get it from.
 */
export async function listGallery(dogId: string): Promise<GalleryEntry[]> {
  const db = await getDb();
  const owner = ownerScope('v');
  const rows = await db.getAllAsync<GalleryRow>(
    `SELECT
       ${COLUMNS},
       s.start               AS seizure_start,
       s.duration_sec        AS seizure_duration_sec,
       s.duration_confidence AS seizure_duration_confidence,
       s.ictal_obs           AS seizure_ictal_obs,
       s.post_behavior       AS seizure_post_behavior,
       s.retrospective       AS seizure_retrospective
     ${FROM_VIDEOS}
     JOIN seizures_live s ON s.id = v.seizure_id
     WHERE s.dog_id = ? AND s.status = 'complete' AND ${owner.sql}
     ORDER BY v.timestamp DESC`,
    [dogId, ...owner.params],
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
  const owner = ownerScope('v');
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM videos_live v JOIN seizures_live s ON s.id = v.seizure_id
      WHERE s.dog_id = ? AND s.status = 'complete' AND ${owner.sql}`,
    [dogId, ...owner.params],
  );
  return row?.n ?? 0;
}

/** Video ids on this dog whose bytes are NOT on this phone. */
export async function listRemoteOnly(dogId: string): Promise<Video[]> {
  const db = await getDb();
  const owner = ownerScope('v');
  const rows = await db.getAllAsync<VideoRow>(
    `SELECT ${COLUMNS} ${FROM_VIDEOS}
      WHERE v.dog_id = ? AND f.video_id IS NULL AND ${owner.sql}
      ORDER BY v.timestamp DESC`,
    [dogId, ...owner.params],
  );
  return rows.map(rowToVideo);
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export type NewVideoInput = Omit<
  Video,
  'id' | 'isLocal' | 'originDeviceId' | 'dogId'
  // The phase notes are written on the video screen after the fact, not by
  // the capture path — an owner mid-seizure is not typing observations.
  | 'preNote' | 'ictalNote' | 'postNote'
> & {
  /** Optional: derived from the parent seizure when omitted. */
  dogId?: string;
  preNote?: string;
  ictalNote?: string;
  postNote?: string;
};

/**
 * Records a video and where its bytes are.
 *
 * Two writes, one transaction, three things that must not diverge: the
 * clinical row, the local file pointer, and the outbox intent.
 */
export async function attachVideo(video: NewVideoInput): Promise<string> {
  const db = await getDb();
  const id = uid();
  const now = Date.now();
  const deviceId = await getDeviceId();

  // dog_id is denormalised onto the row, so it has to be resolved at write
  // time rather than joined at read time.
  let dogId = video.dogId;
  if (!dogId) {
    const parent = await db.getFirstAsync<{ dog_id: string }>(
      'SELECT dog_id FROM seizures WHERE id = ?',
      [video.seizureId],
    );
    dogId = parent?.dog_id;
  }
  if (!dogId) {
    throw new Error(`[videoRepo] seizure ${video.seizureId} not found`);
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO videos (
         id, user_id, dog_id, seizure_id, source, timestamp, imported_at,
         capture_confidence, duration_sec, note,
         pre_note, ictal_note, post_note, origin_device_id,
         file_uri, thumb_uri, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, newRowOwner(), dogId, video.seizureId, video.source,
        video.timestamp, video.importedAt, video.captureConfidence,
        video.durationSec, video.note,
        video.preNote ?? '', video.ictalNote ?? '', video.postNote ?? '',
        deviceId,
        // videos.file_uri / thumb_uri are the DEAD columns migration 9 left in
        // place rather than rebuilding the table to drop. Written with '' so
        // nothing downstream can read a stale path out of them and believe it.
        '', '',
        now, now,
      ],
    );

    // Where the bytes actually are. Local-only table, never pushed.
    await db.runAsync(
      `INSERT INTO video_files (video_id, file_uri, thumb_uri) VALUES (?,?,?)
       ON CONFLICT(video_id) DO UPDATE SET
         file_uri = excluded.file_uri, thumb_uri = excluded.thumb_uri`,
      [id, video.fileUri, video.thumbUri ?? ''],
    );

    await enqueue(db, 'videos', id, 'upsert', now);
  });
  return id;
}

/**
 * Removes the video record and hands back the paths the caller must delete.
 *
 * ── THE DELETION ASYMMETRY, STATED PLAINLY ────────────────────────────
 *
 * This tombstones the ROW, which syncs: the record of the recording is gone on
 * every device, and each one drops its own local copy when it sees the
 * tombstone. That is a clinical edit and it is meant to propagate.
 *
 * Freeing disk space is a different action and does NOT propagate — see
 * dropLocalFile(). A device that deletes its own copy to make room must not
 * destroy the record for everyone.
 *
 * Returns both paths rather than just the video: a thumbnail left behind after
 * its video is gone is an orphan nothing in the app can ever reach or remove.
 * Returns null when the bytes were never on this device, which is not an
 * error — there is simply nothing here to delete.
 */
export async function detachVideo(
  videoId: string,
): Promise<{ fileUri: string; thumbUri: string } | null> {
  const files = await collectOrphanedFiles([videoId]);
  await tombstone('videos', videoId);
  await forgetVideoFiles([videoId]);

  const found = files[0];
  if (!found) return null;
  return { fileUri: found.fileUri, thumbUri: found.thumbUri };
}

/**
 * Forget this device's copy WITHOUT deleting the record.
 *
 * The housekeeping half of the asymmetry above: the clinical row survives
 * everywhere and this phone simply stops claiming to hold the bytes. The
 * gallery will render it as stored on whichever device recorded it.
 */
export async function dropLocalFile(
  videoId: string,
): Promise<{ fileUri: string; thumbUri: string } | null> {
  const files = await collectOrphanedFiles([videoId]);
  await forgetVideoFiles([videoId]);
  const found = files[0];
  if (!found) return null;
  return { fileUri: found.fileUri, thumbUri: found.thumbUri };
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
  preNote?: string;
  ictalNote?: string;
  postNote?: string;
  timestamp?: number;
  captureConfidence?: CaptureConfidence;
  thumbUri?: string;
};

type PatchKey = 'note' | 'preNote' | 'ictalNote' | 'postNote' | 'timestamp' | 'captureConfidence';

const PATCH_COLUMNS: Record<PatchKey, string> = {
  note: 'note',
  preNote: 'pre_note',
  ictalNote: 'ictal_note',
  postNote: 'post_note',
  timestamp: 'timestamp',
  captureConfidence: 'capture_confidence',
};

export async function updateVideo(
  videoId: string,
  patch: VideoPatch,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  const keys = (
    ['note', 'preNote', 'ictalNote', 'postNote', 'timestamp', 'captureConfidence'] as const
  ).filter((key) => patch[key] !== undefined);

  // thumbUri is deliberately NOT in the synced set — it moves to video_files.
  const touchesThumb = patch.thumbUri !== undefined;
  if (keys.length === 0 && !touchesThumb) return;

  await db.withTransactionAsync(async () => {
    if (keys.length > 0) {
      const assignments = keys.map((key) => `${PATCH_COLUMNS[key]} = ?`);
      const values = keys.map((key) => patch[key] as string | number);
      await db.runAsync(
        `UPDATE videos SET ${assignments.join(', ')}, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        [...values, now, videoId],
      );
      await enqueue(db, 'videos', videoId, 'upsert', now);
    }

    if (touchesThumb) {
      await db.runAsync(
        `UPDATE video_files SET thumb_uri = ? WHERE video_id = ?`,
        [patch.thumbUri ?? '', videoId],
      );
    }
  });
}

/**
 * Thumbnail extraction is best-effort and happens off the critical path, so it
 * gets its own tiny write rather than forcing callers through updateVideo.
 *
 * Writes ONLY to video_files and queues nothing: a poster frame is a local
 * artefact of this device's copy, and another phone will extract its own from
 * its own bytes. Pushing it would be pushing a path.
 */
export async function setThumbnail(
  videoId: string,
  thumbUri: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO video_files (video_id, file_uri, thumb_uri) VALUES (?, '', ?)
     ON CONFLICT(video_id) DO UPDATE SET thumb_uri = excluded.thumb_uri`,
    [videoId, thumbUri],
  );
}
