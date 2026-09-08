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
 * to be unmistakable.
 *
 * Three distinct signals:
 *
 *   TAP        every press gets the same spring pop, on every face. It
 *              confirms the touch landed on a target and not the gap
 *              between two — it says nothing about WHICH face this is.
 *              It is the loudest of the three, because it is the one that
 *              answers the question the owner actually has.
 *   SELECTED   the chosen face sits noticeably larger and its label turns
 *              bold in that step's own colour. Nothing dims: see
 *              SELECTED_SCALE for why the old opacity dip was removed.
 *   IDLE       the chosen face, and only the chosen face, keeps moving for
 *              as long as it stays chosen, at an intensity that itself
 *              carries meaning — see the note further down.
 *
 * ── ILLUSTRATED, NOT DRAWN ─────────────────────────────────────────────
 *
 * This used to build each face from primitive Views — ears, eyes, a mouth,
 * a tail, all positioned and rotated per state — coloured from the step's own
 * tint/ink/solid tokens. It is now five fixed-colour illustrations
 * (src/assets/moods/{flat,low,steady,good,bouncy}.png), one per step.
 *
 * That trade has a real cost, worth stating plainly: a hand-drawn shape could
 * be RECOLOURED to match each step's tint, so the resting row (before
 * anything is selected) showed five different colours as well as five
 * different silhouettes. A fixed-colour PNG cannot be retinted without a
 * colour overlay, which the brief this shipped with explicitly ruled out —
 * "do not add any colour overlay, tint, or filter to the PNGs". So colour
 * as a distinguishing channel between the FIVE STEPS is gone; what carries
 * that now is purely the illustration itself (five different expressions)
 * and the label underneath, same as it always was for a screen-reader user.
 *
 * What colour still does is mark SELECTION — the label under the chosen face
 * turns bold and switches to that step's own `solid`. A ring around the face
 * itself was tried first and cut: against these illustrations, which already
 * carry their own outline and drop shadow, an added ring read as clutter
 * rather than a signal. Size carries "chosen" on its own; the colour on the
 * label is what's layered on top.
 *
 * `tint` and `ink` are still accepted on this component's props, because the
 * caller (app/(tabs)/index.tsx) still passes them and touching that file was
 * out of scope for this change — they are simply no longer read here.
 *
 * ── WHY THE IDLE MOTION IS DIFFERENT FOR EVERY STEP ────────────────────
 *
 * A single shared idle animation on the selected face would say "recorded"
 * and nothing else. The scale is about how the animal MOVED, so the amount of
 * motion is itself part of what the step communicates: Flat holds dead still,
 * Bouncy cannot hold still. The five idle behaviours are defined once in
 * `IDLE`, keyed by value, and are entirely unchanged by the artwork swap —
 * they animate the whole illustration as one rigid image now instead of
 * animating a translateY/scale/rotate shared across several drawn parts, but
 * the shared values, the curves and the timings are the same ones that were
 * already driving the old drawn head.
 *
 * ── WHY REANIMATED HERE AND NOT RN's Animated ─────────────────────────
 *
 * PawTrail.tsx made the opposite call for a decorative, one-shot entrance and
 * documented why: Reanimated needs its Babel transform wired up correctly,
 * which used to be a manual step that failed at runtime rather than at build
 * time. `babel-preset-expo` now auto-detects `react-native-reanimated` and
 * `react-native-worklets` (already a direct dependency) and wires the plugin
 * in without a babel.config.js entry — confirmed by grepping
 * node_modules/babel-preset-expo, then by actually launching this component
 * on a device. A continuous, per-frame idle loop is also a better fit for
 * Reanimated's UI-thread model than for RN's `Animated`, which is the other
 * reason to make the jump here rather than on the decorative paw trail.
 *
 * ── REDUCE MOTION ─────────────────────────────────────────────────────
 *
 * With it on: the tap spring is skipped, the selection change (scale) happens
 * as an instant cut instead of a tween, the five idle loops never start, and
 * the entrance renders in its final position with no stagger. Nothing above is
 * hidden, only stilled — the illustration's size and the bold label still
 * change, which is what the signal was always carried by underneath the
 * motion.
 *
 * ── WHY THE LOOP CHECKS AppState ───────────────────────────────────────
 *
 * A Reanimated loop keeps ticking on the UI thread even while the JS thread
 * and the screen are both idle. This app may need to survive an emergency on
 * whatever battery a phone has left, so an ambient decoration that cannot be
 * seen must not be allowed to keep spending frames. The loop is cancelled the
 * moment the app backgrounds and restarted on foreground, in addition to the
 * ordinary cancel-on-unmount.
 */

import { useEffect } from 'react';
import { AppState, Pressable, StyleSheet, Text, type ImageSourcePropType } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';

const STEADY_IMAGE: ImageSourcePropType = require('@/assets/moods/steady.png');

const MOOD_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('@/assets/moods/flat.png'),
  2: require('@/assets/moods/low.png'),
  3: STEADY_IMAGE,
  4: require('@/assets/moods/good.png'),
  5: require('@/assets/moods/bouncy.png'),
};

/**
 * The illustration for a step, falling back to Steady for an out-of-range
 * value rather than rendering nothing.
 *
 * Exported because MoodStatusBar shows the face that was CHOSEN, and it has to
 * be the same artwork — a second `require` map in that file would be two lists
 * to keep in step, and they would diverge the first time a face is redrawn.
 */
export function moodImage(value: number): ImageSourcePropType {
  // The fallback is its own binding rather than `MOOD_IMAGES[3]` inline:
  // under noUncheckedIndexedAccess a second index lookup is just as
  // possibly-undefined as the first, so it does not narrow anything.
  return MOOD_IMAGES[value] ?? STEADY_IMAGE;
}

export type MoodFaceProps = {
  /** 1 (Flat) through 5 (Bouncy). Selects the illustration, the idle
   *  animation, and the entrance stagger — see MOOD_IMAGES and IDLE. */
  value: number;
  name: string;
  /**
   * Unused by this component — see the header note on why a fixed-colour
   * illustration cannot be retinted, and why these are still accepted rather
   * than removed from the type.
   */
  tint: string;
  ink: string;
  /** The bold label's colour when chosen. */
  solid: string;
  active: boolean;
  onPress: () => void;
  accessibilityHint?: string;
};

/**
 * The idle loop, keyed by value. Only one axis moves per step — combining
 * axes would blur which one is carrying the intensity. Unchanged by the
 * artwork swap: this animates the whole illustration now, exactly as it
 * animated the whole drawn head before.
 *
 * `period` is the full up-and-back cycle in ms, matching the brief's "~2.5s",
 * "~2s", "~1.2s" as the TOTAL cycle, not the one-way leg.
 */
const IDLE: Record<
  number,
  null | { axis: 'lift' | 'scale' | 'rotate'; to: number; period: number }
> = {
  1: null, // Flat: stillness is the point.
  2: { axis: 'lift', to: 1.5, period: 3600 }, // barely-there settle
  3: { axis: 'lift', to: -2, period: 2500 }, // gentle float
  4: { axis: 'scale', to: 1.05, period: 2000 }, // small pulse
  5: { axis: 'rotate', to: 3, period: 1200 }, // wobble, driven ±3°
};

/** Entrance stagger, once per mount — see the header note. */
const STAGGER_MS = 40;
const ENTER_MS = 220;

/**
 * The tap pop: a fast punch up, then a softer settle so it lands with some
 * weight instead of snapping back dead.
 *
 * Lower damping on the way up than the old pair had, and a bigger target (see
 * TAP_SCALE), because this is now the row's LOUDEST feedback rather than one
 * signal among three. Faces no longer dim when they are not chosen, so the
 * moment of "that one, and it registered" has to be carried by the movement.
 */
const TAP_UP = { stiffness: 600, damping: 15, mass: 0.4 } as const;
const TAP_DOWN = { stiffness: 240, damping: 18, mass: 0.9 } as const;

/** How far the pop overshoots. Every face gets it, chosen or not. */
const TAP_SCALE = 1.32;

/** The tween into/out of the selected look — quick, since it is confirming a
 *  tap the owner just made, not an ambient decoration. */
const SELECT_MS = 180;

const IDLE_EASE = Easing.inOut(Easing.sin);

/**
 * How much bigger the selected face sits.
 *
 * ── NOTHING IS DIMMED ANY MORE ────────────────────────────────────────
 *
 * Unselected faces used to sit at 0.55 opacity, so four of the five were
 * washed out at rest and the row read as greyed-out — as if it were disabled,
 * or as if the four unchosen answers were somehow less available than the
 * chosen one. On a control whose whole job is to offer five equally valid
 * answers, that is the wrong thing to say, and it said it hardest before
 * anything was selected at all: five faded faces, none of them chosen.
 *
 * So every face is drawn at full strength and "chosen" is carried entirely by
 * SIZE and by the label — which turns bold and takes the step's own colour.
 * The scale is larger than it was to make up for the channel that went away:
 * against five fully-drawn illustrations, 1.08 was not enough to find at a
 * glance.
 */
const SELECTED_SCALE = 1.18;

export function MoodFace({
  value,
  name,
  active,
  solid,
  onPress,
  accessibilityHint,
}: MoodFaceProps) {
  const reduced = useReducedMotion();

  const tapScale = useSharedValue(1);
  const idleLift = useSharedValue(0);
  const idleScale = useSharedValue(1);
  const idleRotate = useSharedValue(0);
  const entry = useSharedValue(reduced ? 1 : 0);
  // Seeded from the CURRENT `active` value rather than always 0, so a face
  // that mounts already selected (the row re-rendering, not a fresh pick)
  // does not play a spurious "becoming selected" tween on first paint.
  const selected = useSharedValue(active ? 1 : 0);

  /* ---- Entry: once, on mount ------------------------------------------ */
  useEffect(() => {
    if (reduced) {
      entry.value = 1;
      return;
    }
    entry.value = withDelay(
      (value - 1) * STAGGER_MS,
      withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }),
    );
    // Mount only. Re-running this on every `value`/`reduced` change would
    // replay the entrance on a re-render that has nothing to do with mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Selected look: opacity/scale, tweened or instant ---------------- */
  useEffect(() => {
    const target = active ? 1 : 0;
    selected.value = reduced ? target : withTiming(target, { duration: SELECT_MS });
  }, [active, reduced, selected]);

  /* ---- Idle loop: selected face only, paused off-screen ---------------- */
  useEffect(() => {
    const rest = () => {
      idleLift.value = 0;
      idleScale.value = 1;
      idleRotate.value = 0;
    };

    if (reduced) {
      // Instant — nothing here is an animation the reader asked to keep.
      cancelAnimation(idleLift);
      cancelAnimation(idleScale);
      cancelAnimation(idleRotate);
      rest();
      return;
    }

    const spec = IDLE[value];
    if (!active || !spec) {
      cancelAnimation(idleLift);
      cancelAnimation(idleScale);
      cancelAnimation(idleRotate);
      idleLift.value = withTiming(0, { duration: 200 });
      idleScale.value = withTiming(1, { duration: 200 });
      idleRotate.value = withTiming(0, { duration: 200 });
      return;
    }

    const target = spec.axis === 'lift' ? idleLift : spec.axis === 'scale' ? idleScale : idleRotate;
    const leg = spec.period / 2;

    const start = () => {
      // The rotate wobble is symmetric about 0 (±3°), so it starts at the
      // negative end rather than at rest — everything else starts from its
      // own rest value, which is already where withRepeat's reverse expects
      // to find it.
      if (spec.axis === 'rotate') idleRotate.value = -spec.to;
      target.value = withRepeat(
        withTiming(spec.to, { duration: leg, easing: IDLE_EASE }),
        -1,
        true,
      );
    };
    const stop = () => {
      cancelAnimation(idleLift);
      cancelAnimation(idleScale);
      cancelAnimation(idleRotate);
    };

    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [active, reduced, value, idleLift, idleScale, idleRotate]);

  const onPressHandler = () => {
    if (!reduced) {
      tapScale.value = withSequence(withSpring(TAP_SCALE, TAP_UP), withSpring(1, TAP_DOWN));
    }
    onPress();
  };

  const faceStyle = useAnimatedStyle(() => ({
    // `entry` only — selection no longer touches opacity. See SELECTED_SCALE.
    opacity: entry.value,
    transform: [
      { translateY: idleLift.value + (1 - entry.value) * 6 },
      {
        scale:
          tapScale.value *
          idleScale.value *
          (1 + (SELECTED_SCALE - 1) * selected.value),
      },
      { rotate: `${idleRotate.value}deg` },
    ],
  }));

  return (
    <Pressable
      onPress={onPressHandler}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${name}, ${value} of 5`}
      accessibilityHint={accessibilityHint}
      style={styles.cell}
    >
      <Animated.View style={[styles.faceBox, faceStyle]}>
        <Animated.Image
          source={moodImage(value)}
          style={styles.image}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>

      <Text
        style={[styles.name, active && { color: solid, fontWeight: '800' }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </Pressable>
  );
}

const IMAGE_SIZE = 44;
const FACE_BOX = 56;

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    alignItems: 'center',
    // The visible face is IMAGE_SIZE; this keeps the TAP target at the
    // platform minimum so the gaps between five faces are not dead zones.
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.xs,
  },
  faceBox: {
    width: FACE_BOX,
    height: FACE_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Not cropped to a circle: the illustrations' ears and paws extend past a
  // circular bound on some steps (Flat lies flat with ears spread wide), and
  // clipping them would cut real artwork rather than framing it.
  image: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
  },
  name: {
    marginTop: 2,
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.inkSoft,
    fontFamily: fontFamily.bold,
  },
});
