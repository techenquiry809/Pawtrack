/**
 * The four-tab main navigation: Home, Check-in, Records, More.
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

import { Redirect, Tabs } from 'expo-router';
import { useAppStore } from '@/store/appStore';
import { UnfinishedSeizurePrompt } from '@/components/UnfinishedSeizurePrompt';
import { RecordSeizureFab } from '@/components/RecordSeizureFab';
import { FloatingTabBar } from '@/components/FloatingTabBar';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  const dogs = useAppStore((s) => s.dogs);

  if (dogs.length === 0) {
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
            title: 'More',
          }}
        />
      </Tabs>

      {/* Floats above the tab bar on every tab except Home, so the timer is
          always one tap away. Rendered last so it stacks over the tabs. */}
      <RecordSeizureFab />
    </>
  );
}
