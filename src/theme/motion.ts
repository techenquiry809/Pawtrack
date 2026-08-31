/**
 * Whether this device wants animation at all.
 *
 * ── WHY THIS IS A SUBSCRIPTION AND NOT A CONSTANT ─────────────────────
 *
 * Reduce Motion is a system accessibility switch the user can flip WHILE the
 * app is open, so it has to be subscribed to rather than sampled once at
 * startup. Same reasoning as useGlassSupport() in src/theme/glass.ts, and the
 * same reason it matters: someone who has turned it on has told the OS that
 * movement is a problem for them — vestibular disorders, motion sickness,
 * migraine triggers — and decoration is the first thing that should yield.
 *
 * Honouring it is not optional politeness on this app in particular. The
 * people using it are already managing a neurological condition and are often
 * opening it at 3am after a bad night. A looping animation they cannot turn
 * off is a small cruelty.
 *
 * ── WHAT CALLERS SHOULD DO WITH IT ────────────────────────────────────
 *
 * Render the FINAL state, not nothing. An animation that exists to reveal
 * content must still reveal it — dropping the element entirely because motion
 * is off would hide information from exactly the people who asked for less
 * movement, which is the opposite of the intent.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (!cancelled) setReduced(on);
      })
      // Never let an accessibility probe break a screen. Defaulting to "motion
      // is fine" on failure matches what the platform would do anyway.
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    );

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * Durations, in one place so timings stay coherent across screens.
 *
 * The upper bound is deliberate: anything past ~400ms on a control the owner
 * is waiting on reads as lag rather than polish, and this app has exactly one
 * screen where a delay is unacceptable.
 */
export const duration = {
  /** Press feedback. Matches LiquidGlassButton. */
  press: 150,
  /** Content entering — a card, a section. */
  enter: 320,
  /** Ambient, looping decoration. Slow on purpose so it never pulls focus. */
  ambient: 2400,
} as const;
