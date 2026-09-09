/**
 * Whether this device can render real Liquid Glass, and whether it should.
 *
 * ── WHY A HOOK AND NOT A CONSTANT ─────────────────────────────────────
 *
 * Two separate questions, and only one of them is answerable at import time.
 *
 *   CAN it?     `isLiquidGlassAvailable()` — iOS 26+, built against the iOS 26
 *               SDK, without the `UIDesignRequiresCompatibility` opt-out.
 *               Fixed for the life of the process, so it is read once.
 *
 *   SHOULD it?  Reduce Transparency. This is a system accessibility switch the
 *               user can flip WHILE the app is open, and it exists precisely
 *               because translucency makes text hard to read for some people.
 *               It has to be subscribed to, not sampled once at startup.
 *
 * Honouring the second is not decoration. Someone who has turned Reduce
 * Transparency on has told the OS that see-through chrome is a problem for
 * them, and a nav bar is the one piece of chrome they cannot avoid.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';

/** Fixed for the process — the binary either has the API or it does not. */
const AVAILABLE = Platform.OS === 'ios' && isLiquidGlassAvailable();

/**
 * Has the owner asked the OS for less see-through chrome?
 *
 * ── WHY THIS IS SEPARATE FROM useGlassSupport ─────────────────────────
 *
 * That hook answers "should this be Liquid Glass", and it folds this setting
 * into a single boolean — which is right for the tab bar, whose only two
 * states are real glass and a blur. It is NOT enough for a surface with three
 * states.
 *
 * A calendar sheet has three: Liquid Glass, a blur, and fully OPAQUE. Reduce
 * Transparency has to pick the third, not the second, because a blur is still
 * translucent and the setting exists for people who find translucency hard to
 * read. Folded into useGlassSupport, "reduce transparency" would have quietly
 * meant "downgrade to a different translucent material" — which answers the
 * request by ignoring it, behind a month of small date numbers.
 *
 * Subscribed on iOS at every version, not only iOS 26: someone on iOS 18 gets
 * the BlurView path and needs the opt-out just as much. The API is iOS-only,
 * so Android short-circuits to false rather than probing.
 */
export function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    let cancelled = false;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((on) => {
        if (!cancelled) setReduceTransparency(on);
      })
      // Never let an accessibility probe break a screen — the same rule, and
      // the same one-line catch, as useReducedMotion in ./motion.ts. Without
      // it a platform that does not implement the probe raises an unhandled
      // rejection instead of quietly falling back to "transparency is fine".
      .catch(() => {});

    // Fires when the setting is toggled while the app is running.
    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduceTransparency;
}

/**
 * The capability half of the question, with no hook attached.
 *
 * Exported so a component that ALREADY needs `useReduceTransparency` — a
 * surface with three materials rather than two, like GlassBackdrop — can derive
 * "is this glass?" from the one subscription it is already holding, instead of
 * calling useGlassSupport as well and paying for a second identical
 * AccessibilityInfo listener and a second piece of state describing the same
 * system setting.
 */
export const GLASS_CAPABLE = AVAILABLE;

export function useGlassSupport(): boolean {
  /*
   * CALLED UNCONDITIONALLY, AND THAT IS THE POINT.
   *
   * This was `return AVAILABLE && !useReduceTransparency();` — which reads
   * fine and is a rules-of-hooks violation: `&&` short-circuits, so on Android
   * and on iOS before 26 the hook was never called at all. It happens to be
   * harmless today only because AVAILABLE is a module constant evaluated once,
   * so the call order is stable for the life of the process.
   *
   * That is a trap, not a design. The day anything makes the capability
   * dynamic, the hook count changes between renders and React throws — from a
   * line whose bug is invisible unless you are thinking about evaluation order.
   */
  const reduceTransparency = useReduceTransparency();
  return AVAILABLE && !reduceTransparency;
}

/**
 * How expo-blur should actually blur on Android.
 *
 * ── THIS IS NOT A TUNING KNOB. WITHOUT IT THERE IS NO BLUR ────────────
 *
 * `blurMethod` defaults to `'none'` on Android, and 'none' means exactly that:
 * BlurView renders as a flat translucent overlay and samples nothing. Every
 * Android build of this app that has ever drawn a "blurred" tab bar has in
 * fact been drawing a white wash — the material read as acceptable only
 * because the wash over it was doing all the work.
 *
 * ── WHY THE SDK-31 VARIANT AND NOT THE PLAIN ONE ──────────────────────
 *
 * `'dimezisBlurView'` blurs by rendering the view hierarchy underneath into a
 * bitmap and blurring that, every frame, on the CPU. Under a scrolling list —
 * which is exactly what is under the tab bar — that is the expensive path, and
 * it is a known source of jank.
 *
 * `'dimezisBlurViewSdk31Plus'` uses Android 12's RenderEffect instead: the same
 * blur, done by the GPU as part of compositing. This project's minSdk is 24, so
 * devices on 24-30 get no blur and fall back to the veil alone — the same thing
 * they get today, and a legible one. Nobody's phone gets slower; phones on 12+
 * get the real material.
 *
 * iOS ignores this prop entirely; its blur is native and always on.
 */
export const ANDROID_BLUR_METHOD = 'dimezisBlurViewSdk31Plus' as const;
