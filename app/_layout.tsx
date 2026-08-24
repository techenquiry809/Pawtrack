/**
 * Root layout.
 *
 * Runs once at launch and is responsible for everything that must be ready
 * before any screen renders: opening the database, running migrations, and
 * loading settings + the active dog.
 *
 * Navigation shape:
 *   (tabs)              -> the five-tab main app
 *   seizure/live        -> full-screen takeover, no tab bar (emergency flow)
 *   seizure/post
 *   seizure/recovery
 *   onboarding          -> shown only when no dog exists yet
 *
 * The seizure screens sit OUTSIDE the tab group on purpose: during a seizure
 * the owner must not be able to wander off into Analytics by mistyping a tap.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDb } from '@/db/client';
import { useAppStore } from '@/store/appStore';
import { Body, Muted } from '@/components/ui';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  const hydrate = useAppStore((s) => s.hydrate);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Opening the DB also runs any pending migrations.
        await getDb();
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
    };
  }, [hydrate]);

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
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
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
    gap: 10,
  },
  errorDetail: { textAlign: 'center' },
});
