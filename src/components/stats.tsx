/**
 * Stat cards with inline mini-visualisations.
 *
 * Layout follows the reference design: a label, a large value with a small
 * unit, a round icon badge, and a compact chart filling the bottom of the card.
 * The PALETTE does not follow the reference — it stays on this app's existing
 * cream/teal tokens, as instructed.
 *
 * ── CHART RULES ───────────────────────────────────────────────────────
 *
 * Each of these is a SINGLE SERIES, so: one hue, no legend (the card's own
 * label names the series), and recessive baselines. They are deliberately
 * axis-free — at this size an axis is unreadable, so the card carries the
 * headline number and the chart carries only the shape. Anything that needs a
 * precise read gets a labelled row on the detail screen instead.
 *
 * Drawn with plain Views rather than SVG: these are rectangles at small sizes,
 * and a charting dependency for two shapes would be poor value.
 *
 * DELIBERATELY NO PROGRESS RING. The reference design uses one for
 * "8,421 / 10,000 steps" — progress toward a goal. A seizure count has no goal,
 * and a ring would invent one: a half-filled dial reads as "halfway there",
 * which is a grotesque thing to imply about a dog having seizures.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fontFamily, fontSize, radius, shadow, spacing } from '@/theme/tokens';
import { Icon, type IconName } from '@/components/Icon';

/* ------------------------------------------------------------------ */
/* Card shell                                                          */
/* ------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  unit,
  icon,
  children,
  style,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: IconName;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={[styles.card, style]}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}${unit ? ` ${unit}` : ''}`}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardLabel} numberOfLines={2}>
          {label}
        </Text>
        <View style={styles.badge}>
          <Icon name={icon} size="md" color={colors.tealDeep} />
        </View>
      </View>

      <View style={styles.valueRow}>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {value}
        </Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>

      {children ? <View style={styles.chartSlot}>{children}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

/**
 * A shape-only trend, drawn as thin bars.
 *
 * The most recent bar is emphasised — on a "how have things been going" card
 * the current period is where the eye should land.
 *
 * Fewer than two points renders a note rather than a single bar, which would
 * read as a trend when it is one observation.
 */
export function Sparkline({
  values,
  height = 40,
}: {
  values: number[];
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <View style={[styles.sparkEmpty, { height }]}>
        <Text style={styles.sparkEmptyText}>Not enough history yet</Text>
      </View>
    );
  }

  const max = Math.max(...values, 1);
  return (
    <View style={[styles.sparkRow, { height }]}>
      {values.map((v, i) => {
        const isLast = i === values.length - 1;
        return (
          <View key={i} style={styles.sparkCol}>
            <View
              style={[
                styles.sparkBar,
                {
                  height: Math.max(2, (v / max) * (height - 8)),
                  backgroundColor: isLast ? colors.teal : colors.tealTint,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented meter                                                     */
/* ------------------------------------------------------------------ */

/**
 * Discrete segments, filled up to `active`. Used where the underlying quantity
 * is genuinely a count of a few things rather than a continuous measure — a
 * bar would imply a precision that is not there.
 */
export function SegmentMeter({
  total,
  active,
  height = 26,
}: {
  total: number;
  active: number;
  height?: number;
}) {
  return (
    <View style={[styles.meterRow, { height }]}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.meterSeg,
            { backgroundColor: i < active ? colors.teal : colors.line },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    ...shadow.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardLabel: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.inkSoft,
    lineHeight: 17,
    fontFamily: fontFamily.semibold
  },
  badge: {
    width: 28,
    height: 28,
    // A CIRCLE: half of 28. Not a step on the radius scale — snapping
    // this to a token turns the circle into a rounded square.
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tealTint,
  },

  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: spacing.sm },
  value: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.bold
  },
  unit: { fontSize: fontSize.sm, color: colors.inkSoft, fontWeight: '600', fontFamily: fontFamily.semibold },

  chartSlot: { marginTop: spacing.sm },

  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  sparkCol: { flex: 1, justifyContent: 'flex-end' },
  sparkBar: { width: '100%', borderRadius: 2 },
  sparkEmpty: { justifyContent: 'flex-end' },
  sparkEmptyText: { fontSize: fontSize.xs, color: colors.inkSoft, fontFamily: fontFamily.regular },

  meterRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  meterSeg: { flex: 1, height: '70%', borderRadius: 2 },

});
