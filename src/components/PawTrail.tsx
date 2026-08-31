/**
 * A trail of dog paw prints that walks itself across the screen.
 *
 * ── WHY IT IS BUILT FROM VIEWS AND NOT AN SVG OR A LOTTIE ─────────────
 *
 * The app has no SVG library and no animation-file runtime, and a decorative
 * header is a poor reason to add either — react-native-svg is a native module
 * (so it needs a rebuild, and it is one more thing to keep in step with the
 * Expo SDK), and Lottie means shipping and maintaining a JSON animation asset.
 *
 * A paw is a pad and four toes. Five rounded Views each, and it composes with
 * the existing design tokens for free.
 *
 * ── WHY React Native's `Animated` AND NOT REANIMATED ──────────────────
 *
 * react-native-reanimated IS a dependency, but nothing in the app uses it yet,
 * and Reanimated 4 needs the worklets Babel plugin wired up correctly — a
 * thing that fails at runtime rather than at build time, and that cannot be
 * verified without launching the app on a device.
 *
 * Everything here is opacity and transform, which `Animated` drives on the UI
 * thread with `useNativeDriver` just as well. LiquidGlassButton already made
 * this call for the same reason; being consistent beats being novel on a
 * decorative element.
 *
 * (For the record: Framer Motion cannot be used here at all. It is a web
 * library built on the DOM and CSS, neither of which exists in React Native.)
 *
 * ── REDUCE MOTION ─────────────────────────────────────────────────────
 *
 * With Reduce Motion on, the trail renders complete and still. It is not
 * hidden: the paws are the visual anchor of the sign-in screen, and removing
 * them for the people who asked for less movement would take away the design
 * rather than the animation.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';

/** Where each paw sits, and which way it points. Hand-placed, not generated —
 *  a real animal's gait is not a straight line, and an even spacing reads as
 *  a border pattern rather than as something that walked past. */
const PAWS = [
  { x: 0.04, y: 0.62, rotate: '-14deg', scale: 0.78 },
  { x: 0.19, y: 0.34, rotate: '-6deg', scale: 0.86 },
  { x: 0.35, y: 0.60, rotate: '4deg', scale: 0.92 },
  { x: 0.51, y: 0.28, rotate: '10deg', scale: 0.98 },
  { x: 0.67, y: 0.54, rotate: '16deg', scale: 1.04 },
  { x: 0.83, y: 0.20, rotate: '22deg', scale: 1.1 },
] as const;

/** One paw print: a pad, and four toes on an arc above it. */
function Paw({ tint }: { tint: string }) {
  return (
    <View style={styles.paw}>
      <View style={styles.toes}>
        {/* The outer toes sit lower and splay outward, which is what makes
            this read as a paw rather than as four dots in a row. */}
        <View style={[styles.toe, styles.toeOuterL, { backgroundColor: tint }]} />
        <View style={[styles.toe, styles.toeInner, { backgroundColor: tint }]} />
        <View style={[styles.toe, styles.toeInner, { backgroundColor: tint }]} />
        <View style={[styles.toe, styles.toeOuterR, { backgroundColor: tint }]} />
      </View>
      <View style={[styles.pad, { backgroundColor: tint }]} />
    </View>
  );
}

/**
 * How solid a paw gets at the end of its entrance.
 *
 * The paws are drawn in `colors.teal` and then held well under full opacity,
 * rather than being drawn in a pale tint at full strength.
 *
 * That is not a style preference — it is the fix for a real bug. The first
 * version tinted them `colors.tealTint`, which is the exact colour the sign-in
 * gradient starts with, so six paw prints rendered perfectly and were
 * completely invisible. Deriving the wash from opacity means the trail cannot
 * silently match whatever background it is placed on.
 */
const PAW_OPACITY = 0.22;

export function PawTrail({
  height = 120,
  tint = colors.teal,
}: {
  height?: number;
  /** Kept low-contrast on purpose — this sits BEHIND the headline. */
  tint?: string;
}) {
  const reduced = useReducedMotion();

  // One driver per paw so they can be staggered. Refs, not state: these are
  // written every frame and must never trigger a React render.
  const progress = useRef(PAWS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (reduced) {
      // Snap to the finished state. Still visible, just not moving.
      progress.forEach((v) => v.setValue(1));
      return;
    }

    // Each paw lands, the set holds long enough to be read as a trail, then
    // the whole thing clears and walks past again.
    const walk = Animated.stagger(
      160,
      progress.map((v) =>
        Animated.timing(v, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
      ),
    );

    const clear = Animated.stagger(
      60,
      progress.map((v) =>
        Animated.timing(v, {
          toValue: 0,
          duration: 260,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    );

    const loop = Animated.loop(
      Animated.sequence([walk, Animated.delay(2200), clear, Animated.delay(600)]),
    );
    loop.start();

    // Stopping on unmount matters: an Animated.loop left running holds a
    // reference to the component and keeps the driver ticking on a screen
    // nobody is looking at.
    return () => loop.stop();
  }, [reduced, progress]);

  const paws = useMemo(
    () =>
      PAWS.map((paw, i) => {
        const p = progress[i]!;
        return (
          <Animated.View
            key={i}
            // Decorative. The screen's meaning is entirely in its text, and a
            // screen reader announcing six paw prints before the headline
            // would be noise.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.slot,
              {
                left: `${paw.x * 100}%`,
                top: `${paw.y * 100}%`,
                opacity: p.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, PAW_OPACITY],
                }),
                transform: [
                  { rotate: paw.rotate },
                  { scale: Animated.multiply(p, paw.scale) },
                  // A short hop as it lands, so it reads as a step being
                  // taken rather than a shape being faded in.
                  {
                    translateY: p.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Paw tint={tint} />
          </Animated.View>
        );
      }),
    [progress, tint],
  );

  return (
    <View style={[styles.wrap, { height }]} pointerEvents="none">
      {paws}
    </View>
  );
}

const TOE = 7;

const styles = StyleSheet.create({
  wrap: { width: '100%', position: 'relative', overflow: 'hidden' },
  slot: { position: 'absolute' },

  paw: { width: 30, alignItems: 'center' },

  toes: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1.5,
    marginBottom: 1.5,
  },
  toe: {
    width: TOE,
    height: TOE + 2,
    borderRadius: TOE,
  },
  // Outer toes are smaller and dropped, inner ones sit proud — the arc is
  // what the eye reads as "paw".
  toeOuterL: { transform: [{ translateY: 3 }, { rotate: '-18deg' }] },
  toeOuterR: { transform: [{ translateY: 3 }, { rotate: '18deg' }] },
  toeInner: { transform: [{ translateY: -1 }] },

  pad: {
    width: 17,
    height: 14,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
});
