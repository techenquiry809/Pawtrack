/**
 * Sign-in throttling maths.
 *
 * Split out of authStore for one reason: authStore imports supabase, the
 * database and the sync layer through the `@/` alias, and `node --test`
 * strips types but does not resolve that alias. Keeping these two functions
 * pure and import-free is what makes them testable — the same split, for the
 * same reason, as features/report/range.ts and services/authErrors.ts.
 */

/**
 * Client-side throttling on sign-in and on the reset email.
 *
 * ── THIS IS A UX AFFORDANCE, NOT A SECURITY CONTROL ───────────────────
 *
 * It lives in memory in this store, so it is cleared by killing the app and is
 * bypassed entirely by anyone talking to the API directly. It stops NOTHING.
 * Do not treat it as brute-force protection, and do not "harden" it by moving
 * the counter into SQLite — a local counter the attacker owns is theatre
 * wherever it is stored.
 *
 * The REAL limit is Supabase's server-side rate limiting (Auth → Rate Limits;
 * the values in force are recorded in docs/SECURITY.md). What this adds is the
 * one thing a server limit cannot: telling the person holding the phone what
 * is happening. Without it, a fourth wrong password produces the same red
 * panel as the third, and then the server starts refusing outright — at which
 * point the app looks broken rather than cautious.
 *
 * Two separate clocks, because they guard different things:
 *
 *   sign-in       backs off after repeated wrong passwords
 *   reset email   a flat cooldown, because each press sends MAIL to an address
 *                 whose owner may not be the one pressing the button
 */

/** Wrong passwords tolerated before the backoff starts. */
const FREE_ATTEMPTS = 3;
/** First backoff step; doubles per failure, capped by MAX_BACKOFF_MS. */
const BASE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 300_000;
/** One reset email per minute — enough to stop double-taps and mashing. */
export const RESET_COOLDOWN_MS = 60_000;

export function signInBackoffMs(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const step = failures - FREE_ATTEMPTS - 1;
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** step);
}

/**
 * Whole seconds left on a deadline, or 0.
 *
 * Rounded UP so a countdown never shows "0s" while the button is still
 * disabled — the state that reads as a broken app.
 */
export function secondsUntil(deadline: number | null, now = Date.now()): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
