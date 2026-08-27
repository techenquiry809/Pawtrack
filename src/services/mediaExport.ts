/**
 * Getting a video OUT of the app — to the phone's photo library, or to a vet.
 *
 * ── WHY BOTH ROUTES EXIST ─────────────────────────────────────────────
 *
 * They answer different questions.
 *
 *   saveVideoToPhone()  "I want to keep this."     → Photos, in an album
 *   shareVideo()        "I want to send this."     → the OS share sheet
 *
 * An owner who only has the share sheet has to know that Save Video is hiding
 * behind it; an owner who only has the album save cannot email their vet. The
 * gallery offers both, with Save as the primary action.
 *
 * ── THE PERMISSION IS NARROWER THAN IT LOOKS ──────────────────────────
 *
 * We request `writeOnly` access. Saving a file the app already owns does not
 * require the ability to READ the owner's entire photo library, and asking for
 * more than a feature needs is exactly the over-broad declaration that gets a
 * Data Safety form rejected. iOS shows a materially gentler prompt for
 * add-only access, so the narrower request also gets granted more often.
 */

// ── WHICH expo-media-library API THIS USES ────────────────────────────
//
// The class-based API (`Asset.create`, `Album.get`, `album.add`), NOT the old
// function API. In SDK 57 every legacy function — createAssetAsync,
// getAlbumAsync, createAlbumAsync, addAssetsToAlbumAsync — is a stub that
// THROWS at runtime rather than merely warning:
//
//   export async function createAssetAsync(...) {
//     throw errorOnLegacyMethodUse('createAssetAsync');
//   }
//
// It still type-checks, so the failure only shows up on device, where it
// surfaced as "could not be saved ... check that your phone has free storage" —
// a message about a disk that was never full. The legacy entry point still
// exists at "expo-media-library/legacy"; this uses the current API instead.
import { Album, Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { videoFileUri } from './videoService';

/** The album seizure videos are filed under in the owner's Photos app. */
export const ALBUM_NAME = 'Paws Journal';

export type ExportOutcome =
  | { status: 'saved'; album: string }
  | { status: 'shared' }
  | { status: 'cancelled' }
  | { status: 'denied'; message: string }
  | { status: 'missing'; message: string };

/**
 * Resolves a stored relative path and confirms the bytes are actually there.
 *
 * A row can outlive its file — the OS clears app caches, a restore brings back
 * a database without the media, a manual delete goes wrong. Checking first
 * turns a native crash into a sentence the owner can act on.
 */
function resolveExisting(relativePath: string): string | null {
  const absolute = videoFileUri(relativePath);
  if (!absolute) return null;
  try {
    return new File(absolute).exists ? absolute : null;
  } catch {
    return null;
  }
}

const MISSING_MESSAGE =
  'The video file is no longer on this phone. The record and its observations are still saved.';

/**
 * Saves a video into the owner's Photos app, inside a "Paws Journal" album.
 *
 * The album matters more than it sounds: a seizure video dropped loose into a
 * camera roll of holiday footage is one the owner will not find again when
 * they are sitting in front of their vet.
 */
export async function saveVideoToPhone(
  relativePath: string,
): Promise<ExportOutcome> {
  const absolute = resolveExisting(relativePath);
  if (!absolute) return { status: 'missing', message: MISSING_MESSAGE };

  // writeOnly: we add to the library, we never read it. See the header note.
  const permission = await requestPermissionsAsync(true);
  if (!permission.granted) {
    return {
      status: 'denied',
      message:
        'Paws Journal needs permission to add to your photo library. You can turn that on in Settings › Paws Journal › Photos.',
    };
  }

  try {
    const asset = await Asset.create(absolute);

    // Album.get needs READ access, which writeOnly does not grant. If it is
    // refused we still have a saved asset sitting in the camera roll, which is
    // the part the owner actually asked for — failing the whole call here would
    // be a lie, so the album step degrades to "Recents" instead.
    try {
      const album = await Album.get(ALBUM_NAME);
      if (album) {
        await album.add(asset);
      } else {
        await Album.create(ALBUM_NAME, [asset]);
      }
    } catch (e) {
      console.warn('[export] saved, but could not file it into the album', e);
      return { status: 'saved', album: 'Recents' };
    }

    return { status: 'saved', album: ALBUM_NAME };
  } catch (e) {
    console.error('[export] could not save to the photo library', e);
    return {
      status: 'denied',
      message:
        'The video could not be saved to your photo library. Check that your phone has free storage and try again.',
    };
  }
}

/**
 * Opens the OS share sheet for a video — email, Messages, AirDrop, a vet portal.
 *
 * Note this ALSO gives the owner "Save Video" on iOS without any permission
 * prompt at all, which is why it stays available even when photo-library access
 * has been refused.
 */
export async function shareVideo(relativePath: string): Promise<ExportOutcome> {
  const absolute = resolveExisting(relativePath);
  if (!absolute) return { status: 'missing', message: MISSING_MESSAGE };

  if (!(await Sharing.isAvailableAsync())) {
    return {
      status: 'denied',
      message: 'Sharing is not available on this device.',
    };
  }

  try {
    await Sharing.shareAsync(absolute, {
      mimeType: 'video/mp4',
      dialogTitle: 'Send this seizure video',
      UTI: 'public.movie',
    });
    // The share sheet resolves the same way whether the owner sent it or
    // dismissed it, so this is deliberately not reported as a success.
    return { status: 'shared' };
  } catch (e) {
    console.error('[export] share failed', e);
    return {
      status: 'denied',
      message: 'The share sheet could not be opened. Please try again.',
    };
  }
}
