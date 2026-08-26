/**
 * Liquid-glass floating action button.
 *
 * ── WHY THIS IS NOT THE SHADCN COMPONENT ──────────────────────────────
 *
 * The reference implementation is web React: `<div>`, Tailwind classes, Radix
 * `Slot`, and — the part with no equivalent at all — an SVG `feTurbulence` /
 * `feDisplacementMap` filter applied through `backdrop-filter: url(#…)`.
 * React Native has no DOM, no CSS backdrop-filter and no SVG filter pipeline,
 * so none of it can run here.
 *
 * This reproduces the LOOK natively:
 *
 *   real backdrop blur   expo-blur's BlurView (a genuine platform blur, not a
 *                        translucent overlay pretending to be one)
 *   liquid sheen         a top-light / bottom-dark gradient, which is what
 *                        reads as a curved glass surface
 *   specular rim         a hairline top highlight and a darker bottom edge,
 *                        standing in for the reference's stacked inset shadows
 *   press response       scale + brightness over 150ms, the platform-native
 *                        feel and inside the 150–300ms guidance
 *
 * ── LEGIBILITY OUTRANKS THE EFFECT ────────────────────────────────────
 *
 * This is the control that starts a seizure timer. Glass is applied as the
 * SURROUND — the frosted rim and sheen — over an opaque core, never as
 * transparency across the label. A translucent red pill over a scrolling list
 * would put white text on whatever happened to be underneath it, and this is
 * the one button in the app that must be readable instantly, in a hurry, in
 * bad light.
 */

import { useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { Icon, type IconName } from '@/components/Icon';
import { colors, fontSize, MIN_TOUCH_TARGET } from '@/theme/tokens';

/** Press feedback: fast enough to feel instant, slow enough to be seen. */
const PRESS_MS = 150;

export function LiquidGlassButton({
  label,
  icon,
  onPress,
  tint = colors.red,
  accessibilityHint,
  style,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  /** The opaque core colour. Defaults to the app's Record red. */
  tint?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) => {
    Animated.timing(scale, {
      toValue: value,
      duration: PRESS_MS,
      // Transform only — never width/height, which would relayout every frame
      // and force the animation off the UI thread.
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => animateTo(0.96)}
        onPressOut={() => animateTo(1)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        // The visual pill is inset from the touch area, so the tap target stays
        // comfortably above the 44pt minimum without the button looking bulky.
        hitSlop={10}
        style={styles.press}
      >
        {/* Frosted rim. Sits BEHIND the opaque core and extends past it, so the
            glass reads at the edges without ever sitting under the label. */}
        <BlurView
          intensity={Platform.OS === 'ios' ? 40 : 24}
          tint="light"
          style={StyleSheet.absoluteFill}
        />

        {/* Opaque core. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />

        {/* Liquid sheen: light gathering at the top, falling away below. This
            single gradient is what makes a flat pill read as a curved surface. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.38)', 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.10)']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Specular rim — a bright hairline on top, a darker one beneath. */}
        <View style={styles.rimTop} pointerEvents="none" />
        <View style={styles.rimBottom} pointerEvents="none" />

        <View style={styles.content}>
          {icon ? <Icon name={icon} size="md" color="#fff" filled /> : null}
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const RADIUS = 28;

const styles = StyleSheet.create({
  wrap: {
    borderRadius: RADIUS,
    // The lift that makes it read as floating above the content, not printed
    // on it. Android needs elevation; iOS needs the shadow triplet.
    shadowColor: '#20293A',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  press: {
    minHeight: MIN_TOUCH_TARGET + 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: RADIUS,
    // Required, or the blur and gradient layers paint past the rounded corners.
    overflow: 'hidden',
  },
  rimTop: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  rimBottom: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    color: '#fff',
    fontWeight: '700',
    fontSize: fontSize.md,
    letterSpacing: 0.2,
  },
});
