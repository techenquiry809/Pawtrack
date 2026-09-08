/**
 * The signed-out stack.
 *
 * Sits outside (tabs) for the same reason the seizure flow does: there is no
 * tab bar here and no way to wander into Analytics from a login screen.
 *
 * This is where every launch begins now. An account is required before any
 * record can be written, so a signed-out session is routed here by the gate in
 * app/_layout.tsx and has nowhere else to go.
 *
 * ── FIVE SCREENS, ONE PER INSTRUCTION ─────────────────────────────────
 *
 *   sign-in          the only place a session is born
 *   sign-up          create the account
 *   forgot-password  where should the reset code go
 *   verify           the 6-digit code, for signup and reset alike
 *   new-password     choose the replacement
 *
 * They used to be two screens with the last three folded into cards that
 * appeared underneath the forms, which meant a password field and a code field
 * could be on screen together with two submit buttons between them. Each step
 * asks one thing now, and all of them end back at sign-in.
 *
 * NOTE: the route gate in app/_layout.tsx has to know about every path here —
 * a signed-out session on a path it does not recognise gets sent back to
 * sign-in, which would make /verify unreachable.
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
      {/* Swipe-back IS allowed here — these are pushes from sign-in, and the
          gesture returning you to it is exactly what a user expects. */}
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="verify" />
      {/*
        No swipe-back on the last step of a reset. This screen holds a live
        recovery session and cleans it up through its own back action (see
        app/(auth)/new-password.tsx); an edge swipe would look like it left,
        while the session it is responsible for stayed behind.
      */}
      <Stack.Screen name="new-password" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
