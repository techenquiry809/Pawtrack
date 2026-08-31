import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { colors } from '@/theme/tokens';
import { resumeSync, suspendSync } from '@/services/sync/worker';

/**
 * The seizure flow is a linear stack: live -> post -> recovery.
 * Back gestures are disabled throughout so an accidental swipe cannot
 * interrupt an emergency recording.
 *
 * ── SYNC IS HELD FOR THE WHOLE FLOW ───────────────────────────────────
 *
 * Mounting this stack suspends the sync worker, and leaving it releases the
 * hold. Not because syncing would corrupt anything — the outbox is
 * transactional and the rows are durable from the first tap — but because this
 * screen does exactly one thing, and it must not compete for the JS thread or
 * the SQLite write lock with a background upload while someone is watching a
 * timer and their dog is convulsing.
 *
 * The records are already safe locally. Getting them to the server can wait
 * the few minutes until the recovery screen, which is where syncAfterSeizure()
 * pushes them immediately.
 *
 * Released here rather than in each screen so an owner who backs out of the
 * flow at any point cannot leave sync suspended for the rest of the session.
 * A force-quit mid-seizure is fine too: the flag lives in memory, so the next
 * launch starts clear.
 */
export default function SeizureLayout() {
  useEffect(() => {
    suspendSync();
    return () => resumeSync();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
