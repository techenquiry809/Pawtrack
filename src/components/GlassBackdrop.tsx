/**
 * The frosted material behind a modal sheet.
 *
 * ── WHAT IT IS ────────────────────────────────────────────────────────
 *
 * A stack of absolutely-positioned layers, rendered as the FIRST child of a
 * container that has already been laid out. It paints nothing of its own
 * geometry and takes no touches, so it can be dropped into an existing sheet
 * without moving a single pixel of what was there:
 *
 *     <View style={styles.sheet}>          // backgroundColor removed
 *       <GlassBackdrop radius={radius.sheet} />
 *       …the sheet's real children…
 *     </View>
 *
 * That shape is deliberate. The alternative — a <GlassPanel> that WRAPS the
 * children — cannot be dropped into DatePickerSheet, whose sheet is a
 * `Pressable` that swallows background taps, without either nesting an extra
 * view inside the touch target or moving the Pressable outward and changing
 * what is tappable. A backdrop composes with whatever the container already
 * is.
 *
 * ── THREE MATERIALS, AND WHY THE THIRD IS OPAQUE ──────────────────────
 *
 *   Liquid Glass  iOS 26+. The real material — it refracts and re-tunes itself
 *                 against whatever passes underneath.
 *   Blur          everywhere else. A genuine platform blur plus a white wash,
 *                 because a plain blur over this cream palette reads muddy.
 *   Opaque        Reduce Transparency. NOT a lighter blur — see the note on
 *                 useReduceTransparency in theme/glass.ts. Someone who turned
 *                 that on has said translucency is a problem for them, and a
 *                 month grid of small date numbers is exactly where it bites.
 *
 * ── LEGIBILITY IS THE CONSTRAINT, NOT THE EFFECT ──────────────────────
 *
 * The tab bar learned this the expensive way: real glass reports its backdrop
 * honestly, so a big saturated element passing under it painted the whole bar
 * and dropped its labels to 3.98:1. A calendar is worse — denser text, and it
 * opens over an arbitrary screen. So the veil here is heavier than the tab
 * bar's, and every value lives in theme/tokens.ts with its reasoning.
 *
 * The scrim under a modal (`colors.scrim`) is still drawn by the sheet's own
 * backdrop, and it is what guarantees a floor: the material is never sampling
 * the raw screen, only a screen already dimmed 45%.
 */

import { memo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';

import { colors } from '@/theme/tokens';
import { ANDROID_BLUR_METHOD, GLASS_CAPABLE, useReduceTransparency } from '@/theme/glass';

/**
 * Blur strength per platform.
 *
 * The same pair the tab bar uses. Android's blur is a different, more
 * expensive implementation than the iOS one and goes to mud at high values, so
 * it is deliberately lighter and leans harder on the veil above it.
 */
const BLUR_INTENSITY = Platform.OS === 'ios' ? 60 : 32;

function GlassBackdropImpl({
  /**
   * Must match the container's own `borderRadius`, or the material's corners
   * cut across the sheet's. Passed rather than inferred because a style object
   * cannot be read back out of the view it was applied to.
   */
  radius,
}: {
  radius: number;
}) {
  // ONE subscription, two answers. Calling useGlassSupport() as well would open
  // a second AccessibilityInfo listener and keep a second copy of the same
  // system setting, only to recompute what this line already has.
  const reduceTransparency = useReduceTransparency();
  const glass = GLASS_CAPABLE && !reduceTransparency;

  // `pointerEvents="none"` on every layer: this is paint, not a control, and a
  // tap landing on the material must reach whatever the sheet put above it.
  const fill: StyleProp<ViewStyle>[] = [
    StyleSheet.absoluteFill,
    { borderRadius: radius },
  ];

  if (reduceTransparency) {
    return (
      <View
        pointerEvents="none"
        style={[...fill, { backgroundColor: colors.card }]}
      />
    );
  }

  return (
    <View pointerEvents="none" style={[...fill, styles.clip]}>
      {glass ? (
        <>
          <GlassView
            // 'regular', not 'clear'. Clear glass is built for a photo or video
            // backdrop and lets nearly everything through; over a month grid it
            // would put the screen underneath between the date numbers.
            glassEffectStyle="regular"
            tintColor={colors.glassTint}
            // The app is light-themed and does not follow the system theme.
            // 'auto' would hand us dark glass under a dark OS and put ink text
            // on a near-black sheet.
            colorScheme="light"
            style={fill}
          />
          <View style={[...fill, styles.glassScrim]} />
        </>
      ) : (
        <>
          <BlurView
            intensity={BLUR_INTENSITY}
            tint="light"
            // Without this Android does not blur at all — see the constant.
            blurMethod={ANDROID_BLUR_METHOD}
            style={fill}
          />
          <View style={[...fill, styles.veil]} />
        </>
      )}

      {/*
        The lit edge. Two nodes, because a real pane is not lit evenly: the
        border carries a soft highlight all the way round, and the top hairline
        sits over it at full strength where light would actually catch.

        Inside the clipping view so both follow the corner radius, and last so
        neither is painted over by the material.
      */}
      <View style={[...fill, styles.edge, { borderRadius: radius }]} />
      <View style={styles.topHighlight} />
    </View>
  );
}

/**
 * MEMOISED, because the sheets around it re-render on every interaction.
 *
 * CheckinCalendar keeps `year`, `month` and `selected` in state, so tapping a
 * day or paging a month re-renders the whole sheet — and this component with
 * it, forty times over a browsing session. Its only prop is a constant radius,
 * so every one of those renders would produce an identical tree.
 *
 * React would still reconcile that tree and diff a native blur view each time.
 * Cheap, but not free, and needless: with memo the parent's re-render stops at
 * this boundary entirely. The Reduce Transparency subscription inside still
 * re-renders it when the system setting actually changes, which is the only
 * time its output can differ.
 */
export const GlassBackdrop = memo(GlassBackdropImpl);

const styles = StyleSheet.create({
  // Keeps the blur and the edges inside the rounded corners. Android in
  // particular ignores borderRadius on a child unless the parent clips.
  clip: { overflow: 'hidden' },
  veil: { backgroundColor: colors.glassVeil },
  glassScrim: { backgroundColor: colors.glassScrim },
  edge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdgeSoft,
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    // Inset so the highlight stops before the corners, where a straight line
    // would otherwise run past the curve and read as a seam.
    left: 16,
    right: 16,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassEdge,
  },
});
