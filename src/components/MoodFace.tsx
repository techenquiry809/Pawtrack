/**
 * One face in the "How is <dog>'s day?" row.
 *
 * ── WHY THIS NEEDED MORE THAN AN OPACITY DIP ──────────────────────────
 *
 * Tapping a face writes to the database immediately. There is no Save button
 * and no confirmation dialog, which is the right design for something that
 * should cost one tap — but it leaves the owner with a real question: did that
 * register, or did I miss?
 *
 * The old feedback was `pressed && { opacity: 0.6 }`. That reads as "the app
 * noticed my finger", which is a different statement from "your answer was
 * recorded". On a control that silently persists, the second one is what has
 * to be unmistakable — otherwise people tap twice to be sure, and the honest
 * ones go and check the check-in form.
 *
 * So there are two distinct signals, deliberately:
 *
 *   PRESS    scale dips under the finger, instantly, on touch-down. Confirms
 *            the touch landed on a target and not the gap between two.
 *   COMMIT   the chosen face pops and throws a ring outward. Fires when the
 *            value actually CHANGES, not on every tap — re-tapping the face
 *            that is already selected does nothing, and animating it would
 *            claim something happened when nothing did.
 *
 * Haptics stay where they were, on the parent: this component is about what
 * the eye gets, and the two are already separate concerns.
 *
 * ── REDUCE MOTION ─────────────────────────────────────────────────────
 *
 * With it on, both animations are skipped and the face jumps straight to its
 * selected state. The colour fill, the filled icon and the bold label all
 * still change, so the feedback survives — it just stops moving. The signal
 * was never carried by motion alone, which is the point.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';

export type MoodFaceProps = {
  icon: IconName;
  name: string;
  /** Resting fill. */
  tint: string;
  /** Icon and label colour when chosen. */
  ink: string;
  /** Fill and ring colour when chosen. */
  solid: string;
  value: number;
  active: boolean;
  onPress: () => void;
  accessibilityHint?: string;
};

export function MoodFace({
  icon,
  name,
  tint,
  ink,
  solid,
  value,
  active,
  onPress,
  accessibilityHint,
}: MoodFaceProps) {
  const reduced = useReducedMotion();

  const press = useRef(new Animated.Value(1)).current;
  const bump = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  // Tracks whether this face was already the selected one, so the commit
  // animation fires on the TRANSITION into selected rather than on every
  // render that happens to have `active` true — a re-render from an unrelated
  // state change must not look like a fresh answer.
  const wasActive = useRef(active);

  useEffect(() => {
    const justSelected = active && !wasActive.current;
    wasActive.current = active;
    if (!justSelected || reduced) return;

    bump.setValue(0);
    ring.setValue(0);

    const commit = Animated.parallel([
      Animated.sequence([
        Animated.timing(bump, {
          toValue: 1,
          duration: 130,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        // A spring back rather than a timing, so it settles with a little
        // weight instead of stopping dead — that is what reads as a physical
        // confirmation rather than a flicker.
        Animated.spring(bump, {
          toValue: 0,
          friction: 4,
          tension: 160,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(ring, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    commit.start();
    return () => commit.stop();
  }, [active, reduced, bump, ring]);

  const to = (value_: number) => {
    if (reduced) return;
    Animated.spring(press, {
      toValue: value_,
      friction: 7,
      tension: 300,
      useNativeDriver: true,
    }).start();
  };

  // Press dip and commit pop multiply, so a tap that lands while the pop is
  // still settling composes instead of fighting it.
  const scale = Animated.multiply(
    press,
    bump.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }),
  );

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => to(0.88)}
      onPressOut={() => to(1)}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${name}, ${value} of 5`}
      accessibilityHint={accessibilityHint}
      style={styles.cell}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {/*
          The ring is a sibling BEHIND the dot rather than a border on it, so it
          can grow past the dot's bounds. A border animating outward would be
          clipped by the circle it belongs to.
        */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              borderColor: solid,
              opacity: ring.interpolate({
                inputRange: [0, 0.3, 1],
                outputRange: [0, 0.5, 0],
              }),
              transform: [
                {
                  // 1.6, not something larger. The dot is 40pt and a cell is
                  // roughly 68pt wide, so 1.9x produced a 76pt ring that
                  // overflowed the card and was visibly CLIPPED on the two
                  // outer faces — the pulse looked like a rendering fault
                  // exactly where it was meant to reassure. Verified by
                  // pinning the ring visible and screenshotting the row.
                  scale: ring.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.85, 1.6],
                  }),
                },
              ],
            },
          ]}
        />

        <View
          style={[
            styles.dot,
            { backgroundColor: active ? solid : tint },
            active && { borderColor: solid },
          ]}
        >
          <Icon name={icon} size="md" color={active ? colors.onMedia : ink} />
        </View>
      </Animated.View>

      <Text
        style={[styles.name, active && { color: ink, fontWeight: '800' }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </Pressable>
  );
}

const DOT = 40;

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    alignItems: 'center',
    // The visible circle is 40pt; this keeps the TAP target at the platform
    // minimum so the gaps between five faces are not dead zones.
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
  },
  name: {
    marginTop: 4,
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.inkSoft,
    fontFamily: fontFamily.bold
  },
});
