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
import type {
  DailyCheckin,
  Dog,
  MedicationDose,
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
  /** When the file was produced. Printed, so a reader can tell how fresh it is. */
  generatedAt: number;
};

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
  const [seizures, checkins, doses] = await Promise.all([
    seizureRepo.listSeizuresBetween(dog.id, range.fromMs, range.toMs),
    checkinRepo.listCheckinsBetween(dog.id, range.fromKey, range.toKey),
    medicationRepo.listDosesBetween(dog.id, range.fromKey, range.toKey),
  ]);

  const withClips = await Promise.all(
    seizures.map(async (s) => ({
      ...s,
      // A missing clip must not sink the whole report: the written record is
      // the part the vet needs, and a video row whose file the OS has since
      // cleared is a known, survivable state.
      videos: await videoRepo.listForSeizure(s.id).catch(() => [] as Video[]),
    })),
  );

  return {
    dog,
    range,
    seizures: withClips,
    checkins,
    doses,
    generatedAt: Date.now(),
  };
}
