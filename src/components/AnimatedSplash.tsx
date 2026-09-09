/**
 * The launch screen: the app's mark, breathing, on the app's own background.
 *
 * ── WHAT THIS REPLACED, AND WHY ───────────────────────────────────────
 *
 * A full-bleed 3-second brand video. Measured on a release build on a real
 * device, startup finished at 139ms and Home was painted and settled by 507ms,
 * so the clip held the window for about three seconds after the app was ready.
 * Cutting it short did not help either: a video stopped a fifth of the way in
 * reads as a playback failure, not as a fast launch.
 *
 * A loading state has to look deliberate at ANY duration, because it cannot
 * know in advance how long it has. A loop does; a linear clip does not. So the
 * mark breathes on a slow cycle and leaves whenever startup says so — at
 * 700ms on a warm device, at three seconds on a cold one — and looks the same
 * either way.
 *
 * The clip is still in assets/. If it is wanted, first-run onboarding is where
 * a brand film belongs — somewhere it can play to the end, once, rather than
 * in front of an app someone opened because their dog is having a seizure.
 *
 * ── WHY THE MARK IS DRAWN AND NOT ONE OF THE BRAND PNGs ───────────────
 *
 * Every raster this project ships — icon.png, splash-icon.png,
 * android-icon-foreground.png — draws the paw in WHITE, for a blue or
 * transparent ground. On `colors.bg` (#F6F2EA) the paw disappears entirely and
 * only the blue pulse trace survives, which reads as a stray squiggle. So the
 * paw comes from the app's own icon set (Ionicons, the same family `Icon`
 * wraps and the same glyph the profile row uses) in `colors.teal`, which is a
 * token, on a token background. No new asset, no invented colour.
 *
 * ── THE MOTIF IS THE ONE THE BRAND ALREADY USES ───────────────────────
 *
 * The logo is a paw with a pulse trace through the pad. A slow scale-and-fade
 * is that same idea in time rather than in line: a heartbeat, at rest. It is
 * kept deliberately gentle — this screen belongs to an app people open at 3am
 * after a bad night, and an energetic spinner would be the wrong tone even if
 * it were more interesting to look at.
 *
 * ── IT ENDS WHEN THE APP IS READY ─────────────────────────────────────
 *
 *   MIN_VISIBLE_MS  a floor, so a fast cold start does not flash the mark for
 *                   three frames — which reads as a glitch, not as speed
 *   canFinish       startup settled, or failed; both are reasons to get out of
 *                   the way
 *   MAX_VISIBLE_MS  a ceiling, for a startup that never reports at all
 *
 * ── REDUCED MOTION ────────────────────────────────────────────────────
 *
 * The mark is rendered at rest and does not pulse, and the fade is skipped.
 * The screen still appears and still hands over — it simply stops moving. See
 * src/theme/motion.ts on why that setting is honoured rather than negotiated.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';

/** A floor, so a 140ms startup does not strobe the mark. */
const MIN_VISIBLE_MS = 700;

/** A ceiling, for a startup that never reports. Never reached in practice. */
const MAX_VISIBLE_MS = 6000;

/** The handoff out. Matches `duration.enter` in the motion tokens. */
const FADE_MS = 320;

/** The handoff in. Shorter: arriving should not itself feel like waiting. */
const FADE_IN_MS = 180;

/** One breath. Slow enough to read as calm rather than as a spinner. */
const PULSE_MS = 1400;

/**
 * Display size for the mark.
 *
 * Deliberately NOT from `ICON_SIZE`: that scale tops out at a size meant for a
 * row or a tab bar, and this is the only place in the app where the glyph is
 * the subject rather than a label for something else.
 */
const MARK_SIZE = 76;

export function AnimatedSplash({
  canFinish,
  onFinish,
}: {
  /**
   * True once startup has settled — or failed. Both are reasons to leave: an
   * error screen behind a loading mark is worse than no loading mark at all.
   */
  canFinish: boolean;
  onFinish: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const finishedRef = useRef(false);
  const mountedAt = useRef(Date.now());

  /**
   * Whole-screen opacity: fades IN over the plain cover the root layout holds
   * while it works out what launched the app, and OUT into the app itself.
   *
   * Starting at 0 rather than 1 is what stops the mark popping into existence
   * against a cover that is already the same colour — the cover, this screen
   * and the native launch window are all `colors.bg`, so the only thing that
   * should ever appear or disappear is the mark.
   */
  const fade = useRef(new Animated.Value(0)).current;
  /** 0 → 1 → 0, the breath. Drives scale and the mark's own opacity together. */
  const pulse = useRef(new Animated.Value(0)).current;

  // Fade in. Instant under reduced motion, where the screen must still appear.
  useEffect(() => {
    if (reducedMotion) {
      fade.setValue(1);
      return;
    }
    Animated.timing(fade, {
      toValue: 1,
      duration: FADE_IN_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade, reducedMotion]);

  // Native-driven, so a busy JS thread during startup — which is exactly what
  // this screen is covering — cannot make the breath stutter.
  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  /**
   * Held in a ref so the floor timer and the ceiling timer can both start the
   * leave sequence without either re-subscribing the other.
   */
  const leave = useRef<() => void>(() => {});
  leave.current = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    if (reducedMotion) {
      onFinish();
      return;
    }
    Animated.timing(fade, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onFinish());
  };

  // The normal path: startup finished, so go — once the floor has passed. The
  // remaining wait is measured from mount, so a startup that took 900ms leaves
  // immediately rather than serving another 700ms on top of it.
  useEffect(() => {
    if (!canFinish) return;
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - mountedAt.current));
    const timer = setTimeout(() => leave.current(), remaining);
    return () => clearTimeout(timer);
  }, [canFinish]);

  // The ceiling.
  useEffect(() => {
    const timer = setTimeout(() => leave.current(), MAX_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  const markStyle = reducedMotion
    ? { opacity: 1 }
    : {
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
        transform: [
          { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }) },
        ],
      };

  return (
    <Animated.View
      style={[styles.screen, { opacity: fade }]}
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading PawTrack"
    >
      <Animated.View style={markStyle}>
        <Ionicons name="paw" size={MARK_SIZE} color={colors.teal} />
      </Animated.View>
      <Text style={styles.wordmark}>PawTrack</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // The same colour as `backgroundColor` in app.config.ts, so the native
    // launch window and this screen are one continuous surface with no seam.
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  wordmark: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.ink,
    // Slightly open, the way a mark is set rather than a sentence.
    letterSpacing: 0.5,
  },
});
