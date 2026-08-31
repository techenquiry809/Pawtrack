/**
 * Optional Face ID / fingerprint lock on app launch.
 *
 * ── WHY THIS EXISTS INSTEAD OF A SESSION TIMEOUT ──────────────────────
 *
 * The threat people usually reach for a short session lifetime to address is
 * "someone picks up an unlocked phone". A session policy is the wrong tool for
 * it on this app, for one reason that outweighs everything else: an app that
 * demands re-authentication at 3am has failed at the moment it exists for.
 * Expiring a session means a network round trip, a login screen, and possibly
 * no signal, standing between an owner and a seizure timer.
 *
 * A device lock solves the same problem better. It protects the records
 * against someone holding the phone, needs no network, cannot fail in a
 * basement, and — crucially — cannot log anyone out. Worst case the biometric
 * fails and the owner falls through to their passcode, which takes a second.
 *
 * OPT-IN, and off by default. Most owners keep this app one tap from the home
 * screen precisely so it is fast in an emergency, and quietly adding a gate in
 * front of that would be a bad trade made on their behalf.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import { getSyncValue, setSyncValue } from '@/db/syncState';

const ENABLED_KEY = 'app_lock_enabled';

export async function isAppLockEnabled(): Promise<boolean> {
  return (await getSyncValue(ENABLED_KEY)) === '1';
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  await setSyncValue(ENABLED_KEY, enabled ? '1' : '0');
}

/** Whether the hardware can do this at all, and is actually enrolled. */
export async function isAppLockAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  // Enrolment matters separately: a device with a Face ID sensor and no face
  // registered would offer a toggle that locks the owner out of their own
  // records with no way back in.
  return LocalAuthentication.isEnrolledAsync();
}

/**
 * Prompt to unlock.
 *
 * `disableDeviceFallback` is deliberately FALSE. If the biometric fails —
 * wet hands, a dark room, a face half covered — the owner must still be able
 * to reach the app with their passcode. A biometric-only gate on an emergency
 * app is a lockout waiting for the worst possible moment.
 */
export async function promptUnlock(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Paws Journal',
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return result.success;
  } catch (error) {
    // Never fail closed. A broken biometric subsystem must not be able to lock
    // an owner out of their dog's medical history.
    console.warn('[applock] authentication threw; unlocking', error);
    return true;
  }
}
