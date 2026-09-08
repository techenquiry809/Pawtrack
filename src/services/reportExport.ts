/**
 * Turning a report into a PDF the owner can send or keep.
 *
 * ── WHY THE FILE GETS RENAMED ─────────────────────────────────────────
 *
 * `printToFileAsync` writes to the cache under a generated name:
 *
 *   file:///…/Caches/ExponentExperienceData/…/Print/4A2F91C0-….pdf
 *
 * That is the name that would land in the vet's inbox. A clinician receiving
 * `4A2F91C0-8E1D-4A0B.pdf` from an owner they see twice a year has no way to
 * tell which dog or which week it covers, and no way to file it. So the PDF is
 * copied to a named file before it is offered to anyone:
 *
 *   PawTrack-Lucy-2026-08-30.pdf
 *
 * Brand first so the app is recognisable in a mailbox, then the dog, then an
 * ISO date so a folder of them sorts chronologically.
 *
 * ── THE TWO ROUTES, AND WHY BOTH ──────────────────────────────────────
 *
 * The same split, for the same reason, as `mediaExport.ts`:
 *
 *   shareReport()  "I want to send this."   → the OS share sheet
 *   saveReport()   "I want to keep this."   → a folder on the phone
 *
 * An owner with only the share sheet cannot file a report for themselves; an
 * owner with only Save cannot email their vet. The report screen offers both.
 *
 * ── SAVING IS NOT THE SAME ACT ON THE TWO PLATFORMS ───────────────────
 *
 * Android has a real answer: the Storage Access Framework. The owner picks a
 * folder, the file is written into it, and the confirmation can name the place
 * it went — `Download`, `Documents/Vet`. Nothing is copied through the share
 * sheet and no storage permission is requested, because SAF grants access to
 * exactly the one folder they chose and nothing else.
 *
 * iOS has no equivalent an app may call. `UIDocumentPickerViewController` in
 * export mode is not exposed by Expo, and the alternative — setting
 * `UIFileSharingEnabled` so the app's Documents folder appears in Files — was
 * rejected outright: it would publish the seizure DATABASE and the video files
 * next to the report. A vet report is worth exporting; the medical record of a
 * sick animal is not worth leaving open in a file browser to get it there.
 *
 * So on iOS, Save opens the share sheet, where "Save to Files" is the first
 * destination. It is the same sheet Send opens, and the labels are the honest
 * difference: the button says which half of the sheet the owner wants.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────
 *
 * It does not bundle video. `Sharing.shareAsync` takes exactly one URI, and a
 * PDF cannot carry playable media, so a "one file with the videos inside" would
 * either be a lie or silently drop them. The PDF carries each clip's poster
 * frame and notes; clips travel separately through `shareVideo`.
 */

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
// The SAF namespace has no equivalent in the current expo-file-system API —
// `File`/`Directory` address the app's own sandbox, and a folder the owner
// picked is by definition outside it. `expo-file-system/legacy` is the
// supported entry point for it in SDK 57, not a deprecated one.
import {
  StorageAccessFramework as SAF,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import type { Dog } from '@/types/domain';
import { breedDisplay } from '@/db/dogRepo';
import { collectReport, earliestRecordDay } from '@/features/report/collect';
import { summarizeReport } from '@/features/report/summarize';
import {
  renderReportHtml,
  reportFileName,
} from '@/features/report/renderHtml';
import {
  dayKeyOf,
  formatRangeLabel,
  rangeFileStem,
  resolveRange,
  type ReportScope,
} from '@/features/report/range';
import { folderLabel } from '@/features/report/saveLocation';

/**
 * The same vocabulary `mediaExport` returns, with one word changed: a video is
 * saved to an `album`, a PDF to a folder, and calling a folder an album in the
 * confirmation would send the owner to the Photos app for a file that is not
 * there. Everything else lines up, so the two screens still report failure
 * identically.
 */
export type ExportOutcome =
  | { status: 'saved'; location: string }
  | { status: 'shared' }
  | { status: 'cancelled' }
  | { status: 'denied'; message: string }
  | { status: 'missing'; message: string };

/** Where the owner can find the app, printed in the footer. */
const APP_URL = 'pawtrack.app';

export type BuiltReport = {
  /** Absolute uri of the finished, correctly named PDF. */
  uri: string;
  fileName: string;
  /** How many clips the period contains, so the caller can offer to send them. */
  videoCount: number;
  /** True when nothing at all was recorded. Still a real document. */
  isEmpty: boolean;
};

/**
 * Build the PDF and return where it landed.
 *
 * Separate from sharing on purpose: the screen can generate once and then let
 * the owner both send AND save without paying to render the document twice.
 */
export async function buildReport(
  dog: Dog,
  scope: ReportScope,
  dayKey: string,
): Promise<BuiltReport> {
  // An all-time report needs to know where the history starts, and only the
  // database knows that — `resolveRange` is pure. One extra query, and only
  // for the scope that needs it.
  const earliest = scope === 'all' ? await earliestRecordDay(dog.id, dayKeyOf) : undefined;
  const range = resolveRange(scope, dayKey, earliest ?? undefined);
  const data = await collectReport(dog, range);
  const summary = summarizeReport(data, dayKeyOf);

  const html = renderReportHtml({
    summary,
    dog,
    dogName: dog.name,
    breedLabel: breedDisplay(dog),
    rangeLabel: formatRangeLabel(range),
    appUrl: APP_URL,
  });

  const { uri } = await Print.printToFileAsync({ html });

  const fileName = reportFileName(dog.name, rangeFileStem(range));
  // Copy rather than move: if the rename fails for any reason the original
  // still exists, and the owner gets an oddly named PDF instead of no PDF.
  const named = new File(Paths.cache, fileName);
  if (named.exists) named.delete();
  await new File(uri).copy(named);

  return {
    uri: named.uri,
    fileName,
    videoCount: summary.videoCount,
    isEmpty: summary.isEmpty,
  };
}

/** Hand the report to the OS share sheet: mail, messages, AirDrop, Files. */
export async function shareReport(report: BuiltReport): Promise<ExportOutcome> {
  if (!(await Sharing.isAvailableAsync())) {
    return { status: 'denied', message: 'Sharing is not available on this device.' };
  }
  try {
    await Sharing.shareAsync(report.uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Send ${report.fileName}`,
      UTI: 'com.adobe.pdf',
    });
    // The sheet resolves the same way whether the owner sent the file or
    // dismissed it, so this is reported as "shared", not as a confirmed send.
    // Claiming delivery we cannot observe would be worse than saying nothing.
    return { status: 'shared' };
  } catch (e) {
    console.error('[report] share failed', e);
    return {
      status: 'denied',
      message: 'The share sheet could not be opened. Please try again.',
    };
  }
}

/**
 * Save a copy the owner keeps — into a folder they pick on Android, through
 * "Save to Files" on iOS. See the header note on why the two differ.
 */
export async function saveReport(report: BuiltReport): Promise<ExportOutcome> {
  if (Platform.OS !== 'android') return shareReport(report);

  let directoryUri: string;
  try {
    const permission = await SAF.requestDirectoryPermissionsAsync();
    // Backing out of the folder picker is a decision, not a failure. It gets
    // no alert — the owner knows what they just did.
    if (!permission.granted) return { status: 'cancelled' };
    directoryUri = permission.directoryUri;
  } catch (e) {
    console.error('[report] folder picker failed', e);
    return {
      status: 'denied',
      message: 'The folder picker could not be opened. Please try again.',
    };
  }

  try {
    // Read then write, rather than a copy: `copyAsync` takes a SAF URI as its
    // source but only a file:// URI as its destination, so there is no direct
    // route into a folder the owner picked. The report is HTML text with no
    // embedded images, so the base64 round trip is tens of kilobytes.
    const base64 = await readAsStringAsync(report.uri, { encoding: 'base64' });

    // createFileAsync appends the extension itself, from the MIME type. Given
    // 'PawTrack-Lucy-2026-08-30.pdf' it would produce '….pdf.pdf'.
    const stem = report.fileName.replace(/\.pdf$/i, '');
    const target = await SAF.createFileAsync(directoryUri, stem, 'application/pdf');

    await writeAsStringAsync(target, base64, { encoding: 'base64' });
    return { status: 'saved', location: folderLabel(directoryUri) };
  } catch (e) {
    console.error('[report] save failed', e);
    return {
      status: 'denied',
      message:
        'The report could not be written to that folder. Check that your phone has free storage, or try a different folder.',
    };
  }
}
