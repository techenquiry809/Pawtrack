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

/**
 * '13h 47m' / '3d 4h' / '45m' — for the GAP BETWEEN two events.
 *
 * Deliberately separate from formatDuration. That one formats how long a
 * seizure lasted, where minutes-and-seconds is the right resolution and hours
 * never occur. This one formats how long it has been SINCE something, where
 * minutes-and-seconds produces "827m 33s" — a number no owner can read and no
 * vet would ever write down.
 *
 * Resolution drops as the interval grows, which is how people actually talk
 * about elapsed time: seconds matter within a minute, they are noise after a
 * day.
 */
export function formatInterval(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));

  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
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

export const DAY_MS = 86_400_000;

/**
 * Whether a record carries a clock time the owner actually gave.
 *
 * Both confidence scales in the app — `Seizure.timingConfidence`
 * ('exact' | 'approximate' | 'unknown') and `Video.captureConfidence`
 * ('device' | 'owner_stated' | 'unknown') — use the SAME word for the same
 * fact, so one predicate serves both.
 */
export function hasKnownTime(confidence: string): boolean {
  return confidence !== 'unknown';
}

/**
 * The clock time, or null when the record has none.
 *
 * ── WHY THIS IS NOT `toLocaleTimeString` AT THE CALL SITE ─────────────
 *
 * A blank time is stored as the START OF THAT DAY (see DateTimeField), with
 * the confidence field set to 'unknown' so the record stays honest about it.
 * Formatting `start` unconditionally turns that sentinel back into a reading:
 * every seizure the owner could not time was printed as "00:00", which looks
 * exactly like a seizure that happened at midnight. On a screen an owner shows
 * their vet, a placeholder that is indistinguishable from a measurement is the
 * one thing this codebase refuses to do everywhere else — the duration figures
 * already gate on `durationConfidence` for the same reason.
 *
 * Returning null rather than a dash is deliberate: the absence is not worth
 * announcing. The date alone is the honest record, and a row that simply shows
 * "1 Sep" reads as complete, where "1 Sep, —" reads as damaged.
 */
export function timeOfDay(epochMs: number, timeKnown: boolean): string | null {
  if (!timeKnown) return null;
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * 'Tuesday 1 September' — the full, unambiguous date.
 *
 * Spelled out rather than numeric because `01/09` is September to half the
 * world and January to the other half, and these dates are read aloud to vets
 * and printed on records that leave the phone.
 *
 * Extracted because four screens had built this same option object by hand
 * (check-in flow, seizure detail, video detail, the calendar header). Three
 * copies is where a shared helper starts paying for itself; four is where they
 * start drifting.
 */
export function formatFullDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** '1 Sep' — the compact form, for list rows and tiles where space is tight. */
export function formatShortDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

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

/**
 * The hour a "day" starts for the Daily Pulse, in local time.
 *
 * Not midnight, because midnight is not when people go to bed. The pulse asks
 * how the dog's day went; someone still awake at 1am is answering for the day
 * that is ending, and a card that reappears the moment the clock rolls over
 * asks them the same question twice in one evening — then leaves the day they
 * actually meant unanswered.
 *
 * 4am is late enough to sit past almost every bedtime and early enough that
 * nobody who wakes up normally finds yesterday's card still waiting.
 */
/**
 * A stored 'HH:MM' reminder time, written the way people say it: '7:00 am'.
 *
 * ── DISPLAY ONLY. THE STORED FORM NEVER CHANGES ───────────────────────
 *
 * `medication_reminders.time_hhmm` stays 24-hour, and must: it sorts
 * lexicographically (which is how the dose list orders its slots), it is what
 * the notification scheduler parses, and it is the same string on every
 * device regardless of the owner's locale. Only what a person READS is
 * converted here.
 *
 * Lower-case 'am'/'pm' rather than 'AM'/'PM' — the app's own voice is quiet,
 * and a shouted meridiem next to a large time reads as an abbreviation to
 * decode rather than as a word.
 */
export function formatTimeOfDay(timeHHMM: string): string {
  const [rawHour, rawMinute] = timeHHMM.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  // Anything unparseable is handed back untouched. A reminder showing '25:99'
  // is a visible bug someone can report; one silently rendered as '1:99 am' is
  // a wrong time on a medication screen.
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return timeHHMM;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return timeHHMM;

  const meridiem = hour < 12 ? 'am' : 'pm';
  // 0 and 12 both map to 12: midnight is 12 am, noon is 12 pm.
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

export const PULSE_DAY_START_HOUR = 4;

/**
 * Which day the Daily Pulse is currently asking about, as 'YYYY-MM-DD'.
 *
 * The calendar day of four hours ago, so 00:00–03:59 still belongs to the day
 * before. This is a LOCAL calculation on the device's own clock, so it follows
 * the owner across timezones without any stored offset — fly to Sydney and the
 * pulse rolls over at 4am Sydney time, on the Sydney date.
 *
 * ── IT IS NOT A REPLACEMENT FOR localDayKey ───────────────────────────
 *
 * Only the pulse uses this. `localDayKey` remains the key for the check-in
 * unique index, the dose log, the calendar and reports, and it must: those are
 * calendar records that a vet reads, and quietly filing a 2am entry under
 * "yesterday" in a medical history would be a lie of exactly the kind this
 * app cannot afford. The pulse is a mood tap, not a medical record, and it is
 * the one place the softer boundary is both wanted and harmless.
 *
 * The consequence is deliberate and worth knowing: a mood tapped at 2am is
 * stored against the previous calendar date, which is the date the owner meant
 * — and is what the Check-in tab will show it under.
 */
export function pulseDayKey(epochMs = Date.now()): string {
  return localDayKey(epochMs - PULSE_DAY_START_HOUR * 60 * 60 * 1000);
}
