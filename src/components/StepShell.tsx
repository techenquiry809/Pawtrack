/**
 * The chrome around a form that asks one thing at a time.
 *
 * ── WHY THIS IS SHARED AND NOT COPIED ─────────────────────────────────
 *
 * Three screens now ask a sequence of optional questions — the daily check-in,
 * the post-seizure questions, and logging a past seizure. They had drifted
 * into three different answers to the same problem: one had a pinned action
 * bar, one had a save button at the bottom of a four-scroll form, and one had
 * a progress trail that described the whole flow rather than the current form.
 *
 * The chrome is identical in all three, so it lives here once. What differs is
 * only the questions, which stay in the screens.
 *
 * ── WHY A SEQUENCE HELPS AT ALL ───────────────────────────────────────
 *
 * Every question in these forms is optional. That is the right data model and
 * it produces the wrong screen: an owner shown eleven groups of chips has no
 * way to tell how much is expected of them, and the honest answer — "none of
 * it" — is the one thing a long scroll cannot communicate. Splitting the same
 * fields across steps removes nothing and changes what has to be held in the
 * head: one decision at a time, a visible position, and an end in sight.
 *
 * This matters most on the post-seizure screen, which is read minutes after
 * the event by someone who is not calm.
 */

import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Muted, Title } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';

export type StepShellProps = {
  /** One label per step. Length defines the sequence. */
  steps: readonly { title: string; hint?: string }[];
  current: number;
  /** Shown centred in the header — the day, or what is being recorded. */
  subtitle?: string;
  onBack: () => void;
  onNext: () => void;
  /** Called by the close button. Owners of unsaved work should confirm here. */
  onClose: () => void;
  /** Label for the primary action on the LAST step. */
  finishLabel: string;
  onFinish: () => void;
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

export function StepShell({
  steps,
  current,
  subtitle,
  onBack,
  onNext,
  onClose,
  finishLabel,
  onFinish,
  busy = false,
  disabled = false,
  children,
}: StepShellProps) {
  const insets = useSafeAreaInsets();
  const step = steps[current] ?? steps[0];
  const isLast = current === steps.length - 1;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
        >
          <Icon name="clear" size="md" color={colors.ink} />
        </Pressable>
        <View style={styles.flexOne}>
          {subtitle ? <Muted style={styles.subtitle}>{subtitle}</Muted> : null}
        </View>
        <Text style={styles.counter}>
          {current + 1} of {steps.length}
        </Text>
      </View>

      {/* A bar rather than dots: at this width a row of dots is smaller than
          the eye reads as progress, and a bar keeps working when a step is
          added later. */}
      <View style={styles.track} accessibilityRole="progressbar">
        <View
          style={[styles.fill, { width: `${((current + 1) / steps.length) * 100}%` }]}
        />
      </View>

      <ScrollView
        style={styles.flexOne}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Title style={styles.stepTitle}>{step?.title ?? ''}</Title>
        {step?.hint ? <Muted style={styles.stepHint}>{step.hint}</Muted> : null}
        {children}
      </ScrollView>

      {/*
        Pinned, so the way out never depends on scrolling.
        Every question in these forms is optional, and an owner who wants to
        answer none of them must not have to scroll past all of them to leave.
      */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="Back"
          variant="ghost"
          onPress={current === 0 ? onClose : onBack}
          accessibilityHint={current === 0 ? 'Closes this form' : 'Goes back one question'}
          style={styles.navBtn}
        />
        <Button
          label={isLast ? finishLabel : 'Next'}
          onPress={isLast ? onFinish : onNext}
          loading={busy}
          disabled={disabled}
          accessibilityHint={isLast ? undefined : 'Goes to the next question'}
          style={styles.navBtnWide}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flexOne: { flex: 1 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20, // A circle: half of 40, not a step on the radius scale.
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  subtitle: { textAlign: 'center' },
  counter: {
    fontSize: fontSize.sm,
    color: colors.inkSoft,
    fontFamily: fontFamily.semibold,
    fontVariant: ['tabular-nums'],
    minWidth: 52,
    textAlign: 'right',
  },

  track: {
    height: 4,
    marginHorizontal: spacing.lg,
    borderRadius: 2, // Half of 4 — a rounded end, not a scale step.
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 2, backgroundColor: colors.teal },

  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  stepTitle: { marginBottom: 2 },
  stepHint: { marginBottom: spacing.md },

  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
  },
  navBtn: { flex: 1 },
  navBtnWide: { flex: 2 },
});
