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

export function useGlassSupport(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    if (!AVAILABLE) return;

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

  return AVAILABLE && !reduceTransparency;
}
