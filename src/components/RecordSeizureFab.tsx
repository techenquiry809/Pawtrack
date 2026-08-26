/**
 * The floating Record button.
 *
 * ── WHY IT FLOATS ─────────────────────────────────────────────────────
 *
 * Starting the timer is the one action in this app that is time-critical, and
 * until now it lived only on Home. An owner reading the calendar or the report
 * when a seizure starts had to navigate first — seconds spent on navigation
 * during the exact event the app exists to time.
 *
 * Floating it in the tab shell makes it reachable from every tab. It is
 * deliberately NOT rendered on Home, where the large red button already sits
 * above the fold; two Record buttons on one screen is not redundancy, it is
 * hesitation.
 *
 * It also never appears inside the seizure flow itself, because that flow
 * lives outside the tab navigator — so there is no way to start a second
 * recording on top of one already running.
 *
 * ── ONE TAP, NO CONFIRMATION ──────────────────────────────────────────
 *
 * Same rule as the Home button: a confirmation step costs seconds during an
 * emergency and buys nothing. An accidental tap is recoverable — the live
 * screen offers Discard, and a discarded record is soft-deleted, not lost.
 */

import { usePathname, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { LiquidGlassButton } from '@/components/LiquidGlassButton';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { useChromeMetrics } from '@/theme/chrome';

export function RecordSeizureFab() {
  const router = useRouter();
  const pathname = usePathname();
  const { fabBottom } = useChromeMetrics();

  const dog = useActiveDog();
  const settings = useAppStore((s) => s.settings);
  const startSeizure = useActiveSeizure((s) => s.start);
  const draft = useActiveSeizure((s) => s.draft);

  // Home already has the primary Record button; a recording in progress owns
  // its own full-screen flow.
  if (!dog || draft || pathname === '/' || pathname === '/index') return null;

  const onPress = () => {
    if (settings.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    startSeizure(dog.id);
    router.push('/seizure/live');
  };

  return (
    <View
      // Sits above the floating island. Both positions come from the same
      // device-derived metrics, so they cannot drift apart.
      style={[styles.dock, { bottom: fabBottom }]}
      // The dock spans the screen for centring, but must not swallow taps on
      // the content behind it — only the button itself is interactive.
      pointerEvents="box-none"
    >
      <LiquidGlassButton
        label="Record seizure"
        icon="add"
        onPress={onPress}
        accessibilityHint="Starts the seizure timer immediately"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
