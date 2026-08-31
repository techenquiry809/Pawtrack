/**
 * The device registry, and revocation.
 *
 * ── WHY THERE IS NO SINGLE-SESSION POLICY ─────────────────────────────
 *
 * Signing in on a second device does not sign the first one out. Four reasons,
 * in descending order of how much they should settle the argument:
 *
 * 1. IT WOULD MAKE SOMEONE LOG IN DURING A SEIZURE. This is an emergency app.
 *    A single-session policy means the moment an owner signs in on their iPad,
 *    the phone in their pocket — the one they grab when the dog starts
 *    convulsing — is showing a login screen. Nothing below outweighs this.
 *
 * 2. IT STRANDS UNSYNCED HEALTH RECORDS. A forced sign-out lands on a device
 *    that may be holding a full outbox. Kick a phone carrying twelve seizures
 *    it never managed to push and those records are gone.
 *
 * 3. IT CONTRADICTS THE FEATURE. The point is for records to follow the owner
 *    across devices. One-device-at-a-time is the opposite of that.
 *
 * 4. IT DOES NOT ACTUALLY WORK. Supabase access tokens are stateless JWTs,
 *    valid until they expire regardless of what the server thinks. Revoking a
 *    REFRESH token is instant; the access token keeps working for up to its
 *    TTL. True single-session would need a server check on every request,
 *    which is exactly the network coupling this architecture avoids.
 *
 * So: many devices, one account, all active at once. The security control is
 * visibility and revocation the OWNER chooses — this file — plus the
 * new-device email the server sends, which is the actual protection against a
 * stolen credential.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getDb } from '@/db/client';
import * as outbox from '@/db/outbox';
import { getDeviceId, getSyncValue, setSyncValue } from '@/db/syncState';
import { getSupabase } from '@/services/supabase';

export type UserDevice = {
  deviceId: string;
  displayName: string;
  platform: string;
  appVersion: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  isThisDevice: boolean;
};

/** Set when a revoked device could not drain its queue before being cut off. */
const STRANDED_KEY = 'revocation_stranded_rows';

/**
 * device_id → display name, cached locally.
 *
 * ── WHY THIS IS CACHED AND NOT FETCHED WHERE IT IS USED ───────────────
 *
 * The gallery renders "On Sam's iPhone" on every tile whose bytes are
 * elsewhere. That name lives in a server table, and the gallery is a screen
 * the owner opens on a train with no signal — the same conditions the whole
 * offline-first design exists for. Fetching it at render time would leave the
 * tiles saying "another device" precisely when the owner is trying to work out
 * which phone to go and get.
 *
 * So the map is refreshed on every sync and read from local storage. A name
 * that is a few days stale is fine; a name that is missing is not.
 */
const DEVICE_NAMES_KEY = 'device_names';

function thisDeviceName(): string {
  const named = Constants.deviceName?.trim();
  if (named) return named;
  return Platform.OS === 'ios' ? 'iPhone' : 'Android device';
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/**
 * Announce this device and keep its "last synced" honest.
 *
 * Called at the start of every sync. The INSERT is what fires the server's
 * new-device alert trigger, and it only fires when the account already had a
 * device — mailing someone about their own sign-up is noise that teaches them
 * to ignore the message that matters.
 */
export async function touchThisDevice(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const deviceId = await getDeviceId();
  const { error } = await supabase.from('user_devices').upsert(
    {
      device_id: deviceId,
      display_name: thisDeviceName(),
      platform: Platform.OS,
      app_version: appVersion(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'device_id' },
  );

  if (error) console.warn('[sync] could not update device registry', error.message);

  await cacheDeviceNames();
}

/** Refresh the local device_id → name map. Best-effort; never throws. */
export async function cacheDeviceNames(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from('user_devices')
    .select('device_id, display_name');

  if (error || !data) return;

  const map: Record<string, string> = {};
  for (const row of data) {
    map[row.device_id as string] = row.display_name as string;
  }
  await setSyncValue(DEVICE_NAMES_KEY, JSON.stringify(map));
}

/**
 * Names for a set of device ids, for rendering.
 *
 * Returns an empty map rather than throwing when nothing has been cached yet.
 * Callers fall back to "another device", which is honest — we genuinely do not
 * know yet — rather than printing a UUID at the owner.
 */
export async function deviceNames(): Promise<Record<string, string>> {
  const raw = await getSyncValue(DEVICE_NAMES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Every device on this account, most recently seen first. */
export async function listDevices(): Promise<UserDevice[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const thisId = await getDeviceId();
  const { data, error } = await supabase
    .from('user_devices')
    .select('*')
    .order('last_seen_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    deviceId: row.device_id as string,
    displayName: row.display_name as string,
    platform: row.platform as string,
    appVersion: row.app_version as string,
    createdAt: row.created_at as string,
    lastSeenAt: row.last_seen_at as string,
    revokedAt: (row.revoked_at as string | null) ?? null,
    isThisDevice: row.device_id === thisId,
  }));
}

/**
 * Sign out every OTHER device.
 *
 * ── BE HONEST ABOUT WHAT THIS DOES ────────────────────────────────────
 *
 * `scope: 'others'` revokes the other devices' refresh tokens immediately, so
 * they cannot get a new access token. Their CURRENT access token keeps working
 * until it expires — up to an hour by default. There is no way around that
 * without a server check on every request.
 *
 * The UI copy says so. A security control that quietly overstates itself is
 * worse than one that explains its limits, because the owner makes decisions
 * based on believing it.
 *
 * `revoked_at` is stamped alongside so the devices list reflects the change
 * straight away instead of looking unchanged for an hour.
 */
export async function signOutOtherDevices(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const thisId = await getDeviceId();

  await supabase
    .from('user_devices')
    .update({ revoked_at: new Date().toISOString() })
    .neq('device_id', thisId);

  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw new Error(error.message);
}

/** Revoke one named device. Same one-hour caveat as above. */
export async function revokeDevice(deviceId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const thisId = await getDeviceId();
  if (deviceId === thisId) {
    throw new Error('Use Sign out to sign out of this device.');
  }

  const { error } = await supabase
    .from('user_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('device_id', deviceId);

  if (error) throw new Error(error.message);

  // There is no per-device token revocation in Supabase, so this marks the
  // device and the device itself honours it on next contact — see
  // enforceRevocation(). For an immediate cut, the owner uses "sign out my
  // other devices", which revokes refresh tokens server-side.
}

/**
 * Has this device been revoked, and if so, get out cleanly.
 *
 * ── DRAIN BEFORE WIPE ─────────────────────────────────────────────────
 *
 * A revoked device that comes back online pushes its outbox FIRST, then clears
 * the session. The other order makes revocation into the data-loss path from
 * reason 2 at the top of this file, just deferred — the owner revokes an old
 * phone and unknowingly destroys the three seizures it never managed to send.
 *
 * If the push fails, the local rows are KEPT and the fact is recorded so the
 * sign-in screen can say so plainly. A queued seizure is never silently
 * discarded.
 */
export async function enforceRevocation(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const deviceId = await getDeviceId();
  const { data, error } = await supabase
    .from('user_devices')
    .select('revoked_at')
    .eq('device_id', deviceId)
    .maybeSingle();

  // No row yet (first sync) or a failed lookup is not a revocation. Failing
  // open is right here: a network blip must not sign anyone out.
  if (error || !data?.revoked_at) return false;

  const db = await getDb();
  let stranded = 0;

  try {
    const { pushAll } = await import('./push');
    await pushAll();
  } catch (pushError) {
    console.warn('[sync] revoked device could not drain its outbox', pushError);
  }

  stranded = await outbox.pendingCount(db);
  await setSyncValue(STRANDED_KEY, String(stranded));

  // Local rows are deliberately left in place. Sign-out is not a statement
  // about the data — see src/db/scope.ts — and the owner can sign back in to
  // recover anything that did not make it.
  await supabase.auth.signOut({ scope: 'local' });
  return true;
}

/**
 * How many records were left unsent when this device was signed out remotely.
 *
 * Drives: "This device was signed out, but 3 records hadn't synced yet. Sign in
 * again to save them."
 */
export async function strandedRowCount(): Promise<number> {
  const raw = await getSyncValue(STRANDED_KEY);
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function clearStrandedRowCount(): Promise<void> {
  await setSyncValue(STRANDED_KEY, '0');
}
