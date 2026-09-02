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
 *   COMMIT   the chosen face reacts. Fires when the value actually CHANGES,
 *            not on every tap — re-tapping the face that is already selected
 *            does nothing, and animating it would claim something happened
 *            when nothing did.
 *
 * ── THE COMMIT IS DIFFERENT FOR EVERY STEP ────────────────────────────
 *
 * One shared pop for all five said "recorded" and nothing else. The scale is
 * about how the animal MOVED, so each step now moves the way the thing it
 * describes moves, and the motion carries the meaning a second time:
 *
 *   settle     flat out   sinks and stays down, slowly. No ring — nothing
 *                         about this day is worth celebrating.
 *   sway       low        one tired wobble, side to side.
 *   pulse      steady     a calm ring outward. The original, and still right
 *                         for the step that means "an ordinary day".
 *   hop        good       two quick hops, like a dog at the door.
 *   celebrate  bouncy     a big bounce and a burst of paws thrown outward.
 *
 * That last one is the point of the whole row. A good day after a run of bad
 * ones is the thing an owner most wants the app to notice, and it is the one
 * moment in an app about seizures where celebrating is the correct tone.
 *
 * Haptics stay on the parent: this component is about what the eye gets, and
 * the two are already separate concerns.
 *
 * ── REDUCE MOTION ─────────────────────────────────────────────────────
 *
 * With it on, every animation above is skipped and the face jumps straight to
 * its selected state. The colour fill, the filled icon and the bold label all
 * still change, so the feedback survives — it just stops moving. The signal
 * was never carried by motion alone, which is the point. The paw burst is not
 * rendered at all: it is pure decoration and carries nothing.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';

/** How a step reacts when it becomes the answer. */
export type MoodReaction = 'settle' | 'sway' | 'pulse' | 'hop' | 'celebrate';

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
  /** What this step does on commit. See the note above. */
  reaction: MoodReaction;
  onPress: () => void;
  accessibilityHint?: string;
};

/** Paws thrown outward by `celebrate`, as unit vectors on a circle. */
const BURST = [-90, -140, -40, 175, 5, 130, 50, -175].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
});

/**
 * How far a burst paw travels, in points.
 *
 * 24, and the ceiling is not arbitrary. The ring below documents a 1.9x scale
 * that pushed a 40pt dot to 76pt and was visibly CLIPPED on the two outer
 * faces, because the card sets `overflow: 'hidden'`. A paw at radius 24 plus
 * its own 10pt body stays inside the 1.6x envelope that was verified safe, so
 * the celebration never looks like a rendering fault.
 */
const BURST_RADIUS = 24;

export function MoodFace({
  icon,
  name,
  tint,
  ink,
  solid,
  value,
  active,
  reaction,
  onPress,
  accessibilityHint,
}: MoodFaceProps) {
  const reduced = useReducedMotion();

  const press = useRef(new Animated.Value(1)).current;
  const bump = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  /** Vertical offset in points — drives both `hop` and `settle`. */
  const lift = useRef(new Animated.Value(0)).current;
  /** -1..1, drives the `sway` wobble. */
  const tilt = useRef(new Animated.Value(0)).current;
  /** 0..1 progress of the celebrate burst. */
  const burst = useRef(new Animated.Value(0)).current;

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
    lift.setValue(0);
    tilt.setValue(0);
    burst.setValue(0);

    /** The pop shared by every reaction that has one, at a chosen strength. */
    const pop = (peak: number, settleTension: number) =>
      Animated.sequence([
        Animated.timing(bump, {
          toValue: peak,
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
          tension: settleTension,
          useNativeDriver: true,
        }),
      ]);

    const ringOut = (duration: number) =>
      Animated.timing(ring, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    let commit: Animated.CompositeAnimation;

    switch (reaction) {
      // Flat out. Sinks under its own weight and comes back reluctantly —
      // deliberately the slowest of the five, and the only one with no ring.
      case 'settle':
        commit = Animated.sequence([
          Animated.timing(lift, {
            toValue: 4,
            duration: 260,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(lift, {
            toValue: 0,
            duration: 420,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        break;

      // One tired wobble. Not a shake: a shake means "wrong".
      case 'sway':
        commit = Animated.parallel([
          pop(0.7, 200),
          Animated.sequence([
            Animated.timing(tilt, {
              toValue: -1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true,
            }),
            Animated.timing(tilt, {
              toValue: 0.7, duration: 180, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
            }),
            Animated.spring(tilt, {
              toValue: 0, friction: 5, tension: 120, useNativeDriver: true,
            }),
          ]),
        ]);
        break;

      // Two quick hops, like a dog that has heard the lead come off the hook.
      case 'hop': {
        const hop = (height: number, up: number, down: number) =>
          Animated.sequence([
            Animated.timing(lift, {
              toValue: -height, duration: up, easing: Easing.out(Easing.quad), useNativeDriver: true,
            }),
            Animated.timing(lift, {
              toValue: 0, duration: down, easing: Easing.in(Easing.quad), useNativeDriver: true,
            }),
          ]);
        commit = Animated.parallel([
          pop(1, 170),
          ringOut(420),
          Animated.sequence([hop(9, 150, 130), hop(5, 120, 110)]),
        ]);
        break;
      }

      // Zoomies. The biggest pop, a fast ring, a real jump, and paws thrown
      // outward — the one moment in this app where celebrating is correct.
      case 'celebrate':
        commit = Animated.parallel([
          pop(1.35, 150),
          ringOut(560),
          Animated.sequence([
            Animated.timing(lift, {
              toValue: -14, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true,
            }),
            Animated.spring(lift, {
              toValue: 0, friction: 4.5, tension: 150, useNativeDriver: true,
            }),
          ]),
          Animated.timing(burst, {
            toValue: 1,
            duration: 720,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]);
        break;

      // An ordinary day, acknowledged calmly. The original behaviour.
      case 'pulse':
      default:
        commit = Animated.parallel([pop(1, 160), ringOut(460)]);
        break;
    }

    commit.start();
    return () => commit.stop();
  }, [active, reduced, reaction, bump, ring, lift, tilt, burst]);

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

  const rotate = tilt.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-12deg', '12deg'],
  });

  const burstPaws = useMemo(
    () =>
      BURST.map((vector, i) => ({
        vector,
        // Alternating sizes so the burst reads as scattered rather than as a
        // machined ring of identical dots.
        size: i % 2 === 0 ? 9 : 6,
      })),
    [],
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
      <Animated.View
        style={{ transform: [{ translateY: lift }, { scale }, { rotate }] }}
      >
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

        {/*
          The celebration burst. Rendered only for the step that has one and
          only when motion is allowed — it says nothing the fill and the label
          do not already say, so there is nothing to preserve for someone who
          asked for less movement.
        */}
        {reaction === 'celebrate' && !reduced
          ? burstPaws.map(({ vector, size }, i) => (
              <Animated.View
                key={i}
                pointerEvents="none"
                style={[
                  styles.spark,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: solid,
                    marginLeft: -size / 2,
                    marginTop: -size / 2,
                    opacity: burst.interpolate({
                      inputRange: [0, 0.15, 0.7, 1],
                      outputRange: [0, 1, 0.9, 0],
                    }),
                    transform: [
                      {
                        translateX: burst.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, vector.x * BURST_RADIUS],
                        }),
                      },
                      {
                        translateY: burst.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, vector.y * BURST_RADIUS],
                        }),
                      },
                      {
                        scale: burst.interpolate({
                          inputRange: [0, 0.25, 1],
                          outputRange: [0.3, 1, 0.5],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ))
          : null}

        <View
          style={[
            styles.dot,
            { backgroundColor: active ? solid : tint },
            active && { borderColor: solid },
          ]}
        >
          <Icon
            name={icon}
            size="md"
            color={active ? colors.onMedia : ink}
            filled={active}
          />
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
  // Anchored at the dot's centre; each paw carries its own negative margin so
  // it grows from that point rather than from its own top-left corner.
  spark: {
    position: 'absolute',
    top: DOT / 2,
    left: DOT / 2,
  },
  name: {
    marginTop: 4,
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.inkSoft,
    fontFamily: fontFamily.bold
  },
});
