/**
 * Video capture, import and storage.
 *
 * DESIGN DECISION: video bytes never go in the database. We copy the file into
 * the app's document directory and store only the path. A multi-megabyte blob
 * in SQLite would bloat every query and make backups unusable.
 *
 * API NOTE: Expo SDK 54+ replaced the old `FileSystem.copyAsync` style helpers
 * with an object-oriented `File` / `Directory` / `Paths` API. This file uses
 * the current one. If you find a tutorial using `FileSystem.documentDirectory`
 * it is written for an older SDK — the legacy shim lives at
 * `expo-file-system/legacy`, but new code should not use it.
 *
 * ── WHAT AN IMPORTED VIDEO DOES NOT CARRY ─────────────────────────────
 *
 * expo-image-picker hands back a temporary copy of the chosen asset. It does
 * NOT reliably hand back the date the original was filmed — and the temp file's
 * own timestamps are the time of the copy, which is now. There is therefore no
 * honest way to derive when an imported seizure happened.
 *
 * So we do not try. `importVideos()` returns `capturedAt: null` and the import
 * screen asks the owner. A guessed date on a seizure record is worse than an
 * absent one: the vet cannot tell them apart.
 */

import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { CameraView } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { uid } from '@/db/client';
import { toAbsoluteUri, toRelativePath } from './fileStore';

export type CapturedVideo = {
  /** Relative to the document directory. Never absolute — see fileStore.ts. */
  fileUri: string;
  /** Relative path to the poster frame, or '' if extraction failed. */
  thumbUri: string;
  /**
   * When the seizure in this video happened, or null when only the owner can
   * say. Measured for a live capture; always null for an import.
   */
  capturedAt: number | null;
  durationSec: number | null;
};

const VIDEO_DIR_NAME = 'seizure-videos';
const THUMB_DIR_NAME = 'seizure-thumbs';

/** Poster frame taken a second in — frame zero is very often black. */
const THUMBNAIL_AT_MS = 1000;

function ensureDirectory(name: string): Directory {
  const dir = new Directory(Paths.document, name);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

/**
 * Copies a temporary capture/picker URI into permanent app storage.
 * The OS may clear the original temp file at any time, so this is not optional.
 */
async function persist(tempUri: string): Promise<string> {
  const dir = ensureDirectory(VIDEO_DIR_NAME);
  const extension = tempUri.split('.').pop()?.split('?')[0] ?? 'mp4';
  const destination = new File(dir, `${uid()}.${extension}`);
  await new File(tempUri).copy(destination);
  // RELATIVE, not destination.uri. An absolute path embeds the app container
  // UUID, which iOS reassigns on reinstall — a seizure video an owner filmed
  // for their vet would silently become unreachable after an update.
  return toRelativePath(destination.uri);
}

/**
 * Extracts a poster frame and stores it beside the videos.
 *
 * BEST EFFORT BY DESIGN. A missing thumbnail costs the gallery a grey tile; a
 * throw here during the live seizure flow would cost the owner their recording.
 * Every failure path returns '' and the gallery renders a placeholder.
 */
export async function generateThumbnail(relativeVideoPath: string): Promise<string> {
  try {
    const absolute = toAbsoluteUri(relativeVideoPath);
    if (!absolute) return '';

    const { uri } = await VideoThumbnails.getThumbnailAsync(absolute, {
      time: THUMBNAIL_AT_MS,
      quality: 0.6,
    });

    const dir = ensureDirectory(THUMB_DIR_NAME);
    const destination = new File(dir, `${uid()}.jpg`);
    await new File(uri).copy(destination);
    return toRelativePath(destination.uri);
  } catch (e) {
    // A video shorter than THUMBNAIL_AT_MS throws here rather than clamping,
    // which is the single most likely cause in this app — some seizures are
    // filmed for two seconds. Not worth surfacing to the owner.
    console.warn('[video] could not extract a thumbnail', e);
    return '';
  }
}

/** Resolve a stored path for playback or sharing. */
export function videoFileUri(relative: string): string {
  return toAbsoluteUri(relative);
}

/** Resolve a stored poster frame for an <Image>. '' when there is none. */
export function thumbnailUri(relative: string): string {
  return toAbsoluteUri(relative);
}

/**
 * Opens the system camera in video mode.
 *
 * We use expo-image-picker's camera rather than a custom expo-camera UI on
 * purpose: during a seizure the owner should get the familiar, reliable system
 * camera they already know how to operate, not a bespoke interface they have
 * to learn under stress.
 *
 * Returns null if the user cancels. Throws if permission is denied.
 */
/**
 * Is there a camera to open at all?
 *
 * ── WHY THIS GUARD IS NOT OPTIONAL ────────────────────────────────────
 *
 * launchCameraAsync goes to UIImagePickerController, and asking that for the
 * camera source on a device without one raises an Objective-C exception:
 *
 *   *** Terminating app due to uncaught exception 'NSInvalidArgumentException',
 *       reason: 'No available types for source 1'
 *       -[UIImagePickerController mediaTypes]
 *
 * An ObjC exception is NOT catchable from JavaScript. The try/catch around the
 * call site cannot see it and the app dies outright — and the moment it would
 * die is mid-seizure, with the owner holding the phone over their dog. That is
 * the single worst moment in this app to lose the process, and the in-progress
 * row is left orphaned behind it.
 *
 * The simulator is the obvious case, but a real phone reaches it too: camera
 * hardware failure, an MDM restriction, or Screen Time content restrictions all
 * remove the camera source.
 *
 * A failure of the CHECK is treated as "camera present" on purpose — this must
 * never be the reason a real capture is refused.
 */
async function cameraIsAvailable(): Promise<boolean> {
  try {
    // getAvailableVideoCodecsAsync queries the actual capture device, so an
    // EMPTY list means there is nothing behind the camera source. Measured on
    // the iOS simulator, which returns exactly [] and then crashes if you go
    // ahead and open the picker anyway.
    //
    // CameraView.isAvailableAsync() looks like the right call and is not: it is
    // documented `@platform web` and is not implemented on iOS at all, so it
    // throws UnavailabilityError rather than returning false.
    const codecs = await CameraView.getAvailableVideoCodecsAsync();
    return codecs.length > 0;
  } catch {
    // The query is not implemented on this platform (it is iOS-only). Fail
    // OPEN: refusing a capture on a real phone because a probe was unsupported
    // would be a far worse bug than the one this guards against, and Android's
    // picker resolves a missing camera through the intent system rather than
    // by raising an uncatchable exception.
    return true;
  }
}

export async function recordSeizureVideo(): Promise<CapturedVideo | null> {
  if (!(await cameraIsAvailable())) {
    throw new Error(
      'No camera is available on this device. You can still add a video from your photo library.',
    );
  }

  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Camera permission was not granted. You can enable it in your phone settings, or add a video later from Records.',
    );
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;

  const fileUri = await persist(asset.uri);
  const thumbUri = await generateThumbnail(fileUri);

  return {
    fileUri,
    thumbUri,
    // The app was running the timer, so this is measured, not recalled.
    capturedAt: Date.now(),
    // expo-image-picker reports duration in milliseconds.
    durationSec: asset.duration ? Math.round(asset.duration / 1000) : null,
  };
}

/**
 * Picks one or more videos from the device library.
 *
 * `capturedAt` is null on every result — see the note at the top of this file.
 * The caller MUST ask the owner when it happened before writing a seizure row.
 *
 * Returns an empty array if the user cancels. Throws if permission is denied.
 */
export async function importVideos(
  options: { multiple?: boolean } = {},
): Promise<CapturedVideo[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Photo library permission was not granted. You can enable it in your phone settings.',
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
    allowsMultipleSelection: options.multiple ?? true,
    // A seizure owner picking a handful of clips is the real case; an
    // unbounded selection is a memory problem on older phones.
    selectionLimit: options.multiple === false ? 1 : 10,
  });

  if (result.canceled) return [];

  const imported: CapturedVideo[] = [];
  for (const asset of result.assets) {
    try {
      const fileUri = await persist(asset.uri);
      const thumbUri = await generateThumbnail(fileUri);
      imported.push({
        fileUri,
        thumbUri,
        capturedAt: null,
        durationSec: asset.duration ? Math.round(asset.duration / 1000) : null,
      });
    } catch (e) {
      // One unreadable file in a multi-select must not lose the others.
      console.error('[video] could not import one of the selected videos', e);
    }
  }
  return imported;
}

/**
 * Back-compat wrapper for the single-pick call sites that predate multi-select.
 * New code should call importVideos().
 */
export async function pickExistingVideo(): Promise<CapturedVideo | null> {
  const [first] = await importVideos({ multiple: false });
  return first ?? null;
}

/**
 * Deletes a video file from disk. Call this AFTER removing the DB row, and
 * never let a failure here block the user — an orphaned file is a minor
 * annoyance, a crash mid-edit is not.
 */
export function deleteVideoFile(relativePath: string): void {
  if (!relativePath) return;
  try {
    const file = new File(toAbsoluteUri(relativePath));
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('[video] could not delete file', e);
  }
}

/**
 * Deletes a video AND its poster frame.
 *
 * Prefer this over deleteVideoFile everywhere a row is being removed: a
 * thumbnail whose video is gone is unreachable from every screen in the app,
 * so nothing will ever clean it up.
 */
export function deleteVideoAssets(paths: {
  fileUri: string;
  thumbUri: string;
}): void {
  deleteVideoFile(paths.fileUri);
  deleteVideoFile(paths.thumbUri);
}
