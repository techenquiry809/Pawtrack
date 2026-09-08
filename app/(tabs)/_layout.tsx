/**
 * The four-tab main navigation: Home, Check-in, Records, Settings.
 * The route folder is still `more` — renaming a route file changes its deep
 * link, and the tab's TITLE is what the owner actually reads.
 *
 * Patterns merged INTO Records — they answered the same question from two
 * tabs, and the summary was separated from the records it came from.
 *
 * Timeline's slot went to Daily Check-in. Its merged day-by-day view was NOT
 * deleted — it is now History's "Everything" filter, sharing one merge
 * definition in src/features/timeline.
 *
 * If no dog exists yet we redirect to onboarding — the whole app is
 * dog-scoped, so there is nothing meaningful to show without one.
 */

import { StyleSheet, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { useAppStore } from '@/store/appStore';
import { UnfinishedSeizurePrompt } from '@/components/UnfinishedSeizurePrompt';
import { FloatingTabBar } from '@/components/FloatingTabBar';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  const dogs = useAppStore((s) => s.dogs);
  const hydrated = useAppStore((s) => s.hydrated);
  const initialSyncSettled = useAppStore((s) => s.initialSyncSettled);

  /*
   * ── AN EMPTY DOG LIST IS NOT YET AN ANSWER ────────────────────────────
   *
   * This used to redirect on `dogs.length === 0` alone, which is only true of
   * a phone that has finished finding out. Two states reach here with an
   * empty list and no dog missing:
   *
   *   - the store has been dropped and is being re-read (`hydrated` false),
   *     which is what a sign-out and back in does;
   *   - the account's dog is still on its way down from the server, which is
   *     every first launch on a second device.
   *
   * Redirecting on either asked the owner to create a dog they already have,
   * and — because this is the layout, not a screen — it did so by unmounting
   * the entire tab tree and mounting it again a moment later. Every screen in
   * it lost its state and reloaded from scratch, which is what the flash of a
   * half-loaded Home screen actually was.
   *
   * So the redirect now waits for the same evidence the root gate waits for,
   * and holds a plain background until then. See `initialSyncSettled` in
   * src/store/appStore.ts.
   */
  if (dogs.length === 0) {
    if (!hydrated || !initialSyncSettled) {
      return <View style={styles.holding} />;
    }
    return <Redirect href="/onboarding" />;
  }

  return (
    <>
      {/* Mounted once at the tab shell so it catches an orphaned recording on
          cold launch AND on every return to the foreground. */}
      <UnfinishedSeizurePrompt />

      <Tabs
        // A custom bar replaces the navigator's own entirely — the island is
        // absolutely positioned and inset from the edges, which the default
        // bar cannot be. Icons and labels are resolved inside it from the
        // route name, so the screens below only declare their titles.
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
          }}
        />
        <Tabs.Screen
          name="checkin"
          options={{
            title: 'Check-in',
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: 'Records',
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'Settings',
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  /** The page colour, and nothing else, while the dog list settles. */
  holding: { flex: 1, backgroundColor: colors.bg },
});
