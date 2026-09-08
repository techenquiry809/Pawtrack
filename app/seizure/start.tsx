/**
 * The home-screen widget's landing route: `pawtrack://seizure/start`.
 *
 * ── WHY A ROUTE AND NOT A LINK STRAIGHT TO /seizure/live ──────────────
 *
 * Because the live screen does not start anything. Every existing entry point
 * — the Home record card, the record tab — does two things in this order:
 *
 *     startSeizure(dog.id)          // marks the clock, inserts the row
 *     router.push('/seizure/live')  // shows the timer
 *
 * A widget can only hand the app a URL, so deep-linking to /seizure/live would
 * open the timer with no draft behind it: the elapsed count would run from the
 * moment the screen mounted, every observation chip would write into nothing,
 * and there would be no row in SQLite to survive a force-quit. This route is
 * the missing first half — it performs the same two steps the buttons do and
 * then gets out of the way.
 *
 * ── THIS SCREEN IS NEVER THE DESTINATION ──────────────────────────────
 *
 * It replaces itself the moment it can, so the back stack looks exactly as it
 * would have if the owner had tapped Record inside the app. `replace`, not
 * `push`, for that reason.
 *
 * ── WHAT IT WAITS FOR, AND WHY IT CANNOT JUST RUN ─────────────────────
 *
 * A widget tap is usually a COLD START. The store is empty for the first few
 * hundred milliseconds, so `dog` is null not because there is no dog but
 * because nothing has been read yet — and starting a seizure against a null
 * dog, or bouncing to onboarding, would both be wrong. So it waits for
 * `hydrated` and acts once.
 *
 * It also waits for the SESSION, and that is not belt-and-braces — it is a
 * bug this screen shipped with.
 *
 * ── THE PHANTOM SEIZURE ───────────────────────────────────────────────
 *
 * "The root gate will have moved them on already" was wrong. A phone that
 * used the app before accounts existed still holds rows with a NULL owner,
 * and `ownerScope()` resolves to `user_id IS NULL` while signed out — so the
 * dog list is POPULATED for a signed-out session, `dog` is not null, and this
 * effect happily marked a clock and inserted a seizure a beat before the gate
 * pulled the owner to /sign-in. The row stayed behind, in_progress, and the
 * next launch asked them about a seizure that never happened.
 *
 * Observed exactly once, in testing, which is the only reason it is a comment
 * and not an incident: a widget tap on a signed-out phone left an unfinished
 * seizure on a real dog's record. A false entry in a medical history is worse
 * than a widget that does nothing, so the timer now starts only when the app
 * is somewhere the owner can actually finish it — signed in, and past the
 * agreement gate.
 *
 * ── THE SECONDS THE COLD START COSTS ──────────────────────────────────
 *
 * Launch to first render is real time that the seizure has already been
 * running for, and it is NOT recoverable from the widget: both platforms bake
 * the tap URL at render time, not tap time, so a timestamp in the URL would be
 * whatever the last widget refresh happened to be — worse than no timestamp.
 * The live screen's "adjust start time" control is the honest fix, and it
 * already exists.
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Muted } from '@/components/ui';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { useAuthStore } from '@/store/authStore';
import { useConsentStore } from '@/store/consentStore';
import { colors, spacing } from '@/theme/tokens';

/** Where an already-running seizure should resume, by the stage it is in. */
const STAGE_ROUTE = {
  live: '/seizure/live',
  post: '/seizure/post',
  recovery: '/seizure/recovery',
} as const;

export default function WidgetSeizureStartScreen() {
  const router = useRouter();
  const hydrated = useAppStore((s) => s.hydrated);
  const settings = useAppStore((s) => s.settings);
  const dog = useActiveDog();

  /*
   * The same three conditions the root gate checks before it lets anything in
   * the app render. Read here as well, rather than trusted to have already
   * happened — see the note on the phantom seizure above.
   */
  const authStatus = useAuthStore((s) => s.status);
  const consentLoaded = useConsentStore((s) => s.loaded);
  const consented = useConsentStore((s) => s.granted);

  const draft = useActiveSeizure((s) => s.draft);
  const startSeizure = useActiveSeizure((s) => s.start);

  /*
   * Fires once per mount. The effect re-runs as the stores settle, and
   * without this a second pass could call `start` again — which resets the
   * mark, and with it the elapsed time of a seizure already being timed.
   */
  const acted = useRef(false);

  useEffect(() => {
    if (acted.current) return;

    /*
     * A seizure is ALREADY running — the app was open in the flow and the
     * widget was tapped anyway, or two taps landed together. Resume it rather
     * than start a second one: restarting would silently discard the elapsed
     * time of the event actually in progress, which is the one number this
     * screen exists to protect.
     *
     * Checked before `hydrated` because a live draft is proof enough that
     * there is a dog; waiting would only delay getting back to the timer.
     */
    if (draft) {
      acted.current = true;
      router.replace(STAGE_ROUTE[draft.stage]);
      return;
    }

    // Nothing has been read yet. `dog` being null here means "unknown", not
    // "none" — see the note at the top.
    if (!hydrated) return;

    /*
     * Not somewhere a seizure can be recorded. Stand down and let the gate do
     * its job: it is already sending this owner to sign-in or to the
     * agreement, and starting a timer they are about to be navigated away
     * from writes a row nobody will ever finish.
     *
     * Note the `consentLoaded` check is separate from `consented`: until the
     * answer is in we know nothing, and acting on the default would start a
     * timer for someone who agreed a year ago.
     */
    if (authStatus !== 'signed-in') return;
    if (!consentLoaded || !consented) return;

    /*
     * Hydrated and there is genuinely no dog. Nothing to start a seizure
     * against, and the root gate is already sending this owner to onboarding,
     * so this screen stands down rather than navigating on top of it.
     */
    if (!dog) return;

    acted.current = true;
    if (settings.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    startSeizure(dog.id);
    router.replace('/seizure/live');
  }, [
    draft, hydrated, dog, authStatus, consentLoaded, consented,
    settings.hapticsEnabled, startSeizure, router,
  ]);

  /*
   * Deliberately almost nothing. This is on screen for a frame or two on a
   * warm start, and on a cold one it sits behind the launch splash. A spinner
   * would be a moving object between the owner and the timer they came for.
   */
  return (
    <View style={styles.screen}>
      <Muted>Starting the timer…</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
});
