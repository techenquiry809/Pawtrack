import { Stack } from 'expo-router';
import { colors } from '@/theme/tokens';

/**
 * The seizure flow is a linear stack: live -> post -> recovery.
 * Back gestures are disabled throughout so an accidental swipe cannot
 * interrupt an emergency recording.
 */
export default function SeizureLayout() {
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
