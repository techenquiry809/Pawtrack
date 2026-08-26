/**
 * Dog profile photo.
 *
 * Same rule as seizure video: the bytes are copied into the app's document
 * directory and only the path reaches SQLite. The picker hands back a URI in a
 * cache the OS may clear at any moment, so copying is not optional — a profile
 * photo that silently disappears looks like data loss.
 *
 * Square-cropped at pick time rather than at render, so every avatar in the app
 * gets the same geometry without each screen re-deciding.
 */

import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { uid } from '@/db/client';
import { toAbsoluteUri, toRelativePath } from './fileStore';

const PHOTO_DIR_NAME = 'dog-photos';

function photoDirectory(): Directory {
  const dir = new Directory(Paths.document, PHOTO_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

async function persist(tempUri: string): Promise<string> {
  const dir = photoDirectory();
  const extension = tempUri.split('.').pop()?.split('?')[0] ?? 'jpg';
  const destination = new File(dir, `${uid()}.${extension}`);
  await new File(tempUri).copy(destination);
  // RELATIVE, not destination.uri — see src/services/fileStore.ts.
  return toRelativePath(destination.uri);
}

/** Resolve a stored path for rendering. */
export function dogPhotoUri(relative: string): string {
  return toAbsoluteUri(relative);
}

/**
 * Opens the photo library. Returns null on cancel; throws with an actionable
 * message when permission is refused.
 */
export async function pickDogPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Photo access was not granted. You can enable it in your phone settings, or skip the photo — nothing else depends on it.',
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return persist(asset.uri);
}

/** Takes a new photo with the system camera. */
export async function takeDogPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Camera access was not granted. You can enable it in your phone settings, or choose a photo from your library instead.',
    );
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return persist(asset.uri);
}

/**
 * Best-effort delete. Call when replacing a photo so the old file does not sit
 * on the phone forever with nothing referencing it.
 */
export function deleteDogPhoto(relativePath: string): void {
  if (!relativePath) return;
  try {
    const file = new File(toAbsoluteUri(relativePath));
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('[dog-photo] could not delete', e);
  }
}
