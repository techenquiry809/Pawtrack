/**
 * Navigation helpers.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────
 *
 * Every full-screen route in this app runs with `headerShown: false`, so none
 * of them has a system back button. Their only exit is a `router.back()` call
 * from a save button.
 *
 * `back()` is a no-op when there is nothing to pop. That happens whenever a
 * route is the FIRST screen of the session — a deep link, a notification tap,
 * or `pawtrack://emergency-plan` typed anywhere. The save succeeds, the
 * button stops spinning, and the screen just sits there: no header, no tab bar,
 * no way out but force-quitting.
 *
 * Caught by mounting every route with no history and watching the log say
 * "The action 'GO_BACK' was not handled by any navigator."
 *
 * This is the same class of dead end as the old seizure flow, so it gets the
 * same treatment: always leave somewhere to go.
 */

import type { useRouter } from 'expo-router';

/** expo-router does not export its Router type by name; derive it. */
type Router = ReturnType<typeof useRouter>;

/**
 * Pops the stack, or falls back to the main tabs when there is nothing to pop.
 *
 * Use this instead of `router.back()` on any screen that has no header.
 */
export function goBackOrHome(router: Router): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)');
}
