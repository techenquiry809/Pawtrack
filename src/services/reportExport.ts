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
 *   saveReport()   "I want to keep this."   → the Files app / Downloads
 *
 * An owner with only the share sheet cannot file a report for themselves; an
 * owner with only Save cannot email their vet. The report screen offers both.
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

import type { Dog } from '@/types/domain';
import { breedDisplay } from '@/db/dogRepo';
import { collectReport } from '@/features/report/collect';
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

/**
 * Reuses the union `mediaExport` already returns, rather than inventing a
 * second result vocabulary for the same three outcomes. The report screen and
 * the video gallery can then report success and failure identically.
 */
export type ExportOutcome =
  | { status: 'saved'; album: string }
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
  const range = resolveRange(scope, dayKey);
  const data = await collectReport(dog, range);
  const summary = summarizeReport(data, dayKeyOf);

  const html = renderReportHtml({
    summary,
    dogName: dog.name,
    breedLabel: breedDisplay(dog),
    rangeLabel: formatRangeLabel(range),
    appUrl: APP_URL,
  });

  const { uri } = await Print.printToFileAsync({ html });

  const fileName = reportFileName(dog.name, range, rangeFileStem(range));
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
 * Save a copy the owner keeps.
 *
 * Routed through the share sheet rather than a direct filesystem write, which
 * looks like a detour and is not: the share sheet is the ONLY way an app can
 * put a file into the user's own Files / Drive storage on iOS without asking
 * for far broader permissions than a PDF export can justify. "Save to Files"
 * is an option inside that sheet.
 */
export async function saveReport(report: BuiltReport): Promise<ExportOutcome> {
  return shareReport(report);
}
