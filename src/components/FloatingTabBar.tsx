/**
 * Floating island tab bar with dock-style magnification.
 *
 * ── TRANSLATING THE DOCK ──────────────────────────────────────────────
 *
 * The reference dock magnifies each item by its distance from the CURSOR:
 * `mouseX` minus `getBoundingClientRect()`, fed through a spring. A phone has
 * no cursor, and `onMouseMove` / `getBoundingClientRect` do not exist in React
 * Native, so a literal port is impossible and would also be pointless.
 *
 * The falloff itself is the good idea, so it is kept and re-pointed at
 * something a touch device actually has: distance from the ACTIVE tab.
 *
 *   active tab        full magnification
 *   its neighbours    a partial lift, same falloff shape
 *   further away      resting size
 *
 * Springs use the reference's own physics (mass 0.1, stiffness 150, damping
 * 12), mapped onto Animated.spring so the motion has the same weight.
 *
 * ── WHY LABELS STAY VISIBLE ───────────────────────────────────────────
 *
 * The dock reveals a label only on hover. Hover does not exist here, and the
 * obvious substitute — labelling only the active tab — would leave three
 * unlabelled glyphs in an app people open in an emergency. Every tab keeps its
 * label; the active one gains weight, colour and a pill instead.
 *
 * ── THE MATERIAL ──────────────────────────────────────────────────────
 *
 * On iOS 26 the island is real Liquid Glass — `GlassView`, the same material
 * the system tab bar uses. It refracts and adapts to whatever scrolls beneath
 * it, which a blur cannot do: a blur samples colour, glass bends light and
 * re-tunes its own contrast against what it finds.
 *
 * The first version of this bar was glass in name only. It stacked a 60%
 * BlurView under `rgba(255,255,255,0.72)` on top of an OPAQUE white backing,
 * so nothing reached the eye through it — the blur was doing no visible work.
 * Both of those had to go for the material to read as transparent at all.
 *
 * Everywhere else — Android, iOS 25 and older, and any device with Reduce
 * Transparency switched on — keeps the blur-and-tint treatment, which is why
 * that code is still here rather than deleted. See `src/theme/glass.ts`.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Icon, type IconName } from '@/components/Icon';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';
import { RECORD_OVERHANG, useChromeMetrics } from '@/theme/chrome';
import { useGlassSupport } from '@/theme/glass';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { useActiveSeizure } from '@/store/activeSeizureStore';

/**
 * Ink for inactive tabs — darker than `colors.inkSoft`, and not a taste call.
 *
 * Anything can scroll under a transparent bar, so the labels have to survive
 * the WORST backdrop, not the average one. On the Home screen the solid teal
 * "Update today's check-in" button passes directly beneath the island, and the
 * glass renders it at #ACDBE0. Against that:
 *
 *   colors.inkSoft #5B6472   3.98:1   fails WCAG AA (needs 4.5)
 *   #414A5A                  5.94:1   passes with room to spare
 *
 * Still lighter than `colors.ink`, so an inactive tab does not shout as loudly
 * as the active one — the hierarchy is carried by hue, weight and the pill.
 */
const CHROME_INK = '#414A5A';

/**
 * Height of the glyph row inside the island, shared by all five columns.
 *
 * 38 rather than the 24pt icon height, so the record disc has room to be a
 * disc with some authority — it is the emergency action. Small enough that
 * 38 + gap + label still clears the 64pt island at both ends, which is what
 * stops `overflow: hidden` slicing the top off the circle.
 */
const GLYPH_SLOT = 38;

/**
 * The Record disc, one step up from the glyph slot rather than a size class
 * above it.
 *
 * 46 against the 38 the other four columns get — about a fifth larger, enough
 * to read as "not one of the four" without the bar becoming a frame around a
 * button. Two larger versions were tried and both failed the same way: at 56
 * the disc took the eye before the labels did, and at 76 (big enough to crest
 * both edges of the bar) it covered the strip the word "Record" lives on.
 *
 * Rendered OUTSIDE the island's clip so its top can crest the bar's edge; see
 * RECORD_OVERHANG.
 */
const RECORD_DISC = 46;

/**
 * How far the dock's box extends above the island.
 *
 * Purely a hit-testing allowance: the disc is drawn outside the island, and a
 * child rendered outside its parent's frame receives no touches on iOS — the
 * emergency button would have had a dead top edge that looked entirely
 * normal. The +2 is slack against rounding.
 */
const DOCK_PAD = RECORD_OVERHANG + 2;

/** The reference dock's spring, as Animated.spring parameters. */
/**
 * Damping dropped from 12 to 10 so the spring settles with a small overshoot
 * instead of easing flat into place. That tiny bounce is most of what reads as
 * "cheerful" in motion — but it stays small on purpose, because this bar is
 * also how somebody reaches the record button during a seizure.
 */
const SPRING = { mass: 0.1, stiffness: 150, damping: 10, useNativeDriver: true };

/**
 * There is deliberately NO press ring.
 *
 * A tab used to draw an outline around its pill on press-in, ported from the
 * shared Button. On a Button, pressed once, it reads as a focus ring. On a
 * nav bar it does not: these five controls get pressed constantly, often
 * repeatedly and quickly, and a hard-edged circle flashing in and out under
 * the thumb reads as a rendering artefact rather than as feedback — it is the
 * one thing people asked about after using the bar.
 *
 * The press is still answered, by the scale spring the dock already had. That
 * is motion attached to the object itself, which is legible at a glance and
 * does not leave an outline behind on the fifth rapid tap.
 */

/** Magnification falloff by distance from the active tab, in tab positions. */
const SCALE_BY_DISTANCE = [1.18, 1.06, 1.0];

function scaleFor(distance: number): number {
  return SCALE_BY_DISTANCE[Math.min(distance, SCALE_BY_DISTANCE.length - 1)] ?? 1;
}

/**
 * The slice of the navigator's tabBar props this bar actually uses.
 *
 * Typed structurally rather than imported from @react-navigation/bottom-tabs:
 * that package is a NESTED dependency of expo-router and does not resolve from
 * the project root, so importing its types would break the build on a clean
 * install.
 */
type TabBarProps = {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    emit: (event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

/** Route name → semantic icon. Keeps glyph choice out of the navigator. */
const ICONS: Record<string, IconName> = {
  index: 'home',
  checkin: 'checkin',
  history: 'records',
  more: 'settings',
};

export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  // Every number here is device-derived — see src/theme/chrome.ts for why a
  // fixed `insets.bottom + gap` produced a 44pt gap on one phone and 10pt on
  // another.
  const { islandHeight, islandBottom, islandWidth, islandRadius } = useChromeMetrics();
  const glass = useGlassSupport();

  return (
    <View
      // Centred rather than stretched, so the width cap actually takes effect
      // on tablets and in landscape.
      style={[styles.dock, { bottom: islandBottom }]}
      // The island must not swallow taps outside itself.
      pointerEvents="box-none"
    >
      {/* TWO nested views on purpose. `overflow: hidden` is required to clip the
          blur to the rounded corners, but on iOS it also clips the view's own
          shadow — so the shadow lives on the outer view and the clipping on the
          inner one. Putting both on one node silently loses the lift. */}
      <View
        style={[
          styles.islandShadow,
          // Glass carries its own edge and ambient shading. Casting the full
          // custom shadow underneath it as well reads as a dark smudge, so the
          // glass path gets a lighter one — and no opaque backing, which is
          // what made the old bar solid.
          glass ? styles.shadowOnGlass : styles.shadowOnBlur,
          { width: islandWidth, borderRadius: islandRadius },
        ]}
      >
        <View
          style={[
            styles.island,
            glass ? styles.islandGlass : styles.islandBlur,
            { height: islandHeight, borderRadius: islandRadius },
          ]}
        >
          {glass ? (
            <GlassView
              // 'regular' rather than 'clear'. Clear glass is built for a
              // photo or video backdrop and lets nearly everything through;
              // over a scrolling list of text it would put words behind the
              // labels. Regular is the adaptive one — properly see-through,
              // but it re-tunes itself against what passes underneath, which
              // is what keeps four small labels readable the whole way down a
              // scroll.
              glassEffectStyle="regular"
              // A whisper of the app's teal so the island belongs to this app
              // rather than reading as system chrome. Any more and it stops
              // looking like glass and starts looking like tinted plastic.
              tintColor="rgba(47,126,134,0.06)"
              // NOT `isInteractive`. That prop is for a glass element that is
              // ITSELF the control — a single glass button. This island is a
              // container whose four children are the controls, and on a
              // container the touch response is a radial highlight centred on
              // the touch point that tints the WHOLE bar: tapping Home turned
              // the entire island saturated teal and washed out the other
              // three labels until the animation settled.
              //
              // The tabs already have their own feedback — the press spring,
              // the magnification falloff, and the active pill — so nothing is
              // lost by leaving the material itself passive.
              // The app is light-themed and does not follow the system theme;
              // 'auto' would hand us dark glass under a dark OS and put teal
              // labels on a near-black bar.
              colorScheme="light"
              style={[StyleSheet.absoluteFill, { borderRadius: islandRadius }]}
            />
          ) : null}
          {glass ? (
            /* Glass reports the backdrop honestly, which is the point of it —
               but it means a big saturated element passing underneath paints
               the whole bar. The teal check-in button on Home turned the
               island vivid cyan (#ACDBE0) and dropped the labels to 3.98:1.
               This scrim caps how much of any one colour the material can
               take on. At 0.22 the backdrop still reads clearly through the
               bar; it is a fraction of the 0.72 wash over an opaque backing
               that this replaced. */
            <View style={styles.glassScrim} pointerEvents="none" />
          ) : (
            <>
              {/* Fallback: blur plus a wash, because without the wash a plain
                  blur reads muddy over this cream background. */}
              <BlurView
                intensity={Platform.OS === 'ios' ? 60 : 32}
                tint="light"
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.islandTint} />
            </>
          )}

          <View style={styles.row}>
            {withRecordSlot(
              state.routes.map((route, index) => {
                const { options } = descriptors[route.key] ?? {};
                const label =
                  typeof options?.title === 'string' ? options.title : route.name;
                const focused = state.index === index;

                return (
                  <TabButton
                    key={route.key}
                    label={label}
                    icon={ICONS[route.name] ?? 'more'}
                    focused={focused}
                    glass={glass}
                    distance={Math.abs(state.index - index)}
                    onPress={() => {
                      const event = navigation.emit({
                        type: 'tabPress',
                        target: route.key,
                        canPreventDefault: true,
                      });
                      if (!focused && !event.defaultPrevented) {
                        navigation.navigate(route.name);
                      }
                    }}
                  />
                );
              }),
            )}
          </View>
        </View>
      </View>

      {/* Outside the island, so its top edge is not clipped. Last, so it
          draws over the bar rather than under it. */}
      <RecordDisc islandHeight={islandHeight} />
    </View>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Where the Record button sits among the four tabs.
 *
 * Dead centre, between Check-in and Records. It is not a tab and never becomes
 * one — it navigates out of the tab stack entirely — but it belongs in this bar
 * because starting the timer is the one action in this app that is
 * time-critical, and it must be in the SAME PLACE on every screen. It used to
 * float above the bar as a pill, where it covered whatever was underneath it:
 * on the check-in form it sat squarely over the Water row.
 */
const RECORD_SLOT = 2;

function withRecordSlot(tabs: ReactNode[]): ReactNode[] {
  return [
    ...tabs.slice(0, RECORD_SLOT),
    <RecordTabButton key="record" />,
    ...tabs.slice(RECORD_SLOT),
  ];
}

/**
 * The Record button, as a bar item.
 *
 * ── HOW AN OWNER KNOWS WHAT IT DOES ───────────────────────────────────
 *
 * Three signals, because one is not enough on a control this consequential:
 * the app's red — reserved for seizures and used nowhere else in this bar —
 * a filled record ring, and the word "Record". The label is not decoration;
 * a red dot alone is a shape people recognise only once they already know the
 * app.
 *
 * ── ONE TAP, NO CONFIRMATION ──────────────────────────────────────────
 *
 * Same rule as the Home button: a confirmation step costs seconds during an
 * emergency and buys nothing. An accidental tap is recoverable — the live
 * screen offers Discard, and a discarded record is soft-deleted, not lost.
 */
/**
 * Starting a seizure, as one handler shared by the two things that trigger it.
 *
 * The disc and the column beneath it are separate Pressables — see
 * RecordDisc — and they must not be able to disagree about what a press does.
 */
function useStartSeizure(): () => void {
  const router = useRouter();
  const dog = useActiveDog();
  const settings = useAppStore((s) => s.settings);
  const startSeizure = useActiveSeizure((s) => s.start);

  return () => {
    if (!dog) return;
    if (settings.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    startSeizure(dog.id);
    router.push('/seizure/live');
  };
}

/**
 * The middle column: the word "Record", and a full-height touch target.
 *
 * The disc itself is NOT in here. It is rendered outside the island so it can
 * stand past the bar's top edge, which the island's `overflow: hidden` would
 * otherwise slice flat. What stays is the label and the column's own touch
 * area — 1/5th of the screen width, which is the target that matters when
 * somebody is reaching for this one-handed during a seizure. Losing it and
 * leaving only the disc would have made the button smaller to the finger at
 * the same time as making it bigger to the eye.
 */
function RecordTabButton() {
  const onPress = useStartSeizure();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Record seizure"
      accessibilityHint="Starts the seizure timer immediately"
      style={styles.tab}
    >
      {/* Empty, and the same height as the other columns' glyphs: it is the
          hole the floating disc sits in, and it keeps this column's label on
          the same baseline as the other four. */}
      <View style={styles.glyphSlot} />
      <Text style={styles.recordLabel} numberOfLines={1}>
        Record
      </Text>
    </Pressable>
  );
}

/**
 * The disc, rendered over the island rather than inside it.
 *
 * ── WHY IT IS NOT A CHILD OF THE BAR ──────────────────────────────────
 *
 * The island clips to its own rounded rectangle — it has to, or the blur
 * would square off its corners — and anything inside it that reaches past the
 * top edge comes back with a flat cut across it. So the disc is a sibling of
 * the island inside the dock, positioned from the dock's bottom so that
 * RECORD_OVERHANG of it stands proud.
 *
 * The dock is `pointerEvents="box-none"`, so this stays tappable where it
 * hangs over open space above the bar.
 */
function RecordDisc({ islandHeight }: { islandHeight: number }) {
  const onPress = useStartSeizure();
  const press = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.spring(press, { toValue: 0.9, ...SPRING }).start()}
      onPressOut={() => Animated.spring(press, { toValue: 1, ...SPRING }).start()}
      accessibilityRole="button"
      accessibilityLabel="Record seizure"
      accessibilityHint="Starts the seizure timer immediately"
      style={[
        styles.recordFloat,
        // Measured from the dock's bottom edge, which is the island's bottom
        // (the dock pads upward only): lift the disc so its top clears the
        // island by exactly RECORD_OVERHANG.
        { bottom: islandHeight + RECORD_OVERHANG - RECORD_DISC },
      ]}
    >
      <Animated.View style={[styles.recordDisc, { transform: [{ scale: press }] }]}>
        {/* `md`. At `lg` inside a 46pt disc the white ring fills it corner to
            corner and the red reads as a thin outline, not a filled button. */}
        <Icon name="record" size="md" color={colors.onMedia} filled />
      </Animated.View>
    </Pressable>
  );
}

function TabButton({
  label,
  icon,
  focused,
  glass,
  distance,
  onPress,
}: {
  label: string;
  icon: IconName;
  focused: boolean;
  /** Whether the island beneath is real glass — changes how the pill is filled. */
  glass: boolean;
  /** Tab positions away from the active tab — drives the falloff. */
  distance: number;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(scaleFor(distance))).current;
  const lift = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;

  // Re-run the falloff whenever the active tab moves, so the whole row
  // resettles the way a dock does when the cursor travels across it.
  useEffect(() => {
    Animated.spring(scale, { toValue: scaleFor(distance), ...SPRING }).start();
    Animated.spring(lift, { toValue: focused ? 1 : 0, ...SPRING }).start();
  }, [distance, focused, scale, lift]);

  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const chipOpacity = lift.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.spring(press, { toValue: 0.9, ...SPRING }).start()}
      onPressOut={() => Animated.spring(press, { toValue: 1, ...SPRING }).start()}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={styles.tab}
    >
      <View style={styles.glyphSlot}>
        {/*
          The chip travels with the lift, so it stays centred under the glyph
          instead of the icon sliding out of its own highlight when a tab
          becomes active.
        */}
        <Animated.View style={[styles.chipWrap, { transform: [{ translateY }] }]}>
          {/* Active chip. On glass it has to be translucent: the opaque tint
              that works over a blur reads as a plastic chip set into the
              material, and it would block the transparency at the one spot
              the eye goes first. */}
          <Animated.View
            style={[
              styles.chip,
              glass ? styles.chipGlass : styles.chipBlur,
              { opacity: chipOpacity },
            ]}
            pointerEvents="none"
          />

          {/* Only the glyph scales. The chip holding it stays put, so the
              magnification reads as the icon growing inside its slot rather
              than the whole highlight inflating. */}
          <Animated.View
            style={{ transform: [{ scale: Animated.multiply(scale, press) }] }}
          >
            <Icon
              name={icon}
              size="lg"
              filled={focused}
              color={focused ? colors.tealDeep : CHROME_INK}
            />
          </Animated.View>
        </Animated.View>
      </View>

      <Text
        style={[styles.label, focused && styles.labelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * `paddingTop` is load-bearing, and it is a touch fix rather than a spacing
   * one.
   *
   * The dock's height comes from the island, because the Record disc is
   * absolutely positioned and contributes nothing to layout. That left the
   * overhanging top of the disc drawn OUTSIDE its parent's bounds — where it
   * renders perfectly and, on iOS, receives no touches at all, because
   * hit-testing stops at the parent's frame. The emergency button would have
   * had a dead top edge that looked completely normal.
   *
   * The padding grows the dock upward (it is anchored by `bottom`), so the
   * bounds contain the whole disc.
   */
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: DOCK_PAD,
  },
  // Outer: carries the lift that separates the island from the content behind.
  islandShadow: {
    shadowColor: '#20293A',
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  shadowOnBlur: {
    shadowOpacity: 0.18,
    shadowRadius: 20,
    // The blur path needs an opaque backing for the shadow to cast from, and
    // it is hidden behind the wash anyway.
    backgroundColor: colors.card,
  },
  shadowOnGlass: {
    // No backgroundColor on purpose — an opaque fill here is exactly what made
    // the bar solid before. iOS still casts this shadow from the layer's own
    // alpha, and glass supplies most of the separation itself.
    shadowOpacity: 0.1,
    shadowRadius: 14,
  },
  // Inner: clips the material to the rounded corners.
  island: { overflow: 'hidden' },
  islandBlur: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  glassScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  islandGlass: {
    // A brighter, cooler rim than the blur path's. Glass reads as a solid slab
    // without a specular edge catching the light along its top.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  // Blur alone reads muddy over a cream background; a wash of the card colour
  // keeps the labels legible without going fully opaque.
  islandTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  // A little inset so "Home" and "Settings" are not touching the island's
  // curved ends — at the extremes the corner radius eats into the text's box.
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  /**
   * The active chip, sized to the GLYPH and nothing else.
   *
   * It used to span the whole column (`left: 8, right: 8`) and try to contain
   * the label too. That could not work: the labels are different lengths, so
   * "Check-in" and "Settings" overflowed a box tuned for "Home" and the chip's
   * bottom edge cut straight through the word. Sizing it to the icon removes
   * the dependency on text width entirely — the longest label in any language
   * can no longer break it.
   *
   * radius.control is the same pill the Buttons use, so the chip and a Button
   * are recognisably the same shape language.
   */
  chipWrap: {
    width: GLYPH_SLOT,
    height: GLYPH_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.control,
  },
  chipBlur: { backgroundColor: colors.tealTint },
  chipGlass: {
    // Same hue as tealTint, carried as alpha so the glass still shows through,
    // with a rim to hold its shape — a low-alpha fill alone loses its edge
    // against a busy background.
    backgroundColor: 'rgba(47,126,134,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47,126,134,0.20)',
  },
  /**
   * One glyph height for every column, record included.
   *
   * Without it the record disc — taller than a 24pt icon — made its own column
   * taller than the rest, which did two visible things: it pushed "Record"
   * below the other four labels, and it grew past the island, whose
   * `overflow: hidden` sliced a flat edge off the top of the circle.
   */
  glyphSlot: { height: GLYPH_SLOT, alignItems: 'center', justifyContent: 'center' },
  /** Centred over the middle column, which is the middle of the dock. */
  recordFloat: { position: 'absolute', alignSelf: 'center' },
  recordDisc: {
    width: RECORD_DISC,
    height: RECORD_DISC,
    borderRadius: RECORD_DISC / 2,
    // A ring of the page behind it, so the disc reads as sitting ON the bar
    // rather than as a hole punched through it where the two overlap. Two
    // points, not three: on a 46pt disc a 3pt ring is 13% of the width and
    // starts reading as a deliberate outline rather than as separation.
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.red,
    /*
     * A lift, not a glow.
     *
     * This was a red shadow at 0.4 over an 8pt radius, and measured off a
     * screenshot the pink halo carried the disc's visual footprint from 42pt
     * of actual button to 61pt — half again as large as the shape itself.
     * That is most of why the button read as oversized even after it was made
     * smaller: the eye was sizing the glow, not the disc.
     *
     * Softened to a shadow that separates it from the glass and stops there.
     */
    shadowColor: colors.redDeep,
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  recordLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.redDeep,
    fontFamily: fontFamily.extrabold
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: CHROME_INK,
    fontFamily: fontFamily.semibold
  },
  labelActive: { color: colors.tealDeep, fontWeight: '700', fontFamily: fontFamily.bold },
});
