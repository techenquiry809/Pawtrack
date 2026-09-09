/**
 * The merged day-by-day feed.
 *
 * This was the Timeline tab. The tab is gone — its slot went to Daily
 * Check-in — but the view itself was not deleted: it is now History's
 * "Everything" mode. The merge logic lives here rather than in a screen so
 * both the extraction and any future surface (a vet report, say) share one
 * definition of what "everything that happened" means.
 *
 * Pure functions over already-loaded records. No SQL, no React.
 */

import { hasKnownTime, startOfDay } from '@/utils/time';
import type { DailyCheckin, MedicationDose, Seizure } from '@/types/domain';

export type TimelineEventKind = 'seizure' | 'medication' | 'checkin';

export type TimelineEvent = {
  id: string;
  kind: TimelineEventKind;
  timestamp: number;
  detail: string;
  /** Present on seizures only — opens the record. */
  seizureId?: string;
  durationSec?: number;
  durationConfidence?: Seizure['durationConfidence'];
  /**
   * Present on seizures only. 'unknown' means the owner never gave a clock
   * time, so `timestamp` is the start of that day rather than an observation.
   *
   * Absent on doses and check-ins — which does NOT mean their timestamps are
   * always real, the mistake the old note here made. Ask `showTime` for that;
   * it is the only field that answers the question for every kind.
   */
  timingConfidence?: Seizure['timingConfidence'];
  /**
   * Whether `timestamp` is an observed clock time that a row may print.
   *
   * ── WHY THIS IS NOT DERIVED IN THE ROW ────────────────────────────────
   *
   * It used to be. The row asked `timingConfidence === undefined ||
   * hasKnownTime(...)`, on the stated assumption that "doses and check-ins
   * carry no timingConfidence and their timestamps are always real".
   *
   * That is false for a BACKFILLED check-in. checkinRepo.upsertCheckinForDate
   * deliberately stamps those with local MIDDAY of the day being described, so
   * they sort into the right day instead of appearing to have happened at the
   * moment they were typed. It is a sorting key, not an observation — and the
   * timeline printed it as "12:00 pm", telling the owner they checked in at
   * noon on a day they were recalling from memory, on a record they may hand
   * to a vet.
   *
   * So the question "is this a real time?" is answered HERE, by the code that
   * knows what each timestamp means, once per kind, instead of by a rendering
   * rule that has to keep guessing.
   */
  showTime: boolean;
  retrospective?: boolean;
  /** Present on doses only. */
  doseStatus?: MedicationDose['status'];
};

export type TimelineSection = {
  day: number;
  title: string;
  data: TimelineEvent[];
};

/**
 * How much of a note the line will carry before it is cut.
 *
 * The row gives the detail two lines and truncates, so a long note would push
 * everything else out of view. Short enough to stay a trailing clause, long
 * enough that most notes ("wobbly after her walk") arrive whole.
 */
const NOTE_LIMIT = 60;

/**
 * Condenses a check-in into one scannable line.
 *
 * ── WHAT IT MAY AND MAY NOT SAY ───────────────────────────────────────
 *
 * A `mood_only` row is one created by tapping a face on Home. Its energy is
 * real and every other column is a SCHEMA DEFAULT that nobody answered —
 * appetite 'normal', water 'normal', stress 2, gut 'none', medication on time.
 * The report (features/report/renderHtml.ts) dashes those columns and the
 * calendar (components/CheckinCalendar.tsx) says "only the mood was set", both
 * for the same reason: printing a default back as an observation manufactures
 * a clinical claim, and the owner may repeat it to a vet.
 *
 * The timeline was the one surface that did not honour that rule. It got away
 * with it by accident — its filters happen to drop every default it prints,
 * so nothing false appeared — but the line it produced for a single tap,
 * "energy 3/5", was character-for-character the line it produced for a fully
 * answered day whose answers were all normal. Two very different records,
 * indistinguishable in the feed.
 *
 * So mood-only rows now say what they are, and answered rows say more:
 *
 *   - stress, which was collected and never shown anywhere in the feed
 *   - the free-text note, which is the one field the owner wrote in their own
 *     words and the one most likely to be the reason they opened the day
 *
 * Defaults stay filtered on answered rows. That is a LENGTH decision, not the
 * honesty one above: "normal appetite · normal water · no gut trouble" on
 * every ordinary day would bury the days that differ. The calendar's day
 * summary prints every answer including the defaults, and the row links there.
 */
function checkinDetail(c: DailyCheckin): string {
  const note = c.unusual.trim();
  const shortNote =
    note.length > NOTE_LIMIT ? `${note.slice(0, NOTE_LIMIT - 1).trimEnd()}…` : note;

  if (c.moodOnly) {
    // No "·" list here on purpose: there is exactly one fact, and the clause
    // after it is the disclaimer, not another observation.
    return `Energy ${c.energy}/5 — mood only, nothing else recorded`;
  }

  return [
    c.sleepHrs !== null ? `${c.sleepHrs}h sleep` : null,
    `energy ${c.energy}/5`,
    `stress ${c.stress}/5`,
    c.appetite !== 'normal' ? `${c.appetite} appetite` : null,
    c.water !== 'normal' ? `${c.water} water` : null,
    c.gi !== 'none' ? c.gi : null,
    c.medOnTime ? null : 'medication not on time',
    shortNote.length > 0 ? `“${shortNote}”` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const DOSE_DETAIL: Record<MedicationDose['status'], string> = {
  given: 'given on time',
  late: 'given late',
  missed: 'not given',
};

export function buildEvents(input: {
  seizures: Seizure[];
  checkins: DailyCheckin[];
  doses: (MedicationDose & { medicationName: string })[];
  include: { seizure: boolean; medication: boolean; checkin: boolean };
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (input.include.seizure) {
    for (const s of input.seizures) {
      events.push({
        id: `s_${s.id}`,
        kind: 'seizure',
        timestamp: s.start,
        detail: s.ictalObs.slice(0, 3).join(', ') || 'No observations logged',
        seizureId: s.id,
        durationSec: s.durationSec,
        durationConfidence: s.durationConfidence,
        timingConfidence: s.timingConfidence,
        // 'unknown' means the owner never gave a clock time and `timestamp` is
        // the start of that day — the row is already filed under that day's
        // heading, so there is nothing left to print.
        showTime: hasKnownTime(s.timingConfidence),
        retrospective: s.retrospective,
      });
    }
  }

  if (input.include.medication) {
    for (const d of input.doses) {
      events.push({
        id: `d_${d.id}`,
        kind: 'medication',
        // recordedAt, not the scheduled slot: this feed shows what happened
        // and when the owner said so.
        timestamp: d.recordedAt,
        detail: `${d.medicationName} — ${DOSE_DETAIL[d.status]}`,
        // `recordedAt` is the moment the owner answered. Always a real clock
        // reading, on every dose, however late it was logged.
        showTime: true,
        doseStatus: d.status,
      });
    }
  }

  if (input.include.checkin) {
    for (const c of input.checkins) {
      events.push({
        id: `c_${c.id}`,
        kind: 'checkin',
        timestamp: c.timestamp,
        detail: checkinDetail(c),
        // A same-day check-in is stamped with the moment it was saved, which is
        // a real time. A backfilled one is stamped with local midday purely so
        // it sorts into the day it describes — see the note on `showTime`.
        showTime: !c.backfilled,
        // Drives the same badge slot as a seizure's "logged later" — the row
        // words it as "Filled in later" for a check-in, matching the pill the
        // Today card and the calendar already show for this exact fact.
        //
        // It carries the meaning the suppressed time used to imply: with no
        // clock reading on the row, an owner scanning the feed would otherwise
        // have no way to tell a day recalled from memory from one recorded as
        // it happened.
        retrospective: c.backfilled,
      });
    }
  }

  return events.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Groups into local days. Uses startOfDay rather than a formatted string so
 * the grouping matches the rest of the app's day arithmetic exactly.
 */
export function groupByDay(
  events: TimelineEvent[],
  labelFor: (dayStart: number) => string,
): TimelineSection[] {
  const byDay = new Map<number, TimelineEvent[]>();
  for (const e of events) {
    const key = startOfDay(e.timestamp);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(e);
    else byDay.set(key, [e]);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, data]) => ({ day, title: labelFor(day), data }));
}

export function dayLabel(dayStart: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (dayStart === today) return 'Today';
  if (dayStart === startOfDay(now - 86_400_000)) return 'Yesterday';
  const d = new Date(dayStart);
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
