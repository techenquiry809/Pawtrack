/**
 * The advice under the live seizure timer.
 *
 * One short instruction at a time, on a fixed schedule — see
 * src/features/seizure/guidance.ts, which owns the copy and the timings and is
 * where they should be edited.
 *
 * ── OUT, THEN IN. NOT A CROSS-FADE ────────────────────────────────────
 *
 * The outgoing message is gone before the incoming one starts. Overlapping
 * them puts both at partial opacity in the middle of the transition, which
 * reads as a rendering glitch rather than as one thing becoming another — the
 * same conclusion the Daily Pulse morph reached on the Home screen, and the
 * same easing curve is used here so the two feel like one app.
 *
 * ── THE SLOT DOES NOT RESIZE ──────────────────────────────────────────
 *
 * `minHeight` holds it at the tallest message's height. Without it the card
 * grows and shrinks as the copy changes length, which shoves the Record video
 * and Seizure ended buttons up and down the screen — controls someone is
 * reaching for without looking, during a seizure. A stationary target matters
 * more here than a snug box.
 *
 * ── WHY IT ANIMATES ON THE STEP, NOT ON THE CLOCK ─────────────────────
 *
 * `elapsed` changes every second. Keying the transition on it would replay the
 * animation once per tick, forever. It is keyed on the step INDEX, which
 * changes only when the advice actually does.
 *
 * ── REDUCED MOTION ────────────────────────────────────────────────────
 *
 * Renders the final state and swaps instantly. The advice still changes on
 * time — hiding it would withhold safety information from the people who
 * asked for less movement, which is the opposite of the intent (see
 * src/theme/motion.ts).
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { guidanceAt, guidanceIndexAt, type GuidanceStep } from '@/features/seizure/guidance';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';

/** Long enough to register as a departure, short enough not to be a wait. */
const OUT_MS = 130;
/** The arrival carries the lift, so it gets the longer half. */
const IN_MS = 260;

/** The reference curve, shared with the Home screen's pulse morph. */
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** How far the incoming message rises. Small: this is a nudge, not a slide. */
const LIFT = 10;

const TONE = {
  calm: {
    card: colors.card,
    border: colors.line,
    title: colors.ink,
    body: colors.inkSoft,
  },
  caution: {
    card: colors.amberTint,
    border: colors.amber,
    title: colors.amberInk,
    body: colors.amberInk,
  },
  urgent: {
    card: colors.redTint,
    border: colors.red,
    title: colors.redDeep,
    body: colors.redDeep,
  },
} as const;

export function SeizureGuidance({ elapsed }: { elapsed: number }) {
  const reducedMotion = useReducedMotion();

  const index = guidanceIndexAt(elapsed);
  const step = guidanceAt(elapsed);

  /**
   * The step currently PAINTED, which lags `step` by one fade-out.
   *
   * Two values rather than one so the outgoing message stays on screen while
   * it leaves. Swapping directly would replace the text and then animate the
   * new copy out and back in, which looks like a stutter.
   */
  const [shown, setShown] = useState<GuidanceStep>(step);
  const anim = useRef(new Animated.Value(1)).current;
  const shownIndex = useRef(index);
  /**
   * The newest step, readable from inside the fade-out callback.
   *
   * Read there rather than closed over, so a seizure that crosses two
   * boundaries during a 130ms fade lands on the CURRENT advice instead of the
   * one that was pending when the fade began.
   */
  const target = useRef(step);
  target.current = step;

  useEffect(() => {
    if (shownIndex.current === index) return;
    shownIndex.current = index;

    if (reducedMotion) {
      setShown(target.current);
      anim.setValue(1);
      return;
    }

    let cancelled = false;
    Animated.timing(anim, {
      toValue: 0,
      duration: OUT_MS,
      easing: EASE,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // A cancelled run means another step landed while this one was leaving.
      // That run owns the slot now; this one must not paint over it.
      if (cancelled || !finished) return;
      setShown(target.current);
      Animated.timing(anim, {
        toValue: 1,
        duration: IN_MS,
        easing: EASE,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      cancelled = true;
    };
  }, [index, reducedMotion, anim]);

  const tone = TONE[shown.tone];

  return (
    <View
      style={[styles.card, { backgroundColor: tone.card, borderColor: tone.border }]}
      accessible
      /*
       * The advice is announced when it changes. 'polite' rather than
       * 'assertive' on purpose: the threshold banners are the alerts, and a
       * screen reader that interrupts itself every few seconds is unusable at
       * the moment it is needed most.
       */
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${shown.title}. ${shown.body}`}
    >
      <Animated.View
        style={[
          styles.inner,
          {
            opacity: anim,
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [LIFT, 0],
                }),
              },
            ],
          },
        ]}
      >
        {/* Decorative: every step reads correctly without it, which matters
            because emoji coverage varies by device font. */}
        <Text style={styles.glyph} accessibilityElementsHidden importantForAccessibility="no">
          {shown.glyph}
        </Text>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: tone.title }]}>{shown.title}</Text>
          <Text style={[styles.body, { color: tone.body }]}>{shown.body}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    /*
     * Sized for the longest body in the table — "The seizure is lasting longer
     * than usual. Keep watching closely and be ready to call your vet." — which
     * wraps to THREE lines at the default text size, not two. Measured on
     * device at ~113dp; 116 leaves a little slack.
     *
     * The first value here was 92, which is the two-line height, and it did
     * not do the job: the card still grew and shrank between steps and took
     * the Record video and Seizure ended buttons up and down with it. See the
     * note at the top on why a stationary target matters more here than a
     * snug box.
     *
     * At larger system font scales it will still grow — correctly, since the
     * text must not be clipped — but it grows for every step at once, so the
     * slot stays consistent within a session.
     */
    minHeight: 116,
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  glyph: {
    fontSize: 26,
    // A fixed box, so a device that renders one emoji wider than another does
    // not shift the text column between steps.
    width: 32,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
  },
  copy: { flex: 1, gap: 2 },
  title: {
    fontSize: fontSize.md,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
  },
  body: {
    fontSize: fontSize.base,
    lineHeight: 19,
    fontFamily: fontFamily.regular,
  },
});
