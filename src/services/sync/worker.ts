/**
 * The sync worker — when syncing happens, and when it must not.
 *
 * ── THE RULE THAT OVERRIDES THE OTHERS ────────────────────────────────
 *
 * NEVER during the live seizure flow.
 *
 * That screen does one thing. It runs a timer someone is watching while their
 * dog convulses, and it must not compete for the JS thread, the database
 * write lock, or the owner's attention with a background upload. The rows are
 * already durable in local SQLite from the first tap — that is the guarantee
 * that matters, and getting them to the server can wait the four minutes until
 * the recovery screen.
 *
 * Everything else here is scheduling.
 */

import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import { getDb } from '@/db/client';
import * as outbox from '@/db/outbox';
import { getSupabase } from '@/services/supabase';
import { deleteVideoFile } from '@/services/videoService';
import { collectOrphanedFiles, forgetVideoFiles } from '@/db/tombstone';
import { pushAll } from './push';
import { pullAll } from './pull';
import { touchThisDevice, enforceRevocation } from './devices';
import { pushSettings, pullSettings } from './settings';

export type SyncReason =
  | 'sign-in'
  | 'foreground'
  | 'reconnect'
  | 'seizure-finalized'
  | 'manual';

export type SyncSummary = {
  pushed: number;
  pulled: number;
  remaining: number;
  fullResync: boolean;
  at: number;
};

let inFlight: Promise<SyncSummary | null> | null = null;
let suspended = false;
let lastSyncAt = 0;
let consecutiveFailures = 0;

/** Milliseconds since the last completed sync. */
export function msSinceLastSync(): number {
  return lastSyncAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastSyncAt;
}

export function lastSyncedAt(): number | null {
  return lastSyncAt === 0 ? null : lastSyncAt;
}

/**
 * Hold all syncing. Called when the live seizure flow opens.
 *
 * Idempotent and paired with resumeSync(); the seizure stack calls it on mount
 * and releases it on unmount, so an owner who force-quits mid-seizure simply
 * starts a new process with the flag clear.
 */
export function suspendSync(): void {
  suspended = true;
}

export function resumeSync(): void {
  suspended = false;
}

/**
 * Push, then pull, then reconcile local files.
 *
 * Push first is not arbitrary. Once this device's edits are on the server, the
 * conflict rules have been applied to them, so what comes back on the pull is
 * the resolved answer rather than something that might overwrite an edit that
 * never left the phone.
 *
 * Returns null when the sync did not run — no config, no session, suspended,
 * or one already in flight. Callers treat that as "nothing to report", never
 * as an error.
 */
export async function syncNow(reason: SyncReason): Promise<SyncSummary | null> {
  if (suspended) {
    console.log(`[sync] skipped (${reason}): live seizure flow is open`);
    return null;
  }

  const supabase = getSupabase();
  if (!supabase) return null;

  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;

  // Coalesce. A foreground event and a reconnect landing together should
  // produce one sync, and the second caller should wait for the first rather
  // than racing it into the same tables.
  if (inFlight) return inFlight;

  inFlight = run(reason).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(reason: SyncReason): Promise<SyncSummary | null> {
  try {
    // A device the owner revoked from another phone drains its outbox and
    // THEN clears its session — never the other way round. See devices.ts.
    const revoked = await enforceRevocation();
    if (revoked) return null;

    await touchThisDevice();

    await pushSettings();
    const push = await pushAll();

    const pull = await pullAll();
    await pullSettings();

    // A video tombstoned elsewhere means this device should stop holding the
    // bytes. Files are deleted AFTER the rows are consistent, and a failure
    // here leaves an orphaned file rather than a half-deleted record — the
    // cheaper of the two failures, and the same rule videoRepo follows.
    if (pull.removedVideoIds.length > 0) {
      const files = await collectOrphanedFiles(pull.removedVideoIds);
      for (const file of files) {
        if (file.fileUri) deleteVideoFile(file.fileUri);
        if (file.thumbUri) deleteVideoFile(file.thumbUri);
      }
      await forgetVideoFiles(pull.removedVideoIds);
    }

    const db = await getDb();
    lastSyncAt = Date.now();
    consecutiveFailures = 0;

    const summary: SyncSummary = {
      pushed: push.pushed,
      pulled: pull.applied,
      remaining: await outbox.pendingCount(db),
      fullResync: pull.fullResync,
      at: lastSyncAt,
    };
    console.log(
      `[sync] ${reason}: +${summary.pushed} pushed, ${summary.pulled} pulled, ` +
        `${summary.remaining} queued`,
    );
    return summary;
  } catch (error) {
    consecutiveFailures += 1;
    // Deliberately swallowed. A failed sync is not an error the owner needs to
    // see — the app is fully usable without it, and the outbox count on the
    // More screen is where a persistent problem surfaces.
    console.warn(`[sync] ${reason} failed`, error);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

/** Foreground syncs are rate-limited; a user tabbing in and out is not news. */
const FOREGROUND_MIN_INTERVAL_MS = 60_000;

/**
 * Wire up the automatic triggers. Returns a teardown function.
 *
 * Called once from the root layout, after the session has been restored.
 */
export function startSyncTriggers(): () => void {
  let lastState: AppStateStatus = AppState.currentState;
  let wasConnected = true;

  const appStateSub = AppState.addEventListener('change', (next) => {
    const cameForward = lastState !== 'active' && next === 'active';
    lastState = next;
    if (!cameForward) return;
    if (msSinceLastSync() < FOREGROUND_MIN_INTERVAL_MS) return;
    void syncNow('foreground');
  });

  // expo-network has no event emitter on every platform, so this polls. The
  // interval is long because the foreground trigger already covers the common
  // case — this exists for a phone left open while signal comes back.
  const interval = setInterval(() => {
    void (async () => {
      if (suspended) return;
      try {
        const state = await Network.getNetworkStateAsync();
        const connected = Boolean(state.isConnected && state.isInternetReachable);
        if (connected && !wasConnected) void syncNow('reconnect');
        wasConnected = connected;
      } catch {
        // Network state is advisory. Failing to read it must never break sync.
      }
    })();
  }, 30_000);

  return () => {
    appStateSub.remove();
    clearInterval(interval);
  };
}

/**
 * The one write worth pushing immediately.
 *
 * A finalized seizure is the record this whole app exists to keep. It goes out
 * as soon as the recovery screen closes rather than waiting for the next
 * foreground — by which time the phone may be flat, lost, or in a vet's
 * waiting room with no signal.
 */
export async function syncAfterSeizure(): Promise<void> {
  resumeSync();
  void syncNow('seizure-finalized');
}
