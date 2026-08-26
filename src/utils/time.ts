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

/**
 * '2m 14s' / '45s' — for display in lists and stats.
 *
 * Rounds to whole seconds FIRST. Rounding the remainder instead produces
 * '1m 60s' for 119.6 seconds, which reads as a bug on a vet report.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** '02:14' — for the running timer. Always zero-padded, stable width. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Start of the local day containing `epochMs`. */
export function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Start of the local day AFTER the one containing `epochMs`.
 *
 * Not `startOfDay(x) + DAY_MS`: on a daylight-saving change a local day is 23
 * or 25 hours long, so the fixed offset lands an hour inside the wrong day and
 * a check-in saved near midnight can be missed or double-counted.
 */
export function startOfNextDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function isSameLocalDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export const DAY_MS = 86_400_000;

/**
 * Local calendar day as 'YYYY-MM-DD' — the key the check-in unique index and
 * the dose log are built on.
 *
 * Built from the LOCAL date parts, not from toISOString(), which converts to
 * UTC and would file an 11pm check-in under tomorrow for anyone east of
 * Greenwich. Matches SQLite's date(..., 'localtime') used in migration 4.
 */
export function localDayKey(epochMs = Date.now()): string {
  const d = new Date(epochMs);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
