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
 * Three separate clocks, because they guard different things:
 *
 *   sign-in       backs off after repeated wrong passwords
 *   reset email   a flat cooldown, because each press sends MAIL to an address
 *                 whose owner may not be the one pressing the button
 *   sign-up       backs off after repeated attempts, because the signup form
 *                 now ANSWERS "does this email have an account?" — see below
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


/**
 * Backoff between signup attempts.
 *
 * ── WHY THE SIGNUP FORM NEEDS ONE AT ALL ──────────────────────────────
 *
 * It did not, while signup was silent about existing accounts. It does now:
 * the form tells the person "an account already exists for this email", which
 * is a deliberate, documented trade against account enumeration (see
 * app/(auth)/sign-up.tsx and docs/SECURITY.md). Honest copy for the owner who
 * forgot they had signed up is worth more than the secrecy — but only if the
 * answer cannot be harvested in bulk.
 *
 * ── AND WHY IT IS STILL NOT THE REAL CONTROL ──────────────────────────
 *
 * Read the note at the top of this file and believe it. This counter lives in
 * a Zustand store on the attacker's own phone. Anyone scripting an enumeration
 * scan is talking to the Supabase REST endpoint directly and never executes a
 * line of this. It stops a person mashing the button and it makes casual
 * probing through the UI tedious; it does NOT stop a scan.
 *
 * The control that does is Supabase's server-side rate limiting on
 * /auth/v1/signup, which is per-IP and cannot be reached around. The values in
 * force are recorded in docs/SECURITY.md, and that is the number to change if
 * enumeration resistance ever needs to be tightened.
 *
 * Deliberately gentler than the sign-in ladder: a wrong password is one person
 * failing at one account, but a slow signup form punishes every new owner for
 * a threat model none of them are in. Two free attempts covers the ordinary
 * "typo, then retry" and starts costing only after that.
 */
const SIGNUP_FREE_ATTEMPTS = 2;
const SIGNUP_BASE_BACKOFF_MS = 5_000;
const SIGNUP_MAX_BACKOFF_MS = 120_000;

export function signUpBackoffMs(attempts: number): number {
  if (attempts <= SIGNUP_FREE_ATTEMPTS) return 0;
  const step = attempts - SIGNUP_FREE_ATTEMPTS - 1;
  return Math.min(SIGNUP_MAX_BACKOFF_MS, SIGNUP_BASE_BACKOFF_MS * 2 ** step);
}

/**
 * The wait the SERVER just told us to take, in milliseconds, or null.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * RESET_COOLDOWN_MS is a guess. It is a reasonable guess, but it is a local
 * constant and the real limit lives in the Supabase project's Auth → Rate
 * Limits settings, so the two drift the moment anyone changes that dashboard
 * — and they drift in the direction that looks like a broken app: the button
 * re-enables at 60s, the owner presses it, and the server refuses because its
 * own window had not closed yet.
 *
 * GoTrue states the remaining time in the body of its 429 ("For security
 * purposes, you can only request this after 47 seconds"), which is the
 * authoritative number. When it is there we use it; when it is not we keep
 * the local guess. That is the only way the countdown on screen can be a
 * promise rather than an estimate.
 *
 * Parsed from the message rather than a header because the supabase-js
 * AuthError surfaces `status` and `message` but does not expose response
 * headers, so Retry-After is not reachable from here.
 *
 * Deliberately tolerant: an unrecognised message returns null and the caller
 * falls back. A rate-limit notice we cannot parse must never become a zero.
 */
export function serverStatedWaitMs(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;

  const status = (error as { status?: unknown }).status;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return null;

  // Only trust a number that came with a rate-limit status, or a message that
  // is unmistakably about one. Scraping digits out of arbitrary error text
  // would eventually read a user id as a duration.
  const looksRateLimited =
    status === 429 || /you can only request this after|rate limit|too many requests/i.test(message);
  if (!looksRateLimited) return null;

  const match = /after (\d+) second/i.exec(message);
  if (!match?.[1]) return null;

  const seconds = Number.parseInt(match[1], 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  // Capped at an hour. A server telling us to wait a week is either a bug or
  // an attack on the owner's ability to use their own account, and honouring
  // it literally would brick the screen with no way back.
  return Math.min(seconds, 3_600) * 1_000;
}
