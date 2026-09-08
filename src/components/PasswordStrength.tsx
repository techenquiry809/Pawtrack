/**
 * A live strength meter for the sign-up password field.
 *
 * ── WHY THIS DOES NOT CHECK FOR A SYMBOL OR A DIGIT ────────────────────
 *
 * See the comment on `validate()` in app/(auth)/sign-up.tsx: this app only
 * requires length, deliberately, because composition rules mostly produce
 * `Password1!` written on a note by the keyboard rather than a password
 * anyone can actually remember. A meter that lit up a checklist for
 * "uppercase", "a number", "a symbol" would coach owners toward exactly the
 * pattern that comment argues against, right next to the field that argues
 * against it.
 *
 * What the meter grades instead is the thing that actually predicts
 * guessability: length, and whether the password is a known-common or
 * keyboard-sequential pattern (`password1`, `qwerty`, `abcd1234`, `aaaa…`).
 * Those are worth flagging regardless of how the codebase feels about
 * composition rules — a long password that is still "password123" is not
 * strong.
 *
 * ── WHY REACT NATIVE's `Animated`, NOT REANIMATED OR MOTION ────────────
 *
 * Same call PawTrail already made: react-native-reanimated is a dependency
 * but unused elsewhere in the app, and Reanimated's worklets plugin fails at
 * runtime rather than at build time. `Animated` drives every animation below
 * on the UI thread with `useNativeDriver`, which is all this needs. Framer
 * Motion (`motion/react`, the library the source design used) cannot run here
 * at all — it is built on the DOM and CSS, neither of which React Native has.
 */

import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';
import { MIN_PASSWORD_LENGTH } from '@/store/authStore';

const LABELS = ['Empty', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const MAX_SCORE = LABELS.length - 1;

const COMMON =
  /^(?:password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|abc123|111111|123123|123456)/i;
const RUN = /(.)\1{3,}/;
const RUN_UP =
  /(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|defg|qwer|wert|erty|asdf)/i;

/** Debounced, like the source component — an announcement on every keystroke
 *  would talk over the person still typing. */
const ANNOUNCE_DELAY_MS = 700;

const FILL_SPRING = { stiffness: 520, damping: 34, mass: 0.45, useNativeDriver: true };
const FADE_SPRING = { stiffness: 260, damping: 34, mass: 0.8, useNativeDriver: true };

function scorePassword(value: string): { score: number; guessable: boolean } {
  if (value.length === 0) return { score: 0, guessable: false };

  const guessable = COMMON.test(value) || RUN.test(value) || RUN_UP.test(value);
  if (guessable) return { score: 1, guessable: true };

  if (value.length < MIN_PASSWORD_LENGTH) return { score: 1, guessable: false };
  if (value.length < MIN_PASSWORD_LENGTH + 4) return { score: 2, guessable: false };
  if (value.length < MIN_PASSWORD_LENGTH + 10) return { score: 3, guessable: false };
  return { score: 4, guessable: false };
}

function toneFor(score: number): { bar: string; text: string } {
  if (score === 0) return { bar: colors.line, text: colors.inkSoft };
  const ratio = score / MAX_SCORE;
  if (ratio <= 0.34) return { bar: colors.red, text: colors.redDeep };
  if (ratio <= 0.67) return { bar: colors.amber, text: colors.amberInk };
  return { bar: colors.green, text: colors.greenInk };
}

export function PasswordStrength({ value }: { value: string }) {
  const { score, guessable } = useMemo(() => scorePassword(value), [value]);
  const reduced = useReducedMotion();
  const tone = toneFor(score);

  // One driver per segment and one per label, like PawTrail's per-paw
  // drivers: each is written on its own schedule and must never trigger a
  // React render on its own.
  const fills = useRef(LABELS.slice(1).map(() => new Animated.Value(0))).current;
  const labelFades = useRef(LABELS.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  const warnFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animations = fills.map((v, i) =>
      Animated.spring(v, { toValue: i < score ? 1 : 0, ...FILL_SPRING }),
    );
    if (reduced) {
      fills.forEach((v, i) => v.setValue(i < score ? 1 : 0));
    } else {
      Animated.parallel(animations).start();
    }
  }, [score, reduced, fills]);

  useEffect(() => {
    const animations = labelFades.map((v, i) =>
      Animated.spring(v, { toValue: i === score ? 1 : 0, ...FADE_SPRING }),
    );
    if (reduced) {
      labelFades.forEach((v, i) => v.setValue(i === score ? 1 : 0));
    } else {
      Animated.parallel(animations).start();
    }
  }, [score, reduced, labelFades]);

  useEffect(() => {
    const anim = Animated.spring(warnFade, { toValue: guessable ? 1 : 0, ...FADE_SPRING });
    if (reduced) warnFade.setValue(guessable ? 1 : 0);
    else anim.start();
  }, [guessable, reduced, warnFade]);

  // The screen-reader equivalent of `aria-live="polite"`, debounced the same
  // way the source hook was: announcing every keystroke would talk over
  // someone who is still typing.
  useEffect(() => {
    if (value.length === 0) return;
    const label = LABELS[score]!.toLowerCase();
    const message = guessable
      ? `Password strength ${label}. This is a commonly guessed pattern.`
      : `Password strength ${label}.`;
    const id = setTimeout(() => AccessibilityInfo.announceForAccessibility(message), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [score, guessable, value.length]);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel="Password strength"
        accessibilityValue={{ min: 0, max: MAX_SCORE, now: score, text: LABELS[score] }}
      >
        {fills.map((v, i) => (
          <View key={i} style={styles.cell}>
            <Animated.View
              style={[
                styles.cellFill,
                {
                  backgroundColor: tone.bar,
                  transform: [{ scaleX: v }],
                },
              ]}
            />
          </View>
        ))}
      </View>

      <View style={styles.row}>
        <View style={styles.labelStack}>
          {LABELS.map((text, i) => (
            <Animated.Text
              key={text}
              style={[styles.label, { color: tone.text, opacity: labelFades[i] }]}
            >
              {text}
            </Animated.Text>
          ))}
        </View>

        <Animated.Text style={[styles.warning, { opacity: warnFade }]}>
          Commonly guessed
        </Animated.Text>
      </View>
    </View>
  );
}

const CELL_GAP = spacing.xs + 2;

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  track: { flexDirection: 'row', gap: CELL_GAP },
  cell: {
    flex: 1,
    height: 6,
    borderRadius: 2,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  cellFill: { flex: 1, borderRadius: 2, transformOrigin: 'left' },

  row: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    height: 18,
  },
  // Every label absolutely stacked on the same cell, only one ever opaque —
  // the same crossfade trick PawTrail uses for its paw slots.
  labelStack: { height: 18, justifyContent: 'center' },
  label: {
    position: 'absolute',
    fontSize: fontSize.sm,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
  },
  warning: {
    fontSize: fontSize.xs,
    color: colors.amberInk,
    fontFamily: fontFamily.regular,
  },
});
