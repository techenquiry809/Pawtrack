/**
 * Seizures per calendar day, for the home dashboard chart.
 *
 * ── WHY THIS IS EXTRACTED AND TESTED ──────────────────────────────────
 *
 * This is the arithmetic behind the first chart an owner sees, and it is the
 * chart they will hold up to a vet. It was previously an inline `useMemo` in
 * the Home screen bucketing on `now - start` in week-sized chunks, which was
 * wrong twice over: it showed weeks where the layout implied days, and rolling
 * subtraction put a late-evening seizure in the wrong bucket depending on what
 * time of day the owner happened to open the app.
 *
 * A chart that quietly moves an event to the wrong day is worse than no chart,
 * because it is still believed. So the maths lives here, in a module with no
 * runtime imports, and the cases below are pinned.
 */

/**
 * Local midnight for a timestamp.
 *
 * Duplicated from utils/time rather than imported: `node --test` strips types
 * but does not resolve the `@/` alias, so a runtime import from `@/utils/time`
 * would make this module untestable. Same constraint, and the same trade, as
 * features/analytics/clusters.ts.
 */
export function startOfLocalDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const DAY_MS = 86_400_000;

/**
 * Counts per day, oldest first, with the LAST entry always today.
 *
 * Buckets on calendar midnights, not on elapsed time. The difference shows up
 * every evening: at 09:00 a seizure from 22:00 yesterday is eleven hours old,
 * so elapsed-time bucketing files it under "today" and the chart contradicts
 * the record the owner just read.
 *
 * Days with nothing keep their zero. The gaps between events are most of what
 * a seizure chart is read for, so a compacted series that dropped quiet days
 * would destroy the only pattern that matters.
 */
export function seizuresPerDay(
  startsMs: readonly number[],
  days: number,
  nowMs: number = Date.now(),
): number[] {
  const todayStart = startOfLocalDay(nowMs);
  const buckets = new Array<number>(days).fill(0);

  for (const start of startsMs) {
    // Rounded, not floored: across a daylight-saving boundary the gap between
    // two local midnights is 23 or 25 hours, so a floor would report a
    // whole-day difference as 0.958 days and land the event one bucket late.
    const daysAgo = Math.round((todayStart - startOfLocalDay(start)) / DAY_MS);
    if (daysAgo >= 0 && daysAgo < days) {
      const slot = days - 1 - daysAgo;
      buckets[slot] = (buckets[slot] ?? 0) + 1;
    }
  }
  return buckets;
}
