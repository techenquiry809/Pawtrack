/**
 * Reading everything a report covers out of the database.
 *
 * This is the ONLY layer in the report pipeline that touches I/O. It does no
 * maths and no formatting — it hands back plain data, so that `summarize` and
 * `renderHtml` stay pure and therefore testable. The split is deliberate: the
 * parts of this feature that can be wrong in ways a vet would not notice are
 * exactly the parts that end up under `node --test`.
 */

import * as seizureRepo from '@/db/seizureRepo';
import * as checkinRepo from '@/db/checkinRepo';
import * as medicationRepo from '@/db/medicationRepo';
import * as videoRepo from '@/db/videoRepo';
import { toAbsoluteUri } from '@/services/fileStore';
import type {
  DailyCheckin,
  Dog,
  MedicationDose,
  MedicationWithReminders,
  Seizure,
  Video,
} from '@/types/domain';
import type { ReportRange } from './range';

/** A seizure with the clips filed against it. */
export type SeizureWithClips = Seizure & { videos: Video[] };

export type DoseWithName = MedicationDose & { medicationName: string | null };

export type ReportData = {
  dog: Dog;
  range: ReportRange;
  seizures: SeizureWithClips[];
  checkins: DailyCheckin[];
  doses: DoseWithName[];
  /**
   * The medications on file RIGHT NOW, with their reminder times.
   *
   * Deliberately not filtered to the range, and deliberately separate from
   * `doses`. The two answer different questions and a vet reads both: this is
   * what the dog is PRESCRIBED, `doses` is what was actually given. A report
   * that showed only the dose log would leave a reader unable to tell a missed
   * dose from a drug that was never scheduled that day.
   *
   * Empty when the owner has never added a medication, which is a normal
   * state — the section then says so rather than being omitted, because
   * "no medication recorded" is itself clinically relevant.
   */
  medications: MedicationWithReminders[];
  /** When the file was produced. Printed, so a reader can tell how fresh it is. */
  generatedAt: number;
};

/**
 * Absolute-ise the poster-frame paths before they leave the I/O layer.
 *
 * The repository hands back `thumbUri` RELATIVE to the document directory, for
 * the container-UUID reason spelled out in fileStore.ts. `renderHtml` then
 * interpolates it into `<img src="…">`, and the HTML expo-print receives has no
 * base URL — so a relative src resolves against nothing and every still in the
 * report comes out blank, with no error anywhere to say why.
 *
 * Resolved HERE rather than in renderHtml because that module is deliberately
 * pure with types-only imports, so `node --test` can load it; reaching for
 * expo-file-system from there would break that.
 */
function resolveClipPaths(videos: Video[]): Video[] {
  return videos.map((v) =>
    v.thumbUri ? { ...v, thumbUri: toAbsoluteUri(v.thumbUri) } : v,
  );
}

/**
 * Everything in the period, in one round of queries.
 *
 * Videos are fetched per seizure rather than by date range, and that is not a
 * shortcut: `Video.seizureId` is non-nullable in the schema, so every clip in
 * the app belongs to exactly one seizure. Querying by the seizures already in
 * range therefore cannot miss one, and it avoids a video whose own timestamp
 * drifted outside the window turning up detached from the event it documents.
 */
export async function collectReport(
  dog: Dog,
  range: ReportRange,
): Promise<ReportData> {
  const [seizures, checkins, doses, medications] = await Promise.all([
    seizureRepo.listSeizuresBetween(dog.id, range.fromMs, range.toMs),
    checkinRepo.listCheckinsBetween(dog.id, range.fromKey, range.toKey),
    medicationRepo.listDosesBetween(dog.id, range.fromKey, range.toKey),
    // Best effort: a report must still be produced for a dog whose medication
    // list fails to load. The section prints what it has.
    medicationRepo.listMedications(dog.id).catch(() => [] as MedicationWithReminders[]),
  ]);

  const withClips = await Promise.all(
    seizures.map(async (s) => ({
      ...s,
      // A missing clip must not sink the whole report: the written record is
      // the part the vet needs, and a video row whose file the OS has since
      // cleared is a known, survivable state.
      videos: await videoRepo
        .listForSeizure(s.id)
        .then(resolveClipPaths)
        .catch(() => [] as Video[]),
    })),
  );

  return {
    dog,
    range,
    seizures: withClips,
    checkins,
    doses,
    medications,
    generatedAt: Date.now(),
  };
}

/**
 * The day the dog's records START, for an all-time report.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM `collectReport` ───────────────────
 *
 * `resolveRange('all', …)` cannot know where the history begins — `range.ts`
 * is pure and has no database. So the range for an all-time report is resolved
 * in two passes: find the floor here, then resolve and collect as normal.
 *
 * ── WHY ALL THREE TABLES AND NOT JUST SEIZURES ────────────────────────
 *
 * An owner can log check-ins for weeks before the first seizure, and can log
 * doses for a dog that has never had one recorded in the app. Anchoring on
 * seizures alone would silently clip that history off the front of an
 * "all records" report — the one scope whose entire promise is that nothing
 * was left out.
 *
 * Returns null when the dog has no records at all, which the caller turns into
 * a single-day range: an empty report about today, not an empty report about
 * 1970.
 */
export async function earliestRecordDay(
  dogId: string,
  dayKeyOf: (ms: number) => string,
): Promise<string | null> {
  const [seizures, checkins, doses] = await Promise.all([
    seizureRepo.listSeizures(dogId).catch(() => [] as Seizure[]),
    checkinRepo.listCheckins(dogId).catch(() => [] as DailyCheckin[]),
    // Day keys are stored as 'YYYY-MM-DD' TEXT, so this lexicographic floor is
    // an exact lower bound rather than a guess at how far back to look.
    medicationRepo
      .listDosesBetween(dogId, '0000-01-01', '9999-12-31')
      .catch(() => [] as DoseWithName[]),
  ]);

  // Compared as day KEYS, not timestamps. A key is already local-calendar and
  // sorts lexicographically, so this cannot repeat the timezone mistake that
  // `dayKeyOf` exists to prevent.
  let earliest: string | null = null;
  const consider = (key: string) => {
    if (!key) return;
    if (earliest === null || key < earliest) earliest = key;
  };

  for (const s of seizures) consider(dayKeyOf(s.start));
  for (const c of checkins) consider(c.checkInDate);
  for (const d of doses) consider(d.doseDate);

  return earliest;
}
