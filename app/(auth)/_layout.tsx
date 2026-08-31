/**
 * The signed-out stack.
 *
 * Sits outside (tabs) for the same reason the seizure flow does: there is no
 * tab bar here and no way to wander into Analytics from a login screen.
 */

import { Stack } from 'expo-router';
import { colors } from '@/theme/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="sign-in" options={{ gestureEnabled: false }} />
      {/* Swipe-back IS allowed here — it is a push from sign-in, and the
          gesture returning you to it is exactly what a user expects. */}
      <Stack.Screen name="sign-up" />
      {/*
        No swipe-back out of the claim screen. Dismissing it would leave the
        owner signed in with their existing records still unclaimed and
        invisible, which reads as "the app deleted my dog's history".
      */}
      <Stack.Screen name="claim" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
