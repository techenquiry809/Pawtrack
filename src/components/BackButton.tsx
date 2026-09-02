/**
 * The way out of a deep page.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Every full-screen route in this app runs with `headerShown: false`, so none
 * of them gets a system back button. What each screen offered instead had
 * drifted into four different answers:
 *
 *   breed-picker, dog-profile, emergency-plan, medication-edit
 *       NOTHING. The only exit was saving. An owner who opened the emergency
 *       plan to read a phone number had to save a form to leave it.
 *   add-video          a text "Cancel"
 *   report             a "Done" button at the BOTTOM of a long scroll
 *   account, devices, video, sign-up
 *                      a text "Back", in three different positions
 *
 * One icon, top-left, on every deep page. Top-left because that is where both
 * platforms put it and where a thumb reaching for "out" already goes, and an
 * icon rather than a word because it has to be recognisable at a glance by
 * someone who is not reading carefully.
 *
 * ── WHY IT DOES NOT CALL router.back() DIRECTLY ───────────────────────
 *
 * `back()` is a no-op when there is nothing to pop, which happens whenever a
 * route is the first screen of the session — a deep link, a notification tap,
 * `pawtrack://emergency-plan` typed anywhere. The button would then do
 * nothing at all, on a screen with no other exit.
 *
 * goBackOrHome() falls through to the tabs instead. See src/utils/nav.ts,
 * which documents the dead end this prevents.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { colors, radius, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import { goBackOrHome } from '@/utils/nav';

export function BackButton({
  /** Overrides the default goBackOrHome — use for a screen with unsaved work. */
  onPress,
  /** What the button returns to, for screen readers. Keep it short. */
  label = 'Back',
  /** Solid chip on a plain background; plain glyph over a photo or a card. */
  variant = 'chip',
}: {
  onPress?: () => void;
  label?: string;
  variant?: 'chip' | 'plain';
}) {
  const router = useRouter();

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress ?? (() => goBackOrHome(router))}
        accessibilityRole="button"
        accessibilityLabel={label}
        // The visible chip is 40pt; hitSlop takes the TOUCHABLE area to the
        // platform minimum without making the control look heavy.
        hitSlop={10}
        style={({ pressed }) => [
          styles.button,
          variant === 'chip' && styles.chip,
          pressed && styles.pressed,
        ]}
      >
        <Icon name="back" size="md" color={colors.tealDeep} />
      </Pressable>
    </View>
  );
}

const SIZE = 40;

const styles = StyleSheet.create({
  // A row so the button sits hard left regardless of the parent's alignment —
  // several screens centre their content, and a bare Pressable would follow.
  row: { alignSelf: 'stretch', alignItems: 'flex-start', minHeight: MIN_TOUCH_TARGET },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    // Nudged left so the GLYPH lines up with the text below it. Centring the
    // circle instead leaves the chevron visibly inset from the headline.
    marginLeft: -spacing.xs,
  },
  chip: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.94 }] },
});
