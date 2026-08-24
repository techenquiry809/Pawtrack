/**
 * Time formatting and duration helpers.
 *
 * Everything here works on epoch milliseconds or elapsed seconds. We
 * deliberately avoid a date library: the app only needs formatting and simple
 * arithmetic, and JS Date + Intl handle timezone and DST correctly for both.
 *
 * DST note: because durations are computed by subtracting two absolute epoch
 * timestamps, a seizure spanning a DST change still reports the true elapsed
 * time. Do not "fix" this by comparing wall-clock components.
 */

/** '2m 14s' / '45s' — for display in lists and stats. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** '02:14' — for the running timer. Always zero-padded, stable width. */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Start of the local day containing `epochMs`. */
export function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isSameLocalDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export const DAY_MS = 86_400_000;
