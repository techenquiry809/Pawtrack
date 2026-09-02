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

/**
 * The four spans a report can cover.
 *
 *   day    one calendar day
 *   week   the ISO week (Monday–Sunday) containing the chosen day
 *   month  the calendar month containing the chosen day
 *   all    every record the dog has, from the first one to the chosen day
 *
 * 'all' is the only scope that cannot be derived from the chosen day alone —
 * it needs to know when the records START, which lives in the database. That
 * arrives as the optional `earliestKey` argument to `resolveRange`, so this
 * module stays pure and testable.
 */
export type ReportScope = 'day' | 'week' | 'month' | 'all';

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
/* Months                                                              */
/* ------------------------------------------------------------------ */

/** The first day of the month a key falls in. */
export function startOfMonthKey(dayKey: string): string {
  const [y, m] = dayKey.split('-');
  return `${y}-${m}-01`;
}

/**
 * The LAST day of the month a key falls in.
 *
 * Derived by stepping to the first of the next month and back one day rather
 * than from a table of month lengths — that is what makes February correct in
 * a leap year without this module needing to know what a leap year is.
 */
export function endOfMonthKey(dayKey: string): string {
  const [y, m] = dayKey.split('-').map(Number);
  const year = y ?? 1970;
  const month = (m ?? 1) - 1;
  // Month 12 rolls the year over on its own; Date handles that.
  const firstOfNext = new Date(year, month + 1, 1, 0, 0, 0, 0);
  return dayKeyOf(firstOfNext.getTime() - 1);
}

/**
 * Whole days from `fromKey` to `toKey`, inclusive of both ends.
 *
 * Computed by walking local midnights rather than dividing a millisecond
 * difference by 86_400_000, for the daylight-saving reason spelled out on
 * `addDaysToKey`: across a DST boundary the naive division is off by an hour,
 * and `Math.round` on it silently gains or loses a day near the year's edges.
 */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const from = startOfDayKey(fromKey);
  const to = startOfDayKey(toKey);
  if (to < from) return 0;
  let n = 1;
  let cursor = fromKey;
  // The cap is a guard against a corrupt key, not a product limit: a report
  // over a range this long is already broken, and an unbounded loop here would
  // hang the export instead of producing a wrong one that can be seen.
  while (startOfDayKey(cursor) < to && n < MAX_RANGE_DAYS) {
    cursor = addDaysToKey(cursor, 1);
    n += 1;
  }
  return n;
}

/**
 * The most days a single report will enumerate.
 *
 * Twelve years is past any realistic canine history, so hitting this means a
 * bad date rather than a long-lived dog. The range is truncated to its LATEST
 * days when it trips, because a report missing its oldest history is a
 * recoverable disappointment where a hung export is not.
 */
export const MAX_RANGE_DAYS = 4400;

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
export function resolveRange(
  scope: ReportScope,
  dayKey: string,
  /**
   * Day of the OLDEST record this dog has, `YYYY-MM-DD`. Only 'all' reads it.
   *
   * Omitted (or later than `dayKey`) collapses an all-time report to the
   * single chosen day, which is the right answer for a dog with no history:
   * an empty report about today, not an empty report about 1970.
   */
  earliestKey?: string,
): ReportRange {
  let fromKey: string;
  let toKey: string;

  switch (scope) {
    case 'week':
      fromKey = startOfWeekKey(dayKey);
      toKey = addDaysToKey(fromKey, 6);
      break;
    case 'month':
      // Anchored on the CALENDAR month, so picking any day in August gives
      // the whole of August — the same forgiveness the week picker has.
      fromKey = startOfMonthKey(dayKey);
      toKey = endOfMonthKey(dayKey);
      break;
    case 'all':
      fromKey =
        earliestKey && startOfDayKey(earliestKey) <= startOfDayKey(dayKey)
          ? earliestKey
          : dayKey;
      toKey = dayKey;
      break;
    case 'day':
    default:
      fromKey = dayKey;
      toKey = dayKey;
      break;
  }

  const dayCount = daysBetweenKeys(fromKey, toKey);
  const dayKeys: string[] = [];
  for (let i = 0; i < dayCount; i += 1) dayKeys.push(addDaysToKey(fromKey, i));

  // `dayCount` is capped, so re-derive the start from the LAST day rather than
  // trusting `fromKey` — otherwise a truncated range would claim to begin
  // somewhere it does not actually cover.
  fromKey = dayKeys[0] ?? fromKey;
  toKey = dayKeys[dayKeys.length - 1] ?? fromKey;

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

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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
  const to = new Date(startOfDayKey(range.toKey));

  if (range.scope === 'day') {
    return `${WEEKDAYS[from.getDay()]} ${from.getDate()} ${MONTHS[from.getMonth()]} ${from.getFullYear()}`;
  }

  // A month names itself. "1 – 31 Aug 2026" is the same span written in a way
  // that makes the reader do arithmetic to notice it is a whole month.
  if (range.scope === 'month') {
    return `${MONTHS_FULL[from.getMonth()]} ${from.getFullYear()}`;
  }

  const span = spanLabel(from, to);

  // An all-time report says so, then says what "all" turned out to mean. The
  // span is the part a vet needs: "everything" is only meaningful once you
  // know the records start eight months ago and not eight years.
  if (range.scope === 'all') return `All records · ${span}`;

  return span;
}

/** `24 – 30 Aug 2026`, collapsing the parts both ends share. */
function spanLabel(from: Date, to: Date): string {
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  if (from.getTime() === to.getTime()) {
    return `${from.getDate()} ${MONTHS[from.getMonth()]} ${from.getFullYear()}`;
  }
  const left = sameMonth
    ? `${from.getDate()}`
    : sameYear
      ? `${from.getDate()} ${MONTHS[from.getMonth()]}`
      : `${from.getDate()} ${MONTHS[from.getMonth()]} ${from.getFullYear()}`;
  return `${left} – ${to.getDate()} ${MONTHS[to.getMonth()]} ${to.getFullYear()}`;
}

/** The stem of the exported file name. Sanitised by the caller. */
export function rangeFileStem(range: ReportRange): string {
  switch (range.scope) {
    case 'day':
      return range.fromKey;
    // `2026-08`, so a folder of monthly reports sorts chronologically and
    // reads as a month at a glance.
    case 'month':
      return range.fromKey.slice(0, 7);
    case 'all':
      return `all-to-${range.toKey}`;
    case 'week':
    default:
      return `${range.fromKey}-to-${range.toKey.slice(5)}`;
  }
}
