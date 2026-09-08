/**
 * Whether this USER has agreed to the Terms and the Privacy Policy.
 *
 * ── IT BELONGS TO THE ACCOUNT NOW, NOT THE DEVICE ─────────────────────
 *
 * This used to be a device fact in local sync_state, because the app could be
 * used with no account. Signing in is now the first thing that happens, so the
 * record lives on `public.profiles` under the same RLS policy as the rest of
 * that row. See supabase/migrations/20260906000100_profile_consent.sql, and
 * migration 14 for the removal of the old device-level keys.
 *
 * That change fixes three things the device version could not: the same person
 * on a second phone is not asked twice, a wiped phone does not erase the only
 * evidence anyone agreed, and "who accepted which version, and when" becomes a
 * question with an answer.
 *
 * ── WHY THERE IS STILL A LOCAL COPY ───────────────────────────────────
 *
 * A CACHE of the server's answer, not a second source of truth.
 *
 * The gate runs at launch, and this app is used on bad connections next to a
 * sick animal. Without a cache, every offline launch would either block the
 * owner at an agreement screen they had already signed, or let them through on
 * an assumption. Neither is acceptable, so the last known server answer is
 * kept and trusted while offline.
 *
 * It is keyed BY USER ID. A device-wide cache would tell the next person to
 * sign in that they had already agreed, which is the exact bug that moving
 * this to the account was meant to end.
 *
 * ── WRITE ORDER, AND WHY ACCEPTING WORKS OFFLINE ──────────────────────
 *
 * Accepting writes the cache first, then pushes to the server. A failed push
 * leaves the acceptance recorded locally and PENDING, and `flushPendingConsent`
 * retries it on the next sync. The owner is never held at a legal screen
 * because the network is down — they agreed, the app knows it, and the server
 * finds out when it can.
 */

import { getSyncValue, setSyncValue } from '@/db/syncState';
import { getSupabase } from '@/services/supabase';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/constants/legal';

/** Cache keys are per-user; see the note above on why. */
const cacheKey = (userId: string) => `consent_cache_${userId}`;
const pendingKey = (userId: string) => `consent_pending_${userId}`;

/**
 * The exact pair of versions currently in force, as one comparable string.
 *
 * Both documents in one value because they are accepted together and there is
 * no UI that accepts one without the other. Storing them separately would
 * invite a half-consented state that nothing in the app can resolve.
 */
const CURRENT = `${TERMS_VERSION}|${PRIVACY_VERSION}`;

export type ConsentState = {
  /** True only when BOTH documents are accepted at their current versions. */
  granted: boolean;
  /**
   * True when this user previously agreed to an OLDER version. Lets the gate
   * say "we've updated these" rather than showing a first-run screen to
   * someone who has been using the app for a year.
   */
  isUpdate: boolean;
};

/**
 * What this user has agreed to.
 *
 * Reads the cache first and returns immediately when it matches — the common
 * case, and the one that must not wait on a network round trip at launch.
 * Otherwise asks the server, which is also what catches a re-consent needed
 * because the documents changed, or an acceptance made on another device.
 */
export async function readConsent(userId: string): Promise<ConsentState> {
  const cached = await getSyncValue(cacheKey(userId));
  if (cached === CURRENT) return { granted: true, isUpdate: false };

  // An empty string is the cleared state written by clearConsentCache, and
  // means the same as absent: nothing known about this user on this device.
  const hadCache = cached !== null && cached !== '';

  const supabase = getSupabase();
  if (!supabase) {
    // No sync configured at all. Nothing can be stored server-side, so the
    // cache is all there is — and it did not match.
    return { granted: false, isUpdate: hadCache };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('terms_version, privacy_version')
      .eq('user_id', userId)
      .maybeSingle();

    // Offline, or the row is not readable. Fall back to what the cache knows.
    // Deliberately NOT treated as "never agreed": that would re-prompt an
    // offline owner who has agreed, on every launch.
    if (error) return { granted: false, isUpdate: hadCache };

    const terms = (data?.terms_version ?? null) as string | null;
    const privacy = (data?.privacy_version ?? null) as string | null;
    const server = terms !== null && privacy !== null ? `${terms}|${privacy}` : null;

    if (server === CURRENT) {
      // Agreed on another device, or before this phone had a cache.
      await setSyncValue(cacheKey(userId), CURRENT);
      return { granted: true, isUpdate: false };
    }

    // Something was accepted, but not what is in force now.
    return { granted: false, isUpdate: server !== null || hadCache };
  } catch {
    return { granted: false, isUpdate: hadCache };
  }
}

/**
 * Record this user's agreement to both documents at their current versions.
 *
 * Never throws. A network failure must not strand someone on a legal screen,
 * so the local record is authoritative for letting them in and the server is
 * brought up to date by `flushPendingConsent` on the next sync.
 */
export async function grantConsent(
  userId: string,
  now: number = Date.now(),
): Promise<void> {
  await setSyncValue(cacheKey(userId), CURRENT);
  await setSyncValue(pendingKey(userId), '1');
  await flushPendingConsent(userId, now);
}

/**
 * Push a locally-recorded acceptance to the account, if one is outstanding.
 *
 * Idempotent and cheap when there is nothing to do — one key read. Called
 * after accepting and again from the sync worker, so an acceptance made on a
 * train reaches the account without the owner doing anything.
 */
export async function flushPendingConsent(
  userId: string,
  now: number = Date.now(),
): Promise<void> {
  if ((await getSyncValue(pendingKey(userId))) !== '1') return;

  const supabase = getSupabase();
  if (!supabase) return;

  try {
    /*
     * UPDATE, not upsert.
     *
     * `profiles` requires full_name (NOT NULL) and is created by
     * reconcileProfile() on sign-in. An upsert from here would either have to
     * invent a name to satisfy the constraint or fail the whole write — and
     * inventing one would overwrite the real name the owner typed at signup.
     *
     * If no row exists yet the update simply matches nothing, the pending flag
     * stays set, and the next flush succeeds once the profile is written.
     */
    const { error } = await supabase
      .from('profiles')
      .update({
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        consented_at: now,
        updated_at: now,
      })
      .eq('user_id', userId);

    if (error) {
      console.warn('[consent] could not record agreement on the account', error.message);
      return;
    }
    await setSyncValue(pendingKey(userId), '');
  } catch (e) {
    // Left pending on purpose. The next sync tries again.
    console.warn('[consent] consent push failed', e);
  }
}

/**
 * Forget the cached answer for one user on this device.
 *
 * Only the CACHE — the account's record is untouched, because removing data
 * from a phone is not a withdrawal of consent. Used when an account's data is
 * removed from this device, so the cache does not outlive what it belonged to.
 */
export async function clearConsentCache(userId: string): Promise<void> {
  await setSyncValue(cacheKey(userId), '');
  await setSyncValue(pendingKey(userId), '');
}
