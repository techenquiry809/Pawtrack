/**
 * Video capture and storage.
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
 */

import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { uid } from '@/db/client';

export type CapturedVideo = {
  fileUri: string;
  timestamp: number;
  durationSec: number | null;
};

const VIDEO_DIR_NAME = 'seizure-videos';

function videoDirectory(): Directory {
  const dir = new Directory(Paths.document, VIDEO_DIR_NAME);
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
  const dir = videoDirectory();
  const extension = tempUri.split('.').pop()?.split('?')[0] ?? 'mp4';
  const destination = new File(dir, `${uid()}.${extension}`);
  await new File(tempUri).copy(destination);
  return destination.uri;
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
export async function recordSeizureVideo(): Promise<CapturedVideo | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Camera permission was not granted. You can enable it in your phone settings, or add a video later from History.',
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
  return {
    fileUri,
    timestamp: Date.now(),
    // expo-image-picker reports duration in milliseconds.
    durationSec: asset.duration ? Math.round(asset.duration / 1000) : null,
  };
}

/**
 * Picks an existing video from the device library — used when editing a
 * historical seizure the owner filmed with the normal camera app.
 */
export async function pickExistingVideo(): Promise<CapturedVideo | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Photo library permission was not granted. You can enable it in your phone settings.',
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;

  const fileUri = await persist(asset.uri);
  return {
    fileUri,
    timestamp: Date.now(),
    durationSec: asset.duration ? Math.round(asset.duration / 1000) : null,
  };
}

/**
 * Deletes a video file from disk. Call this AFTER removing the DB row, and
 * never let a failure here block the user — an orphaned file is a minor
 * annoyance, a crash mid-edit is not.
 */
export function deleteVideoFile(fileUri: string): void {
  try {
    const file = new File(fileUri);
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('[video] could not delete file', e);
  }
}
