/**
 * Form and page-structure primitives.
 *
 * ── WHY A SECOND COMPONENT FILE ───────────────────────────────────────
 *
 * ui.tsx owns the atoms an app of any kind would have: Button, Chip, Card,
 * Pill. This file owns the pieces that exist because of how THIS app's screens
 * are shaped — a long optional questionnaire filled in by someone who has just
 * watched their dog have a seizure.
 *
 * ── THE HIERARCHY PROBLEM THIS FIXES ──────────────────────────────────
 *
 * The seizure screens had grown three competing label styles at nearly the
 * same size: an all-caps section label, an all-caps group label, and a bold
 * sentence-case question. Three levels rendered at one weight is no hierarchy
 * at all — the owner sees an undifferentiated wall of chips.
 *
 * There are now exactly two levels, and they are visually unmistakable:
 *
 *   SectionRule    a hairline + small caps + count      structural, scannable
 *   QuestionLabel  large sentence case, no rule         a thing to answer
 *
 * Do not add a third. If something does not fit these two, it is probably a
 * Card.
 */

import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';

/* ------------------------------------------------------------------ */
/* Screen header                                                       */
/* ------------------------------------------------------------------ */

/**
 * The top of a screen: a small eyebrow, a large title, and an optional action.
 *
 * The eyebrow carries context the title would otherwise have to repeat —
 * "STEP 2 OF 3", "IMPORTED VIDEO" — which is what lets the title stay short
 * enough to read at a glance.
 */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.screenTitle}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action ? <View style={styles.headerAction}>{action}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* The two label levels                                                */
/* ------------------------------------------------------------------ */

/**
 * Structural divider. The hairline is what makes this read as a level ABOVE a
 * question rather than beside it — colour and letter-spacing alone were not
 * enough at 11px.
 *
 * `count` shows how many answers are selected inside the section, so a
 * collapsed-looking wall of chips still reports its own state. It is omitted
 * entirely at zero: "0 selected" reads as a failure, an absent badge reads as
 * "nothing yet", which is what an optional field deserves.
 */
export function SectionRule({
  label,
  count,
  style,
}: {
  label: string;
  count?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionRule, style]}>
      <Text style={styles.sectionRuleLabel}>{label}</Text>
      {count !== undefined && count > 0 ? (
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{count}</Text>
        </View>
      ) : null}
      <View style={styles.sectionRuleLine} />
    </View>
  );
}

/** A question the owner is being asked. Sentence case, deliberately larger. */
export function QuestionLabel({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <View style={styles.question}>
      <Text style={styles.questionText}>{children}</Text>
      {hint ? <Text style={styles.questionHint}>{hint}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Text entry                                                          */
/* ------------------------------------------------------------------ */

/**
 * The multiline input, in one place.
 *
 * It was previously redeclared in every screen that needed one, which is how
 * three of them ended up with different heights and only one of them set
 * textAlignVertical — so Android put the placeholder in the vertical middle on
 * exactly one screen.
 */
export function TextArea({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  tall = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  tall?: boolean;
}) {
  return (
    <TextInput
      style={[styles.input, tall && styles.inputTall]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.inkSoft}
      multiline
      accessibilityLabel={accessibilityLabel}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Flow progress                                                       */
/* ------------------------------------------------------------------ */

/**
 * Where the owner is in a multi-screen flow.
 *
 * This exists because the post-seizure form gave no sense of how much was
 * left, and a long optional questionnaire with no visible end reads as a
 * demand rather than an offer. The labels are spelled out rather than shown as
 * bare dots — a dot row tells you there are three steps but not what they are.
 */
export function StepTrail({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <View
      style={styles.trail}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${steps[current] ?? ''}`}
    >
      {steps.map((step, index) => {
        const state =
          index < current ? 'done' : index === current ? 'now' : 'todo';
        return (
          <View key={step} style={styles.trailStep}>
            <View
              style={[
                styles.trailBar,
                state === 'done' && styles.trailBarDone,
                state === 'now' && styles.trailBarNow,
              ]}
            />
            <Text
              style={[
                styles.trailLabel,
                state === 'now' && styles.trailLabelNow,
              ]}
              numberOfLines={1}
            >
              {step}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Sticky action bar                                                   */
/* ------------------------------------------------------------------ */

/**
 * The commit action, pinned above the home indicator.
 *
 * On the post-seizure screen the Continue button used to sit at the very
 * bottom of a form long enough to need four scrolls. An owner who had answered
 * nothing — which is allowed, everything is optional — still had to scroll
 * past every question to leave.
 */
export function ActionBar({
  children,
  bottomInset,
}: {
  children: ReactNode;
  bottomInset: number;
}) {
  return (
    <View style={[styles.actionBar, { paddingBottom: bottomInset + spacing.sm }]}>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Small tappable text                                                 */
/* ------------------------------------------------------------------ */

/** A low-emphasis text action. Meets the 48pt target despite looking small. */
export function TextAction({
  label,
  onPress,
  tone = 'teal',
}: {
  label: string;
  onPress: () => void;
  tone?: 'teal' | 'red';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.textAction, pressed && { opacity: 0.6 }]}
    >
      <Text
        style={[
          styles.textActionLabel,
          tone === 'red' && { color: colors.redDeep },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* header */
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1 },
  headerAction: { paddingTop: 2 },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.teal,
    marginBottom: 6,
    fontFamily: fontFamily.bold
  },
  screenTitle: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.6,
    lineHeight: fontSize.display * 1.12,
    fontFamily: fontFamily.bold
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.inkSoft,
    marginTop: spacing.sm,
    lineHeight: fontSize.base * 1.45,
    fontFamily: fontFamily.regular
  },

  /* section rule */
  sectionRule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionRuleLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.inkSoft,
    fontFamily: fontFamily.extrabold
  },
  sectionRuleLine: { flex: 1, height: 1, backgroundColor: colors.line },
  countBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.tealTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.tealDeep,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.extrabold
  },

  /* question */
  question: { marginTop: spacing.lg, marginBottom: spacing.md },
  questionText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.2,
    lineHeight: fontSize.md * 1.35,
    fontFamily: fontFamily.bold
  },
  questionHint: {
    fontSize: fontSize.sm,
    color: colors.inkSoft,
    marginTop: 5,
    lineHeight: fontSize.sm * 1.45,
    fontFamily: fontFamily.regular
  },

  /* input */
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    minHeight: 56,
    fontSize: fontSize.base,
    color: colors.ink,
    marginTop: spacing.md,
    textAlignVertical: 'top',
    fontFamily: fontFamily.regular
  },
  inputTall: { minHeight: 104 },

  /* trail */
  trail: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  trailStep: { flex: 1 },
  trailBar: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 6,
  },
  trailBarDone: { backgroundColor: colors.tealTint },
  trailBarNow: { backgroundColor: colors.teal },
  trailLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.inkSoft,
    letterSpacing: 0.2,
    fontFamily: fontFamily.semibold
  },
  trailLabelNow: { color: colors.tealDeep, fontWeight: '800', fontFamily: fontFamily.extrabold },

  /* action bar */
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: spacing.sm,
  },

  /* text action */
  textAction: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textActionLabel: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.tealDeep,
    fontFamily: fontFamily.bold
  },
});
