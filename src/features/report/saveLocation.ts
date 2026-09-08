/**
 * Turning an Android SAF tree URI into a place the owner recognises.
 *
 * When someone saves a report, the picker hands back a URI like:
 *
 *   content://com.android.externalstorage.documents/tree/primary%3ADownload
 *
 * That is the correct thing to write to and the wrong thing to show anyone.
 * "Saved to content://com.android.externalstorage.documents/tree/primary%3A…"
 * tells an owner nothing about where their vet report went; "Saved to
 * Download" tells them exactly where to look for it.
 *
 * Two parts get stripped:
 *
 *   - everything up to and including `/tree/`, which is provider plumbing
 *   - the volume id before the colon — `primary` for internal storage,
 *     `1A2B-3C4D` for an SD card — which is not a folder anyone can find
 *
 * What is left is the path as the Files app draws it: `Download`, or
 * `Documents/Vet` for a folder they made themselves. The nesting is kept
 * deliberately: an owner with `Vet` inside `Documents` is told both.
 *
 * Pure and separate from reportExport.ts so it can be tested — that module
 * imports the native filesystem and cannot be loaded by `node --test`.
 */

/**
 * Shown when the URI is not a shape we recognise. Vague on purpose: it is
 * still true, and it is better than printing a content:// URI at someone.
 */
const FALLBACK = 'the folder you chose';

export function folderLabel(directoryUri: string): string {
  const marker = directoryUri.indexOf('/tree/');
  if (marker < 0) return FALLBACK;

  // Everything is done on the ENCODED text and decoded last. Decoding first
  // would let an encoded '%2Ftree%2F' inside a folder name look like a second
  // marker, and it would make one bad escape sequence anywhere in the path
  // cost the volume strip as well.
  const tree = directoryUri.slice(marker + '/tree/'.length);

  // The volume always comes first, so the FIRST colon ends it — encoded as
  // '%3A' by the picker, but literal in a hand-built URI, so both are matched.
  // A folder named with a colon keeps it, rather than being cut in half.
  const volume = /%3A|:/i.exec(tree);
  const encodedPath = volume ? tree.slice(volume.index + volume[0].length) : tree;

  let path = encodedPath;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    // A malformed escape sequence. The raw text is still more useful than
    // nothing, and the trim below still applies to it.
  }

  return path.replace(/^\/+|\/+$/g, '') || FALLBACK;
}
