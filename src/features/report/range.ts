/**
 * Turning "Sunday" or "last week" into the exact span a report covers.
 *
 * ── WHY THIS IS ITS OWN MODULE, AND WHY IT IMPORTS NOTHING ────────────
 *
 * Every way this feature can quietly produce a WRONG document passes through
 * here. A boundary that is off by an hour moves a 23:30 seizure into the wrong
 * day; a boundary that is off by a day drops one entirely. Neither failure is
 * visible in the output — the report still looks complete, it is just missing
 * a seizure, and the vet reading it has no way to tell.
 *
 * So this is pure, and it has no runtime imports. `node --test` strips types
 * but does not resolve the `@/` alias, so a single value import from `@/` here
 * would make the whole module untestable. Types are fine — those are erased.
 * Same constraint, and the same reason, as `features/analytics/clusters.ts`.
 *
 * ── THE HALF-OPEN RULE ────────────────────────────────────────────────
 *
 * Every range is `[fromMs, toMs)`. Consecutive days therefore share no
 * instant, so a seizure at exactly 00:00:00.000 belongs to the day that is
 * beginning and to nothing else. A closed range would put it in both reports,
 * and an owner comparing Saturday to Sunday would count one seizure twice.
 */

export type ReportScope = 'day' | 'week';

export type ReportRange = {
  scope: ReportScope;
  /** Inclusive start, epoch ms, local midnight. */
  fromMs: number;
  /** EXCLUSIVE end, epoch ms, local midnight of the following day. */
  toMs: number;
  /** First day covered, `YYYY-MM-DD`. */
  fromKey: string;
  /** Last day covered INCLUSIVE, `YYYY-MM-DD`. Not the same day as `toMs`. */
  toKey: string;
  /** Every day key in the range, ascending. One entry for a day report. */
  dayKeys: string[];
};

/* ------------------------------------------------------------------ */
/* Day keys                                                            */
/* ------------------------------------------------------------------ */

/**
 * `YYYY-MM-DD` in the LOCAL timezone.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is the usual shortcut
 * and is wrong: that converts to UTC first, so for anyone west of Greenwich an
 * evening seizure gets tomorrow's date. In New York, 20:00 on the 30th is
 * 00:00 UTC on the 31st, and the whole evening would file under the wrong day.
 */
export function dayKeyOf(epochMs: number): string {
  const d = new Date(epochMs);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Local midnight starting the day a `YYYY-MM-DD` names. */
export function startOfDayKey(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  // Month is 0-based, and the explicit 0,0,0,0 is what pins this to LOCAL
  // midnight. `new Date('2026-08-30')` would parse as UTC midnight instead.
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}

/**
 * Local midnight `n` days after the one a key names.
 *
 * Adds to the DATE FIELD rather than adding `n * 86_400_000` to the timestamp,
 * and that is the whole point of the function. On the day a daylight-saving
 * change lands, the local day is 23 or 25 hours long, so fixed-millisecond
 * arithmetic drifts an hour and eventually lands at 23:00 the previous day —
 * silently shortening one report and lengthening its neighbour. `setDate`
 * rolls months and years correctly too.
 */
export function addDaysToKey(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  dt.setDate(dt.getDate() + n);
  return dayKeyOf(dt.getTime());
}

/* ------------------------------------------------------------------ */
/* Weeks                                                               */
/* ------------------------------------------------------------------ */

/**
 * The Monday on or before the given day.
 *
 * Monday rather than Sunday: it is the ISO-8601 week and the convention in
 * clinical records almost everywhere outside the US. Owners read a week report
 * as "the last seven days of treatment", and a week that splits the weekend
 * across two reports makes weekend-cluster patterns harder to see.
 */
export function startOfWeekKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  // getDay(): 0 = Sunday. Sunday is the SEVENTH day of an ISO week, so it
  // steps back six days, not zero — the case an off-by-one here would break.
  const offset = (dt.getDay() + 6) % 7;
  return addDaysToKey(dayKey, -offset);
}

/* ------------------------------------------------------------------ */
/* The range                                                           */
/* ------------------------------------------------------------------ */

/**
 * The span a report covers, from the day the owner picked.
 *
 * A week range is anchored on the Monday of the chosen day's week, so picking
 * any day in a week produces the same report. That is what makes the week
 * picker forgiving: an owner who taps Thursday meaning "this week" gets the
 * week, not Thursday-plus-six-days.
 */
export function resolveRange(scope: ReportScope, dayKey: string): ReportRange {
  const fromKey = scope === 'week' ? startOfWeekKey(dayKey) : dayKey;
  const dayCount = scope === 'week' ? 7 : 1;

  const dayKeys: string[] = [];
  for (let i = 0; i < dayCount; i += 1) dayKeys.push(addDaysToKey(fromKey, i));

  const toKey = dayKeys[dayKeys.length - 1] ?? fromKey;

  return {
    scope,
    fromMs: startOfDayKey(fromKey),
    // Midnight STARTING the day after the last one covered. Exclusive.
    toMs: startOfDayKey(addDaysToKey(toKey, 1)),
    fromKey,
    toKey,
    dayKeys,
  };
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

/**
 * How the period is named on screen and printed at the top of the file.
 *
 * Spelled out rather than numeric — `08/09` is September to half the world and
 * August to the other half, and this document is designed to be handed to
 * someone who was not there when it was generated.
 */
export function formatRangeLabel(range: ReportRange): string {
  const from = new Date(range.fromMs);
  if (range.scope === 'day') {
    return `${WEEKDAYS[from.getDay()]} ${from.getDate()} ${MONTHS[from.getMonth()]} ${from.getFullYear()}`;
  }
  const to = new Date(startOfDayKey(range.toKey));
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  const left = sameMonth
    ? `${from.getDate()}`
    : `${from.getDate()} ${MONTHS[from.getMonth()]}`;
  return `${left} – ${to.getDate()} ${MONTHS[to.getMonth()]} ${to.getFullYear()}`;
}

/** The stem of the exported file name. Sanitised by the caller. */
export function rangeFileStem(range: ReportRange): string {
  return range.scope === 'day'
    ? range.fromKey
    : `${range.fromKey}-to-${range.toKey.slice(5)}`;
}
