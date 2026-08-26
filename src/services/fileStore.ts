/**
 * Paths to files the app owns.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────
 *
 * expo-file-system hands back an ABSOLUTE uri:
 *
 *   file:///…/Containers/Data/Application/A4671435-…/Documents/dog-photos/x.jpg
 *                                         ^^^^^^^^^^ the app container UUID
 *
 * iOS reassigns that UUID on every reinstall and on some updates. Store the
 * absolute path and the reference dies the next time the app is replaced — the
 * file may still be on disk, but nothing can find it.
 *
 * This was caught with a real dog photo that went blank after a rebuild. It
 * matters far more for seizure VIDEO: an owner films a seizure to show their
 * vet, updates the app, and the recording is silently unreachable.
 *
 * So: store RELATIVE to the document directory ('dog-photos/x.jpg'), and
 * resolve against the CURRENT document directory at read time.
 */

import { Paths } from 'expo-file-system';

/** Marks where the app-owned portion of a path begins. */
const DOCS_MARKER = '/Documents/';

/**
 * Absolute uri → path relative to the document directory.
 *
 * Tolerates a value that is already relative, so it is safe to call on data of
 * unknown vintage during the migration window.
 */
export function toRelativePath(uri: string): string {
  if (!uri) return '';
  const at = uri.indexOf(DOCS_MARKER);
  if (at === -1) return uri.replace(/^\/+/, '');
  return uri.slice(at + DOCS_MARKER.length);
}

/**
 * Relative path → absolute uri against the document directory as it is RIGHT
 * NOW. Returns '' for an empty input so callers can treat "no file" uniformly.
 */
export function toAbsoluteUri(relative: string): string {
  if (!relative) return '';
  // Already absolute (legacy row that escaped the migration) — hand it back
  // rather than producing a doubled path.
  if (relative.startsWith('file://') || relative.startsWith('/')) return relative;
  const base = Paths.document.uri.replace(/\/$/, '');
  return `${base}/${relative}`;
}
