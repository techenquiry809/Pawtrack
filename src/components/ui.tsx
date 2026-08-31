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

import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, shadow, spacing } from '@/theme/tokens';
import { duration, useReducedMotion } from '@/theme/motion';
import { Icon, type IconName } from '@/components/Icon';

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

/**
 * Button — variant/size system ported from the shadcn/ui button.
 *
 * The shadcn source is a web component: it styles a DOM <button> with Tailwind
 * classes through `cva`, and composes via @radix-ui/react-slot. None of that
 * exists in React Native, so what is ported here is the DESIGN CONTRACT rather
 * than the code — the variant and size matrix, the proportions, and the states:
 *
 *   cva variants          -> the `variants` / `sizes` lookup tables below
 *   rounded-lg            -> radius.control (now a pill, see below)
 *   text-sm font-medium   -> fontSize.base / fontWeight '500'
 *   shadow-sm shadow-black/5 -> shadow.button
 *   disabled:opacity-50   -> btnDisabled
 *   hover:bg-<fill>/90    -> btnPressed (touch has no hover; press is its analogue)
 *   [&_svg]:shrink-0      -> the icon slot renders at a fixed size, never flexed
 *   asChild / Slot        -> not ported; RN has no DOM element to merge props
 *                            onto, and Pressable already composes by nesting.
 *
 * COLOURS ARE UNCHANGED. Every fill, border and label colour still comes from
 * the app's own tokens — only geometry, elevation and state behaviour follow
 * shadcn.
 *
 * Legacy prop names are kept as aliases so the ~64 existing call sites are
 * untouched: `variant="ghost"` is shadcn's `outline`, and `large` is `size="lg"`.
 */

type ButtonVariant =
  /** shadcn `default` — the filled brand action. */
  | 'primary'
  | 'default'
  /** shadcn `destructive`. */
  | 'danger'
  | 'destructive'
  /** shadcn `outline` — this is what the app has always called `ghost`. */
  | 'ghost'
  | 'outline'
  /** shadcn `secondary` — filled, but tinted rather than saturated. */
  | 'secondary'
  /** shadcn `ghost` — no fill, no border, no shadow. */
  | 'bare'
  /** shadcn `link`. */
  | 'link';

type ButtonSize = 'sm' | 'default' | 'lg' | 'icon';

/**
 * Painted heights, from shadcn's h-8 / h-9 / h-10.
 *
 * These are SMALLER than MIN_TOUCH_TARGET, which the token file requires of
 * anything interactive — the seizure screen is used one-handed by someone
 * panicking. Both constraints are honoured by separating the two concerns the
 * web version conflates: the box is painted at the shadcn height, and `hitSlop`
 * below extends the *touchable* area back out to MIN_TOUCH_TARGET. Nothing
 * shrinks as a tap target; only as a drawing.
 */
/**
 * The focus ring — shadcn's `outline-2 outline-offset-2 outline-ring/70`.
 *
 * RN has no `outline` property, so the ring is a real View inset by a negative
 * amount and given a border. `outline` never affected layout on the web, and
 * neither does this: the ring is absolutely positioned and pointerEvents="none",
 * so it cannot shift the label or steal the tap.
 *
 * OFFSET + WIDTH is how far it sits outside the button's own edge, which is
 * also how much its corner radius has to grow to stay concentric.
 */
const RING_WIDTH = 2;
const RING_OFFSET = 2;
const RING_INSET = RING_WIDTH + RING_OFFSET;

/** shadcn's `/70`. */
const RING_OPACITY = 0.7;

const BUTTON_HEIGHT: Record<ButtonSize, number> = {
  sm: 32,
  default: 36,
  lg: 40,
  icon: 36,
};

/** Vertical hitSlop that restores a sub-48pt button to a 48pt touch target. */
const touchSlop = (size: ButtonSize) =>
  Math.max(0, Math.ceil((MIN_TOUCH_TARGET - BUTTON_HEIGHT[size]) / 2));

export function Button({
  label,
  onPress,
  variant = 'primary',
  size,
  large = false,
  disabled = false,
  loading = false,
  icon,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Legacy alias for `size="lg"`. Prefer `size`. */
  large?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /**
   * Leading glyph, shadcn's `[&_svg]` slot. Rendered at a fixed size and never
   * allowed to flex, so a long label wraps against the icon rather than
   * squashing it.
   */
  icon?: IconName;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const resolvedSize: ButtonSize = size ?? (large ? 'lg' : 'default');

  /**
   * Ring visibility, 0..1.
   *
   * The web fires this on `:focus-visible` and pairs it with a `hover` colour
   * shift. A touch screen has neither event, so the honest translation of "the
   * pointer is on this control" is "a finger is on this control" — press.
   */
  const glow = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  const fade = (to: number) => {
    // Reduce Motion still gets the ring, just without the fade: it is a state
    // indicator, and hiding it would remove information rather than movement.
    if (reduced) {
      glow.setValue(to);
      return;
    }
    Animated.timing(glow, {
      toValue: to,
      duration: duration.press,
      useNativeDriver: true,
    }).start();
  };

  // Aliases collapse to one canonical branch so the style tables stay flat.
  const isFilled =
    variant === 'primary' || variant === 'default' ||
    variant === 'danger' || variant === 'destructive';
  const isDestructive = variant === 'danger' || variant === 'destructive';
  const isOutline = variant === 'ghost' || variant === 'outline';
  const isLink = variant === 'link';

  // shadcn gives every variant except `ghost` and `link` a shadow-sm.
  const hasShadow = isFilled || isOutline || variant === 'secondary';

  const labelColor = isFilled
    ? '#fff'
    : variant === 'secondary'
      ? colors.tealDeep
      : isLink
        ? colors.teal
        : colors.ink;

  /**
   * The ring takes the button's OWN colour rather than introducing a `--ring`
   * token, so the glow cannot change the palette — it is the fill (or the
   * label, for the unfilled variants) at 70%.
   */
  const ringColor = isFilled
    ? (isDestructive ? colors.red : colors.teal)
    : variant === 'secondary' || isLink
      ? colors.teal
      : colors.ink;

  const slop = touchSlop(resolvedSize);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => fade(1)}
      onPressOut={() => fade(0)}
      disabled={isDisabled}
      hitSlop={{ top: slop, bottom: slop }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.btn,
        { minHeight: BUTTON_HEIGHT[resolvedSize] },
        resolvedSize === 'sm' && styles.btnPadSm,
        resolvedSize === 'lg' && styles.btnPadLg,
        resolvedSize === 'icon' && {
          width: BUTTON_HEIGHT.icon,
          paddingHorizontal: 0,
        },
        hasShadow && shadow.button,
        isFilled && { backgroundColor: isDestructive ? colors.red : colors.teal },
        isOutline && styles.btnOutline,
        variant === 'secondary' && { backgroundColor: colors.tealTint },
        (variant === 'bare' || isLink) && styles.btnBare,
        pressed && styles.btnPressed,
        isDisabled && styles.btnDisabled,
        style,
      ]}
    >
      {/*
        Ring first so it paints behind the label. It is a sibling INSIDE the
        Pressable rather than a wrapper around it, deliberately: wrapping would
        move the caller's `style` (often `flex: 1`) onto an inner element and
        silently break the layouts that rely on it — the same trap the
        btnPressed comment below describes.
      */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.btnRing,
          {
            borderColor: ringColor,
            borderRadius: radius.control + RING_OFFSET,
            opacity: Animated.multiply(glow, RING_OPACITY),
          },
        ]}
      />
      {loading ? (
        <ActivityIndicator color={labelColor} size="small" />
      ) : (
        <>
          {icon ? <Icon name={icon} size="sm" color={labelColor} /> : null}
          {resolvedSize === 'icon' && !label ? null : (
            <Text
              numberOfLines={1}
              style={[
                styles.btnLabel,
                resolvedSize === 'sm' && styles.btnLabelSm,
                { color: labelColor },
                isLink && styles.btnLabelLink,
              ]}
            >
              {label}
            </Text>
          )}
        </>
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
/* SegmentedControl — the filter row                                   */
/* ------------------------------------------------------------------ */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [
              styles.segmentItem,
              active && styles.segmentItemOn,
              pressed && styles.btnPressed,
            ]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelOn]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* NavRow — a settings/navigation row                                  */
/* ------------------------------------------------------------------ */

export function NavRow({
  label,
  detail,
  icon,
  onPress,
  last = false,
}: {
  label: string;
  detail?: string;
  icon?: IconName;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      style={({ pressed }) => [
        styles.navRow,
        !last && styles.navRowDivider,
        pressed && styles.navRowPressed,
      ]}
    >
      {icon ? (
        <View style={styles.navGlyph}>
          <Icon name={icon} size="lg" color={colors.tealDeep} />
        </View>
      ) : null}
      <View style={styles.flexOne}>
        <Text style={styles.navLabel}>{label}</Text>
        {detail ? <Text style={styles.navDetail}>{detail}</Text> : null}
      </View>
      <Icon name="chevron" size="md" color={colors.inkSoft} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon = 'empty',
  title,
  body,
}: {
  icon?: IconName;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.empty} accessible accessibilityLabel={`${title}. ${body}`}>
      <View style={styles.emptyGlyph}>
        <Icon name={icon} size="xl" color={colors.inkSoft} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  flexOne: { flex: 1 },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.line,
    borderRadius: radius.control,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
  },
  segmentItemOn: { backgroundColor: colors.card },
  segmentLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.inkSoft,
    fontFamily: fontFamily.semibold
  },
  segmentLabelOn: { color: colors.ink, fontWeight: '700', fontFamily: fontFamily.bold },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  navRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  navRowPressed: { backgroundColor: colors.bg },
  navGlyph: { width: 24, alignItems: 'center' },
  navLabel: { fontSize: fontSize.md, color: colors.ink, fontWeight: '600', fontFamily: fontFamily.semibold },
  navDetail: { fontSize: fontSize.sm, color: colors.inkSoft, marginTop: 1, fontFamily: fontFamily.regular },

  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: 6 },
  emptyGlyph: { marginBottom: 4 },
  emptyTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.ink, fontFamily: fontFamily.bold },
  emptyBody: {
    fontSize: fontSize.base,
    color: colors.inkSoft,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 300,
    fontFamily: fontFamily.regular
  },

  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.5,
    fontFamily: fontFamily.bold
  },
  heading: { fontSize: fontSize.md, fontWeight: '700', color: colors.ink, fontFamily: fontFamily.bold },
  body: { fontSize: fontSize.base, color: colors.ink, fontFamily: fontFamily.regular },
  muted: { fontSize: fontSize.sm, color: colors.inkSoft, lineHeight: 18, fontFamily: fontFamily.regular },
  sectionTitle: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontWeight: '700',
    color: colors.inkSoft,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontFamily: fontFamily.bold
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },

  /**
   * shadcn: inline-flex items-center justify-center whitespace-nowrap
   *         rounded-lg px-4 py-2, with gap-2 between the icon and the label.
   *
   * `radius.control` — a pill.
   *
   * This went shadcn's rounded-lg (12) for one round and came back. The
   * rectangle was correct for matching the reference and wrong for the app:
   * twelve points of corner on every control made a dog-care journal read like
   * a tax form. shadcn's PROPORTIONS are still here — the size scale, the
   * padding ratios, the states — but the silhouette is soft again, because
   * that is the part the owner actually feels.
   */
  btn: {
    borderRadius: radius.control,
    // A pill needs more horizontal room than a rectangle: the curve eats into
    // the first and last character's breathing space at the same padding.
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btnPadSm: { paddingHorizontal: spacing.md },
  btnPadLg: { paddingHorizontal: spacing.xl + 8 },
  btnOutline: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnBare: { backgroundColor: 'transparent' },
  /** shadcn: outline-2 outline-offset-2. Radius is set per-render to stay concentric. */
  btnRing: {
    position: 'absolute',
    top: -RING_INSET,
    left: -RING_INSET,
    right: -RING_INSET,
    bottom: -RING_INSET,
    borderWidth: RING_WIDTH,
  },
  /**
   * Press feedback for every Button in the app.
   *
   * Opacity alone was too easy to miss — it reads as "this element dimmed",
   * which people also see when something becomes disabled. The scale is the
   * part that reads as a press, because it is the only one that says the
   * surface moved under the finger.
   *
   * Applied as a STATIC pressed style rather than a spring, deliberately:
   * animating it would mean wrapping every Button in an Animated.View, and the
   * `style` prop callers pass (often `flex: 1`) would then land on the inner
   * element instead of the outer one — silently breaking roughly thirty
   * layouts to add easing nobody asked for. Instant is also the correct feel
   * for touch-down.
   */
  btnPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  /** shadcn: disabled:opacity-50. */
  btnDisabled: { opacity: 0.5 },
  /** shadcn: text-sm font-medium. */
  btnLabel: { fontWeight: '500', fontSize: fontSize.base, fontFamily: fontFamily.medium },
  /** shadcn size="sm": text-xs. */
  /**
   * shadcn size="sm" changes text-sm -> text-xs and nothing else, so the face
   * stays `medium`. It has to be restated: this style is layered ON TOP of
   * btnLabel, and omitting fontFamily here would not inherit — it would leave
   * btnLabel's medium in place, but stating `regular` (as a size-only modifier
   * naively would) silently downgrades the weight.
   */
  btnLabelSm: { fontSize: fontSize.sm, fontFamily: fontFamily.medium },
  /** shadcn variant="link": underline-offset-4 hover:underline. */
  btnLabelLink: { textDecorationLine: 'underline' },

  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
  },
  chipOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.ink, fontFamily: fontFamily.semibold },
  chipLabelOn: { color: '#fff' },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  pillLabel: { fontSize: fontSize.xs, fontWeight: '700', fontFamily: fontFamily.bold },

  stat: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    ...shadow.card,
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.5,
    fontFamily: fontFamily.bold
  },
  statLabel: { fontSize: fontSize.xs, color: colors.inkSoft, marginTop: 5, fontFamily: fontFamily.regular },

  disclaimer: {
    backgroundColor: colors.tealTint,
    borderRadius: radius.card,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  disclaimerText: {
    fontSize: fontSize.sm,
    color: colors.tealDeep,
    lineHeight: 18,
    fontFamily: fontFamily.regular
  },
});
