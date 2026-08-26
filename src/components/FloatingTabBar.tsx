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

import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { Icon, type IconName } from '@/components/Icon';
import { colors, fontSize } from '@/theme/tokens';
import { useChromeMetrics } from '@/theme/chrome';
import { useGlassSupport } from '@/theme/glass';

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

/** The reference dock's spring, as Animated.spring parameters. */
const SPRING = { mass: 0.1, stiffness: 150, damping: 12, useNativeDriver: true };

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
  more: 'more',
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
            {state.routes.map((route, index) => {
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
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

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
  const pillOpacity = lift.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() =>
        Animated.spring(press, { toValue: 0.9, ...SPRING }).start()
      }
      onPressOut={() => Animated.spring(press, { toValue: 1, ...SPRING }).start()}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={styles.tab}
    >
      {/* Active pill sits behind the content and fades with the same spring.
          On glass it has to be translucent: the opaque tint that works over a
          blur reads as a plastic chip set into the material, and it would
          block the transparency at the one spot the eye goes first. */}
      <Animated.View
        style={[styles.pill, glass ? styles.pillGlass : styles.pillBlur, { opacity: pillOpacity }]}
        pointerEvents="none"
      />

      <Animated.View
        style={{ transform: [{ scale: Animated.multiply(scale, press) }, { translateY }] }}
      >
        <Icon
          name={icon}
          size="lg"
          filled={focused}
          color={focused ? colors.tealDeep : CHROME_INK}
        />
      </Animated.View>

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
  dock: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
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
  row: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  pill: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    left: 8,
    right: 8,
    borderRadius: 22,
  },
  pillBlur: { backgroundColor: colors.tealTint },
  pillGlass: {
    // Same hue as tealTint, carried as alpha so the glass still shows through,
    // with a rim to hold its shape — a low-alpha fill alone loses its edge
    // against a busy background.
    backgroundColor: 'rgba(47,126,134,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47,126,134,0.20)',
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: CHROME_INK,
  },
  labelActive: { color: colors.tealDeep, fontWeight: '700' },
});
