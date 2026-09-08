/**
 * The folder name shown after a report is saved.
 *
 * ── WHY THIS IS TESTED AT ALL ─────────────────────────────────────────
 *
 * It is three string operations, and every one of them fails silently. A URI
 * that is decoded in the wrong order, or split on the wrong colon, produces a
 * confirmation that is merely WRONG rather than obviously broken: the owner is
 * told the file is somewhere it is not, goes looking, and concludes the export
 * failed. There is no crash and no log line to notice.
 *
 * The shapes below are the ones Android actually hands back — internal
 * storage, an SD card, the Downloads provider, a nested folder the owner made
 * themselves — plus the malformed input that must not throw mid-save.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// ./saveLocation.ts, not the barrel: node --test strips types but does not
// resolve the `@/` alias.
import { folderLabel } from './saveLocation.ts';

test('names the folder from an internal-storage tree URI', () => {
  assert.equal(
    folderLabel('content://com.android.externalstorage.documents/tree/primary%3ADownload'),
    'Download',
  );
});

test('keeps the nesting of a folder the owner made', () => {
  assert.equal(
    folderLabel('content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FVet'),
    'Documents/Vet',
  );
});

test('drops an SD card volume id, which names no place', () => {
  assert.equal(
    folderLabel('content://com.android.externalstorage.documents/tree/1A2B-3C4D%3AReports'),
    'Reports',
  );
});

test('handles the Downloads provider, which has no volume prefix', () => {
  assert.equal(
    folderLabel('content://com.android.providers.downloads.documents/tree/downloads'),
    'downloads',
  );
});

test('falls back rather than showing the root of a volume', () => {
  // 'primary:' with nothing after it is the top of internal storage. There is
  // no folder name to print, and printing 'primary' would be a lie.
  assert.equal(
    folderLabel('content://com.android.externalstorage.documents/tree/primary%3A'),
    'the folder you chose',
  );
});

test('falls back on a URI that is not a tree URI', () => {
  assert.equal(folderLabel('file:///data/user/0/com.pawtrack.app/cache'), 'the folder you chose');
  assert.equal(folderLabel(''), 'the folder you chose');
});

test('a malformed escape sequence does not throw', () => {
  // decodeURIComponent('%zz') throws. A save must not fail at the last step,
  // after the bytes are already written, because of a confirmation message.
  assert.equal(
    folderLabel('content://com.android.externalstorage.documents/tree/primary%3A%zz'),
    '%zz',
  );
});

test('the volume is ended by the FIRST colon, not the last', () => {
  // A folder name containing a colon keeps it, rather than being cut in half.
  assert.equal(
    folderLabel('content://com.android.externalstorage.documents/tree/primary%3AVet%3A2026'),
    'Vet:2026',
  );
});
