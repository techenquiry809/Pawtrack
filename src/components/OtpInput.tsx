/**
 * A one-box-per-digit code entry.
 *
 * Used for both flows that used to be an email link: confirming a new
 * account and resetting a password. Both are on this app's most
 * sensitive screen — the one standing between a stranger and a dog's
 * medical history — so the code has to be easy to get right one-handed,
 * not just easy to look at.
 *
 * ── WHY EVERY BOX HAS NO `maxLength` ────────────────────────────────────
 *
 * A single-character limit sounds right for a single-digit box, but it breaks
 * the one thing this control has to support: pasting or autofilling the whole
 * code into whichever box happens to be focused. `maxLength` truncates before
 * `onChangeText` sees the value on some platforms and after it on others, so
 * relying on it makes paste behave differently on iOS and Android. Instead
 * every keystroke or paste is inspected in full and only the DIGITS are kept,
 * however many arrived — one advances a box, a whole code fills the rest of
 * them and moves focus to the end.
 *
 * ── WHY `Animated`, NOT REANIMATED ──────────────────────────────────────
 *
 * Same call already made in PawTrail.tsx: react-native-reanimated is a
 * dependency but unused elsewhere in the app, and its worklets plugin fails at
 * runtime rather than at build time. `Animated` drives the error shake on the
 * UI thread with `useNativeDriver`, which is all a shake needs.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, TextInput, View } from 'react-native';
import { colors, fontFamily, radius, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';
import { OTP_LENGTH } from '@/constants/auth';

const DIGIT = /\d/g;

export type OtpInputProps = {
  /** Defaults to OTP_LENGTH — the project's setting, not a look. */
  length?: number;
  value: string;
  onChangeText: (value: string) => void;
  /** Fired once, when the value first reaches `length` digits. */
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Red boxes and a shake — set this when the code was rejected. */
  error?: boolean;
  accessibilityLabel?: string;
};

export function OtpInput({
  length = OTP_LENGTH,
  value,
  onChangeText,
  onComplete,
  autoFocus = false,
  disabled = false,
  error = false,
  accessibilityLabel = 'Verification code',
}: OtpInputProps) {
  const reduced = useReducedMotion();
  const refs = useRef<(TextInput | null)[]>([]);
  const completedFor = useRef<string | null>(null);

  const chars = useMemo(
    () => Array.from({ length }, (_, i) => value[i] ?? ''),
    [value, length],
  );

  const focusAt = (index: number) => {
    refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();
  };

  useEffect(() => {
    if (value.length === length && completedFor.current !== value) {
      completedFor.current = value;
      onComplete?.(value);
    }
    if (value.length < length) completedFor.current = null;
    // onComplete is read fresh each call; including it would re-fire this
    // effect on every render of a caller that passes an inline function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, length]);

  /* ---- Error shake --------------------------------------------------- */
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!error || reduced) return;
    shake.setValue(0);
    Animated.sequence(
      [0, -8, 7, -5, 3, 0].map((to) =>
        Animated.timing(shake, { toValue: to, duration: 45, useNativeDriver: true }),
      ),
    ).start();
  }, [error, reduced, shake]);

  /* ---- Editing --------------------------------------------------------
   * One handler for the whole control rather than one per box: filling from
   * a paste has to reach across boxes, and keeping a single source of truth
   * for "what the value becomes next" is what stops the boxes from disagreeing
   * with each other about it. */
  const applyAt = (index: number, typed: string) => {
    const previous = chars[index] ?? '';
    // Some keyboards report "old+new" rather than just what changed when a
    // box already holds a character; strip the part that was already there.
    const added = typed.startsWith(previous) ? typed.slice(previous.length) : typed;
    const digits = added.match(DIGIT) ?? [];

    if (digits.length === 0) {
      // Nothing usable arrived (a letter on a numeric pad, or the box was
      // cleared). Clearing is the only case that changes anything.
      if (typed.length === 0 && previous !== '') {
        const next = chars.slice();
        next[index] = '';
        onChangeText(next.join(''));
      }
      return;
    }

    // One digit types over this box and moves on; a run of digits is a paste
    // or an autofill, and it fills forward from here.
    const next = chars.slice();
    let cursor = index;
    for (const d of digits) {
      if (cursor >= length) break;
      next[cursor] = d;
      cursor += 1;
    }
    onChangeText(next.join(''));
    focusAt(Math.min(cursor, length - 1));
  };

  const onKeyPress = (index: number, key: string) => {
    if (key !== 'Backspace') return;
    if (chars[index]) return; // onChangeText already handles clearing a filled box
    if (index === 0) return;
    const next = chars.slice();
    next[index - 1] = '';
    onChangeText(next.join(''));
    focusAt(index - 1);
  };

  return (
    <Animated.View
      style={[styles.row, { transform: [{ translateX: shake }] }]}
      accessibilityRole="none"
    >
      {chars.map((char, i) => (
        <TextInput
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={char}
          onChangeText={(text) => applyAt(i, text)}
          onKeyPress={({ nativeEvent }) => onKeyPress(i, nativeEvent.key)}
          keyboardType="number-pad"
          // Only the first box offers the OS's OTP autofill affordance — one
          // per row is the platform contract, offering it on all six just
          // means five of them silently do nothing extra.
          textContentType={i === 0 ? 'oneTimeCode' : 'none'}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          editable={!disabled}
          selectTextOnFocus
          style={[
            styles.cell,
            char && styles.cellFilled,
            error && styles.cellError,
          ]}
          accessibilityLabel={`${accessibilityLabel}, digit ${i + 1} of ${length}`}
        />
      ))}
    </Animated.View>
  );
}

const CELL_SIZE = 46;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    fontFamily: fontFamily.bold,
  },
  cellFilled: { borderColor: colors.teal },
  cellError: { borderColor: colors.red, backgroundColor: colors.redTint },
});
