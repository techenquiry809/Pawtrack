/**
 * The five-tab main navigation, matching the original app exactly:
 * Home, Timeline, History, Patterns, More.
 *
 * If no dog exists yet we redirect to onboarding — the whole app is
 * dog-scoped, so there is nothing meaningful to show without one.
 */

import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useAppStore } from '@/store/appStore';
import { UnfinishedSeizurePrompt } from '@/components/UnfinishedSeizurePrompt';
import { colors, fontSize } from '@/theme/tokens';

/**
 * Simple emoji icons keep the dependency count down. Swap for a proper icon
 * set (@expo/vector-icons ships with Expo) if you want sharper visuals — the
 * tab config is the only thing that would change.
 */
function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{symbol}</Text>
  );
}

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
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.tealDeep,
          tabBarInactiveTintColor: colors.inkSoft,
          tabBarStyle: {
            backgroundColor: colors.bg,
            borderTopColor: colors.line,
          },
          tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: '600' },
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ focused }) => <TabIcon symbol="🏠" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="timeline"
          options={{
            title: 'Timeline',
            tabBarIcon: ({ focused }) => <TabIcon symbol="🕑" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: 'History',
            tabBarIcon: ({ focused }) => <TabIcon symbol="📋" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="analytics"
          options={{
            title: 'Patterns',
            tabBarIcon: ({ focused }) => <TabIcon symbol="📈" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ focused }) => <TabIcon symbol="⋯" focused={focused} />,
          }}
        />
      </Tabs>
    </>
  );
}
