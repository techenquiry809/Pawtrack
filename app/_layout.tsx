/**
 * Root layout.
 *
 * Runs once at launch and is responsible for everything that must be ready
 * before any screen renders: opening the database, running migrations, loading
 * settings + the active dog, and restoring the session.
 *
 * Navigation shape:
 *   (auth)              -> sign-in and the claim decision, no tab bar
 *   (tabs)              -> the five-tab main app
 *   seizure/live        -> full-screen takeover, no tab bar (emergency flow)
 *   seizure/post
 *   seizure/recovery
 *   onboarding          -> shown only when no dog exists yet
 *   devices             -> the device registry
 *   account             -> sign out, remove data, delete account, app lock
 *
 * The seizure screens sit OUTSIDE the tab group on purpose: during a seizure
 * the owner must not be able to wander off into Analytics by mistyping a tap.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { getDb } from '@/db/client';
import { useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';
import { Body, Button, Muted } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';
import { rescheduleIfTimezoneChanged } from '@/services/medicationReminders';
import { startAuthAutoRefresh } from '@/services/supabase';
import { startSyncTriggers, syncNow } from '@/services/sync/worker';
import { isAppLockEnabled, promptUnlock } from '@/services/appLock';
import { isAuthPromptDismissed } from '@/services/authPrompt';

export default function RootLayout() {
  /*
   * Nunito is loaded WITHOUT gating the first paint.
   *
   * The tradeoff is deliberate: the app opens straight into the system face
   * and swaps to Nunito once the faces land, so a cold start shows a brief
   * flash of SF Pro rather than a longer splash. Nothing is blocked on this —
   * `useFonts` is read for its side effect and the tree renders either way.
   *
   * Faces are cached after the first launch, so the swap is only ever visible
   * on a genuinely cold first run.
   */
  useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  const hydrate = useAppStore((s) => s.hydrate);
  const dogs = useAppStore((s) => s.dogs);
  const appHydrated = useAppStore((s) => s.hydrated);

  const authStatus = useAuthStore((s) => s.status);
  const pendingClaim = useAuthStore((s) => s.pendingClaim);
  const initializeAuth = useAuthStore((s) => s.initialize);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(true);

  const pathname = usePathname();
  const routedFor = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    let teardownAuth: (() => void) | undefined;

    (async () => {
      try {
        // Opening the DB also runs any pending migrations.
        await getDb();

        // The app lock is read before anything renders. Checking it later
        // would let the records paint for a frame behind the prompt.
        if (await isAppLockEnabled()) {
          if (!cancelled) setLocked(true);
        }

        setPromptDismissed(await isAuthPromptDismissed());

        // Auth first: every repository read is fenced by the active user id,
        // so hydrating the dog list before the session is restored would
        // populate the store with the wrong owner's rows — or none.
        teardownAuth = await initializeAuth();
        await hydrate();

        if (!cancelled) setReady(true);
      } catch (e) {
        console.error('[startup] failed', e);
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Could not open the local database.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      teardownAuth?.();
    };
  }, [hydrate, initializeAuth]);

  /**
   * Medication reminders are scheduled at a LOCAL wall-clock time. When the
   * owner travels, the device's offset moves and every scheduled notification
   * has to be rebuilt or the 8am dose reminder starts arriving at 3am.
   *
   * Checked on foreground rather than on a timer, because a timezone only
   * changes while the phone is in someone's pocket on a plane. It compares the
   * offset first and does nothing when it has not moved, so an ordinary
   * foreground costs one subtraction.
   *
   * Deliberately NOT in the startup gate above: this must never delay first
   * paint, and it is a no-op until notification permission has been granted.
   */
  useEffect(() => {
    if (!ready) return;
    void rescheduleIfTimezoneChanged();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void rescheduleIfTimezoneChanged();
    });
    return () => sub.remove();
  }, [ready]);

  /** Token refresh and the sync triggers, both paused while backgrounded. */
  useEffect(() => {
    if (!ready) return;
    const stopRefresh = startAuthAutoRefresh();
    const stopSync = startSyncTriggers();
    return () => {
      stopRefresh();
      stopSync();
    };
  }, [ready]);

  /** A full pull on sign-in, once the session is actually established. */
  useEffect(() => {
    if (!ready || authStatus !== 'signed-in' || pendingClaim) return;
    void syncNow('sign-in');
  }, [ready, authStatus, pendingClaim]);

  /**
   * The route gate.
   *
   * Runs only once everything it depends on has settled. Redirecting while
   * `authStatus` is still 'loading' is what flashes the onboarding screen at
   * returning users: the dog list has not been fenced to an owner yet, so it
   * momentarily looks empty and the gate concludes there is no dog.
   */
  useEffect(() => {
    if (!ready || !appHydrated || locked) return;
    if (authStatus === 'loading') return;

    const target =
      pendingClaim !== null
        ? '/(auth)/claim'
        : authStatus === 'signed-out' && !promptDismissed
          ? '/(auth)/sign-in'
          : dogs.length === 0
            ? '/onboarding'
            : null;

    if (!target) return;
    // Guard against re-issuing the same redirect on every store update, which
    // would fight the user's own navigation.
    if (routedFor.current === target) return;
    if (pathname.startsWith(target.replace('/(auth)', ''))) return;

    routedFor.current = target;
    router.replace(target);
  }, [
    ready, appHydrated, locked, authStatus, pendingClaim, promptDismissed,
    dogs.length, pathname,
  ]);

  const unlock = useCallback(async () => {
    if (await promptUnlock()) setLocked(false);
  }, []);

  // Prompt as soon as the lock screen mounts, so the common case is one glance
  // at the phone rather than a tap and then a glance.
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  if (error) {
    return (
      <SafeAreaProvider>
        <View style={styles.centre}>
          <Body>Paws Journal could not start.</Body>
          <Muted style={styles.errorDetail}>{error}</Muted>
          <Muted style={styles.errorDetail}>
            Your saved records have not been deleted. Reopening the app usually
            resolves this. If it keeps happening, reinstalling will lose local
            data, so export a backup from another device first if you can.
          </Muted>
        </View>
      </SafeAreaProvider>
    );
  }

  if (locked) {
    return (
      <SafeAreaProvider>
        <View style={styles.centre}>
          <Body>Paws Journal is locked</Body>
          <Muted style={styles.errorDetail}>
            Unlock with Face ID, Touch ID or your passcode.
          </Muted>
          <Button label="Unlock" onPress={() => void unlock()} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    // Deliberately plain. A spinner-heavy splash on a seizure app is the wrong
    // first impression, and this state is normally sub-second.
    return (
      <SafeAreaProvider>
        <View style={styles.centre} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ gestureEnabled: false }} />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="devices" />
        <Stack.Screen name="account" />
        <Stack.Screen
          name="checkin-flow"
          options={{
            // No swipe-back, for the same reason the seizure screen has none:
            // an edge swipe would leave the flow WITHOUT going through the
            // unsaved-changes prompt, silently discarding four steps of
            // answers. The close button is the only way out, and it asks.
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="seizure"
          options={{
            // No swipe-back: an accidental edge swipe must not dismiss a
            // running seizure timer.
            gestureEnabled: false,
            animation: 'fade',
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}


const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 24,
    gap: spacing.sm,
  },
  errorDetail: { textAlign: 'center' },
});
