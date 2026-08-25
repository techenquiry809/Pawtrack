/**
 * Drives the live seizure timer UI.
 *
 * Responsibilities:
 *   - Re-render once per second (the interval is a render trigger only; the
 *     elapsed value itself is always recomputed from the absolute start time).
 *   - Recompute immediately when the app returns to the foreground, so a
 *     backgrounded phone shows the true elapsed time the instant it wakes.
 *   - Fire the warning and critical threshold alerts exactly once each.
 *   - Keep the screen awake — an owner watching their dog seize should not
 *     have to tap the screen to keep the timer visible.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { elapsedSeconds, useActiveSeizure } from '@/store/activeSeizureStore';

export type ThresholdLevel = 'none' | 'warn' | 'critical';

/** Shared empty array — see the selector note in useSeizureTimer. */
const NO_THRESHOLDS: readonly number[] = [];

type Options = {
  startedAt: number;
  warnMinutes: number;
  criticalMinutes: number;
  hapticsEnabled: boolean;
};

export function useSeizureTimer({
  startedAt,
  warnMinutes,
  criticalMinutes,
  hapticsEnabled,
}: Options): { elapsed: number; level: ThresholdLevel } {
  // Prevents the phone from sleeping while a seizure is being timed.
  useKeepAwake();

  const [elapsed, setElapsed] = useState(() => elapsedSeconds(startedAt));
  // NOTE: this selector must return a value that is reference-stable between
  // store updates. Zustand v5 calls it on every render and compares with
  // Object.is, so `s.draft?.firedThresholds ?? []` would hand React a brand
  // new array each time and spin into "Maximum update depth exceeded" the
  // moment the draft is cleared. Hence the module-level constant.
  const firedThresholds = useActiveSeizure(
    (s) => s.draft?.firedThresholds ?? NO_THRESHOLDS,
  );
  const markThresholdFired = useActiveSeizure((s) => s.markThresholdFired);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const tick = () => setElapsed(elapsedSeconds(startedAt));
    tick();
    const interval = setInterval(tick, 1000);

    // When iOS/Android suspends the JS thread the interval stops. On resume we
    // recompute straight away rather than waiting up to a second.
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        tick();
      }
      appState.current = next;
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [startedAt]);

  const warnSec = warnMinutes * 60;
  const criticalSec = criticalMinutes * 60;

  let level: ThresholdLevel = 'none';
  if (elapsed >= criticalSec) level = 'critical';
  else if (elapsed >= warnSec) level = 'warn';

  // Fire each threshold's haptic exactly once.
  useEffect(() => {
    if (level === 'warn' && !firedThresholds.includes(warnMinutes)) {
      markThresholdFired(warnMinutes);
      if (hapticsEnabled) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    }
    if (level === 'critical' && !firedThresholds.includes(criticalMinutes)) {
      markThresholdFired(criticalMinutes);
      if (hapticsEnabled) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  }, [
    level, warnMinutes, criticalMinutes, firedThresholds,
    markThresholdFired, hapticsEnabled,
  ]);

  return { elapsed, level };
}
