/**
 * Shared UI primitives.
 *
 * Everything visual in the app is built from these, so a design change happens
 * in one file. Each component is deliberately small and unopinionated about
 * layout — callers supply spacing via the `style` prop.
 *
 * Accessibility notes that must not be removed:
 *   - Every pressable declares accessibilityRole and an accessible label.
 *   - Nothing relies on colour alone to convey state (chips gain a checkmark,
 *     banners carry an icon and text).
 *   - No component sets allowFontScaling={false}, so OS text sizing works.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, fontSize, radius, shadow, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

type TxtProps = {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

export const Title = ({ children, style }: TxtProps) => (
  <Text style={[styles.title, style]}>{children}</Text>
);

export const Heading = ({ children, style }: TxtProps) => (
  <Text style={[styles.heading, style]}>{children}</Text>
);

export const Body = ({ children, style, numberOfLines }: TxtProps) => (
  <Text style={[styles.body, style]} numberOfLines={numberOfLines}>
    {children}
  </Text>
);

export const Muted = ({ children, style, numberOfLines }: TxtProps) => (
  <Text style={[styles.muted, style]} numberOfLines={numberOfLines}>
    {children}
  </Text>
);

export const SectionTitle = ({ children, style }: TxtProps) => (
  <Text style={[styles.sectionTitle, style]}>{children}</Text>
);

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export const Card = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) => <View style={[styles.card, style]}>{children}</View>;

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  large = false,
  disabled = false,
  loading = false,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  large?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.btn,
        large && styles.btnLarge,
        variant === 'primary' && styles.btnPrimary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        pressed && styles.btnPressed,
        isDisabled && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'ghost' ? colors.ink : '#fff'}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.btnLabel,
            large && styles.btnLabelLarge,
            variant === 'ghost' && styles.btnLabelGhost,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Chip — the quick-tap observation control                            */
/* ------------------------------------------------------------------ */

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipOn,
        pressed && styles.btnPressed,
      ]}
    >
      {/* Checkmark, not just colour — required for colour-blind users. */}
      <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export const ChipGroup = ({ children }: { children: ReactNode }) => (
  <View style={styles.chipGroup}>{children}</View>
);

/* ------------------------------------------------------------------ */
/* Pill — small status badge                                           */
/* ------------------------------------------------------------------ */

export type PillTone = 'teal' | 'amber' | 'red' | 'green' | 'neutral';

const pillTones: Record<PillTone, { bg: string; fg: string }> = {
  teal: { bg: colors.tealTint, fg: colors.tealDeep },
  amber: { bg: colors.amberTint, fg: colors.amberInk },
  red: { bg: colors.redTint, fg: colors.redDeep },
  green: { bg: colors.greenTint, fg: colors.greenInk },
  neutral: { bg: '#EEE', fg: '#666' },
};

export function Pill({ label, tone = 'teal' }: { label: string; tone?: PillTone }) {
  const t = pillTones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillLabel, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* StatTile                                                            */
/* ------------------------------------------------------------------ */

export function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Disclaimer — the standing medical-framing notice                    */
/* ------------------------------------------------------------------ */

/**
 * Do not delete instances of this from screens. The "association, not
 * causation" framing is a product requirement, not decoration.
 */
export const Disclaimer = ({ children }: { children: ReactNode }) => (
  <View style={styles.disclaimer}>
    <Text style={styles.disclaimerText}>{children}</Text>
  </View>
);

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.5,
  },
  heading: { fontSize: fontSize.md, fontWeight: '700', color: colors.ink },
  body: { fontSize: fontSize.base, color: colors.ink },
  muted: { fontSize: fontSize.sm, color: colors.inkSoft, lineHeight: 18 },
  sectionTitle: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontWeight: '700',
    color: colors.inkSoft,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },

  btn: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnLarge: { minHeight: 58 },
  btnPrimary: { backgroundColor: colors.teal },
  btnGhost: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnDanger: { backgroundColor: colors.red },
  btnPressed: { opacity: 0.75 },
  btnDisabled: { opacity: 0.45 },
  btnLabel: { color: '#fff', fontWeight: '700', fontSize: fontSize.base },
  btnLabelLarge: { fontSize: fontSize.md },
  btnLabelGhost: { color: colors.ink },

  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
  },
  chipOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.ink },
  chipLabelOn: { color: '#fff' },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  pillLabel: { fontSize: fontSize.xs, fontWeight: '700' },

  stat: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    padding: spacing.md,
    ...shadow.card,
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.5,
  },
  statLabel: { fontSize: fontSize.xs, color: colors.inkSoft, marginTop: 5 },

  disclaimer: {
    backgroundColor: colors.tealTint,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  disclaimerText: {
    fontSize: fontSize.sm,
    color: colors.tealDeep,
    lineHeight: 18,
  },
});
