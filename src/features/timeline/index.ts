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

import { startOfDay } from '@/utils/time';
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
  retrospective?: boolean;
  /** Present on doses only. */
  doseStatus?: MedicationDose['status'];
};

export type TimelineSection = {
  day: number;
  title: string;
  data: TimelineEvent[];
};

/** Condenses a check-in into one scannable line. */
function checkinDetail(c: DailyCheckin): string {
  return [
    c.sleepHrs !== null ? `${c.sleepHrs}h sleep` : null,
    `energy ${c.energy}/5`,
    c.appetite !== 'normal' ? `${c.appetite} appetite` : null,
    c.water !== 'normal' ? `${c.water} water` : null,
    c.gi !== 'none' ? c.gi : null,
    c.medOnTime ? null : 'medication not on time',
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
