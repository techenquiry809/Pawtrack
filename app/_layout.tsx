/**
 * Root layout.
 *
 * Runs once at launch and is responsible for everything that must be ready
 * before any screen renders: opening the database, running migrations, loading
 * settings + the active dog, and restoring the session.
 *
 * Navigation shape:
 *   (auth)              -> sign in, sign up, and the three code/reset steps,
 *                          no tab bar
 *   (tabs)              -> the five-tab main app
 *   seizure/live        -> full-screen takeover, no tab bar (emergency flow)
 *   seizure/post
 *   seizure/recovery
 *   onboarding          -> shown only when no dog exists yet
 *   devices             -> the device registry
 *   account             -> sign out, remove data, delete account, app lock
 *
 * The seizure screens sit OUTSIDE the tab group on purpose: during a seizure
 * the owner must not be able to wander off into Analytics by mistyping a tap.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { getDb } from '@/db/client';
import { useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { Body, Button, Muted } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';
import * as Notifications from 'expo-notifications';
import { rescheduleIfTimezoneChanged } from '@/services/medicationReminders';
import { startAuthAutoRefresh } from '@/services/supabase';
import { startSyncTriggers, syncNow } from '@/services/sync/worker';
import { isAppLockEnabled, promptUnlock } from '@/services/appLock';
import { useConsentStore } from '@/store/consentStore';
import { launchIntent } from '@/services/launchIntent';

/**
 * Every path in the (auth) group.
 *
 * The gate has to recognise all of them, in both directions: a signed-out
 * session on a path missing from this list gets bounced back to /sign-in —
 * which would make /verify and /new-password unreachable — and a signed-in one
 * has to be let out of whichever of them it is standing on.
 *
 * Keep in step with app/(auth)/_layout.tsx.
 */
const AUTH_PATHS = [
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/verify',
  '/new-password',
] as const;

const inAuthFlow = (pathname: string): boolean =>
  AUTH_PATHS.some((path) => pathname.startsWith(path));

/**
 * What the window is covered by while the app boots.
 *
 *   'deciding'  we do not yet know what opened us. A plain background, the
 *               same colour as the native launch screen, so the gap is
 *               invisible rather than a flash of half-loaded UI.
 *   'playing'   an ordinary launch: the branded intro.
 *   'done'      nothing on top — either the clip finished, or this was an
 *               emergency launch and there was never a clip.
 *
 * The middle state is the whole reason this is three values and not a boolean.
 * Mounting the video first and tearing it down on learning the launch was an
 * emergency would still have decoded and shown a frame or two of it.
 */
type IntroPhase = 'deciding' | 'playing' | 'done';

export default function RootLayout() {
  /*
   * Nunito is loaded WITHOUT gating the first paint.
   *
   * The tradeoff is deliberate: the app opens straight into the system face
   * and swaps to Nunito once the faces land, so a cold start shows a brief
   * flash of SF Pro rather than a longer splash. Nothing is blocked on this —
   * `useFonts` is read for its side effect and the tree renders either way.
   *
   * Faces are cached after the first launch, so the swap is only ever visible
   * on a genuinely cold first run.
   */
  useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  const hydrate = useAppStore((s) => s.hydrate);
  const dogs = useAppStore((s) => s.dogs);
  const appHydrated = useAppStore((s) => s.hydrated);

  /**
   * Whether the Terms and Privacy Policy have been accepted at their CURRENT
   * versions. In a store rather than local state because the consent screen is
   * what changes it — see src/store/consentStore.ts.
   */
  const consented = useConsentStore((s) => s.granted);
  const consentLoaded = useConsentStore((s) => s.loaded);
  const consentUserId = useConsentStore((s) => s.userId);
  const loadConsent = useConsentStore((s) => s.load);

  const authStatus = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  /**
   * True while a verification flow owns the navigation — see authStore.
   * `verifyOtp` mints a real session for both signup confirmation and password
   * reset, and without this the gate would act on it mid-flow.
   */
  const handoff = useAuthStore((s) => s.handoff);
  const initializeAuth = useAuthStore((s) => s.initialize);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // Gates the video intro, independently of `ready`: startup (DB, auth,
  // hydration) runs in the background under it, so the two don't add up —
  // the app is simply ready to show whichever screen is correct the moment
  // the clip ends.
  const [introPhase, setIntroPhase] = useState<IntroPhase>('deciding');
  /**
   * Whether the first sync after signing in has finished — succeeded, failed
   * or found nothing.
   *
   * The route gate waits for it before deciding that an account has no dog.
   * Without it the decision is made against whatever SQLite held a
   * millisecond after sign-in, which on a NEW device is nothing at all: the
   * owner was sent to onboarding and asked to create a dog the account
   * already has. Reset per account, alongside `routedFor`.
   *
   * Lives in the app store rather than here because app/(tabs)/_layout.tsx has
   * to make the same distinction and could not see it from local state — see
   * `initialSyncSettled` there for what that cost.
   */
  const firstSyncSettled = useAppStore((s) => s.initialSyncSettled);
  const setFirstSyncSettled = useAppStore((s) => s.setInitialSyncSettled);

  const pathname = usePathname();
  const routedFor = useRef<string>('');

  /**
   * Decide what covers the window BEFORE anything is mounted over it.
   *
   * A widget tap goes straight to the seizure route with no intro: the clip is
   * three seconds, and on this screen three seconds is a measurement someone
   * loses. See src/services/launchIntent.ts.
   */
  useEffect(() => {
    let cancelled = false;
    void launchIntent().then((intent) => {
      if (cancelled) return;
      setIntroPhase(intent === 'emergency' ? 'done' : 'playing');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let teardownAuth: (() => void) | undefined;

    (async () => {
      try {
        // Opening the DB also runs any pending migrations. The app lock is a
        // keystore read that needs neither the database nor the session, so it
        // runs alongside rather than after — on the emergency path every
        // avoidable round trip is elapsed seizure time.
        const [, lockEnabled] = await Promise.all([getDb(), isAppLockEnabled()]);

        // Checked before anything renders. Doing it later would let the
        // records paint for a frame behind the prompt.
        if (lockEnabled && !cancelled) setLocked(true);

        // Auth first: every repository read is fenced by the active user id,
        // so hydrating the dog list before the session is restored would
        // populate the store with the wrong owner's rows — or none.
        teardownAuth = await initializeAuth();
        await hydrate();

        if (!cancelled) setReady(true);
      } catch (e) {
        console.error('[startup] failed', e);
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Could not open the local database.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      teardownAuth?.();
    };
  }, [hydrate, initializeAuth]);

  /**
   * Medication reminders are scheduled at a LOCAL wall-clock time. When the
   * owner travels, the device's offset moves and every scheduled notification
   * has to be rebuilt or the 8am dose reminder starts arriving at 3am.
   *
   * Checked on foreground rather than on a timer, because a timezone only
   * changes while the phone is in someone's pocket on a plane. It compares the
   * offset first and does nothing when it has not moved, so an ordinary
   * foreground costs one subtraction.
   *
   * Deliberately NOT in the startup gate above: this must never delay first
   * paint, and it is a no-op until notification permission has been granted.
   */
  useEffect(() => {
    if (!ready) return;
    void rescheduleIfTimezoneChanged();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void rescheduleIfTimezoneChanged();
    });
    return () => sub.remove();
  }, [ready]);

  /**
   * Tapping a medication reminder opens the list that records the dose.
   *
   * The banner says "open PawTrack to record it", so the tap has to land
   * somewhere that can. Without this it only restores whichever screen the app
   * was last on — the app ignoring its own instruction, and the owner hunting
   * for the list while holding a tablet.
   *
   * `getLastNotificationResponseAsync` covers the cold start: when the tap is
   * what launched the process, the event has already been delivered by the
   * time this listener attaches, so it has to be asked for rather than waited
   * on. The route gate still applies — a tap while signed out lands on
   * sign-in, which is correct.
   */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const open = (response: Notifications.NotificationResponse) => {
      const { kind } = response.notification.request.content.data as {
        kind?: string;
      };
      if (kind !== 'medication-reminder') return;
      router.push('/(tabs)/checkin');
    };

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!cancelled && response) open(response);
      })
      .catch((e) => console.warn('[reminders] launch tap', e));

    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [ready]);

  /** Token refresh and the sync triggers, both paused while backgrounded. */
  useEffect(() => {
    if (!ready) return;
    const stopRefresh = startAuthAutoRefresh();
    const stopSync = startSyncTriggers();
    return () => {
      stopRefresh();
      stopSync();
    };
  }, [ready]);

  /**
   * Load this user's consent whenever the signed-in user changes.
   *
   * Consent belongs to the ACCOUNT now, so it cannot be read at startup before
   * the session is known — there is nobody to read it for. Keyed on the user
   * id rather than run once, so signing out and in as someone else asks the
   * new person rather than inheriting the previous answer.
   *
   * Deliberately NOT gated on `ready`. It needs the session and the database,
   * both of which exist by the time `userId` is set — `ready` additionally
   * waits for `hydrate()`, and queueing behind that put a second round trip in
   * front of the widget's seizure route, which cannot act until consent is in.
   */
  useEffect(() => {
    if (!userId) return;
    if (consentUserId === userId && consentLoaded) return;
    void loadConsent(userId).catch((e) =>
      console.warn('[startup] could not read consent', e),
    );
  }, [userId, consentUserId, consentLoaded, loadConsent]);

  /**
   * Forget which redirects have already been issued when the account changes.
   *
   * `routedFor` fires each soft target at most once per session, which is what
   * stops the gate fighting the owner's own navigation. It is scoped to a
   * SESSION, though, and one phone can see several: sign out of an account
   * that had a dog and into one that does not, and '/onboarding' would already
   * be marked as issued — so the new owner would never be sent there and would
   * land on an empty Home with no way to have been asked for a dog.
   */
  useEffect(() => {
    routedFor.current = '';
    setFirstSyncSettled(false);
  }, [userId, setFirstSyncSettled]);

  /**
   * A full pull on sign-in, once the session is actually established.
   *
   * Held until consent is in. Syncing earlier would pull the account's records
   * onto a phone whose owner has not yet accepted the terms under which they
   * are held — and, on a re-consent, would carry on doing so while they are
   * being asked to agree again.
   */
  useEffect(() => {
    if (!ready || authStatus !== 'signed-in') return;
    if (!consentLoaded || !consented) return;

    let cancelled = false;
    /*
     * `finally`, not `then`. A failed sync must settle this too — someone
     * signing up on a plane still has to reach onboarding, and leaving the
     * flag down would hold them on a blank screen until they found signal.
     */
    void syncNow('sign-in').finally(() => {
      if (!cancelled) setFirstSyncSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, authStatus, consentLoaded, consented, setFirstSyncSettled]);

  /**
   * The route gate.
   *
   * Runs only once everything it depends on has settled. Redirecting while
   * `authStatus` is still 'loading' is what flashes the onboarding screen at
   * returning users: the dog list has not been fenced to an owner yet, so it
   * momentarily looks empty and the gate concludes there is no dog.
   */
  useEffect(() => {
    if (!ready || !appHydrated || locked) return;
    if (authStatus === 'loading') return;
    /*
     * A verification flow is mid-step and is doing its own navigating.
     *
     * Confirming a signup code and verifying a reset code both END in a real
     * session, and both are meant to finish at the sign-in screen rather than
     * inside the app. Acting on that session the moment it appears would take
     * the owner to /consent or the tabs from underneath a screen that has not
     * finished its job. The flow lowers this itself, on success and on
     * failure alike.
     */
    if (handoff) return;

    /*
     * ── THE ORDER, AND WHY IT IS THIS ONE ─────────────────────────────
     *
     *   1. signed out            -> sign in / create an account
     *   2. signed in, no consent -> agree to the Terms and Privacy Policy
     *   3. consented, no dog     -> onboarding
     *
     * Each step collects something the next one depends on. An account exists
     * before consent because consent is now recorded AGAINST that account
     * (services/consent.ts) — there is nowhere to put it beforehand. Consent
     * comes before onboarding because onboarding immediately asks for a dog's
     * name, age and diagnosis, and collecting a medical record before
     * explaining the terms it is held under is the wrong way round.
     *
     * ── THE FIRST TWO ARE HARD GATES AND BYPASS `routedFor` ───────────
     *
     * That guard fires each target at most once per session, which is right
     * for a suggestion and wrong for a requirement. It was observed sending a
     * new install to /consent, something else navigating on to /onboarding a
     * moment later, and the guard then declining to correct it — leaving an
     * un-agreed owner typing their dog's name into the app. A gate that yields
     * the first time anything else navigates is not a gate.
     *
     * So both re-assert on every run and are suppressed only by already being
     * where they would send you.
     */

    // 1. No session: nothing else in the app is reachable.
    if (authStatus === 'signed-out') {
      if (inAuthFlow(pathname)) return;
      router.replace('/(auth)/sign-in');
      return;
    }

    // 2. Signed in, but the agreement is missing or out of date.
    //    `consentLoaded` matters: until the answer is in, we know nothing, and
    //    routing on the default would flash this screen at someone who agreed
    //    long ago. /legal is allowed through so reading the documents from the
    //    gate does not bounce the owner straight back out of them.
    if (consentLoaded && !consented) {
      if (pathname.startsWith('/consent') || pathname.startsWith('/legal')) return;
      router.replace('/consent');
      return;
    }
    if (!consentLoaded) return;

    // 3. Signed in and agreed — but still standing somewhere in (auth).
    //
    //    Nothing in that group is reachable in this state, and no screen in it
    //    navigates out on its own: the session arrives through the store, so a
    //    successful sign-in used to leave the owner looking at the very form
    //    they had just submitted, with no error and no movement. That reads as
    //    a sign-in that failed. Only owners who needed /consent or /onboarding
    //    afterwards ever got out, which is why it survived signup testing and
    //    only bit returning accounts.
    //
    //    Reached only when `handoff` is down, so it cannot fire on the session
    //    that /verify is briefly holding mid-flow.
    //
    //    Hard, like the two gates above, and deliberately not subject to
    //    `routedFor` — leaving the auth group is a requirement, not a
    //    suggestion, and must still work on a second sign-in within one
    //    launch.
    if (inAuthFlow(pathname)) {
      // An empty dog list is only evidence of a dog-less account once the
      // first sync has settled — see `firstSyncSettled`. Until then send them
      // to the tabs, which is right either way: an account WITH a dog lands
      // where it should, and one without is moved on by the soft redirect
      // below the moment the sync comes back empty.
      const noDog = dogs.length === 0 && firstSyncSettled;
      router.replace(noDog ? '/onboarding' : '/(tabs)');
      return;
    }

    // 4. Everything required is in place; the ordinary soft redirect.
    //
    //    Held until the first sync settles, for the same reason as above: on
    //    a second device the dog arrives from the server a moment after
    //    sign-in, and routing on the gap asks the owner to re-create it.
    const target = dogs.length === 0 && firstSyncSettled ? '/onboarding' : null;

    if (!target) return;
    // Guard against re-issuing the same redirect on every store update, which
    // would fight the user's own navigation.
    if (routedFor.current === target) return;
    if (pathname.startsWith(target)) return;

    routedFor.current = target;
    router.replace(target);
  }, [
    ready, appHydrated, locked, authStatus, handoff,
    consented, consentLoaded, dogs.length, firstSyncSettled, pathname,
  ]);

  const unlock = useCallback(async () => {
    if (await promptUnlock()) setLocked(false);
  }, []);

  // Prompt as soon as the lock screen mounts, so the common case is one glance
  // at the phone rather than a tap and then a glance.
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  let body: ReactNode;

  if (error) {
    body = (
      <View style={styles.centre}>
        <Body>PawTrack could not start.</Body>
        <Muted style={styles.errorDetail}>{error}</Muted>
        <Muted style={styles.errorDetail}>
          Your saved records have not been deleted. Reopening the app usually
          resolves this. If it keeps happening, reinstalling will lose local
          data, so export a backup from another device first if you can.
        </Muted>
      </View>
    );
  } else if (locked) {
    body = (
      <View style={styles.centre}>
        <Body>PawTrack is locked</Body>
        <Muted style={styles.errorDetail}>
          Unlock with Face ID, Touch ID or your passcode.
        </Muted>
        <Button label="Unlock" onPress={() => void unlock()} />
      </View>
    );
  } else if (!ready) {
    // Deliberately plain. A spinner-heavy state on a seizure app is the wrong
    // first impression — this only shows at all if startup outlasts the video
    // intro below, which is normally sub-second.
    body = <View style={styles.centre} />;
  } else {
    body = (
      <>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" options={{ gestureEnabled: false }} />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="devices" />
          <Stack.Screen name="account" />
          <Stack.Screen name="legal" />
          <Stack.Screen
            name="consent"
            options={{
              // No swipe-back. There is nothing behind this screen to go back
              // to, and an edge swipe that appeared to dismiss it would leave
              // the owner in the app without having agreed to anything.
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="checkin-flow"
            options={{
              // No swipe-back, for the same reason the seizure screen has none:
              // an edge swipe would leave the flow WITHOUT going through the
              // unsaved-changes prompt, silently discarding four steps of
              // answers. The close button is the only way out, and it asks.
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="seizure"
            options={{
              // No swipe-back: an accidental edge swipe must not dismiss a
              // running seizure timer.
              gestureEnabled: false,
              animation: 'fade',
            }}
          />
        </Stack>
      </>
    );
  }

  return (
    <SafeAreaProvider>
      {/*
        The whole navigation tree, behind one boundary.

        INSIDE SafeAreaProvider so the fallback can use insets and is painted
        in the same frame as everything else, and wrapping `body` rather than
        being wrapped by it so that a crash in any screen still leaves the
        provider mounted.

        This is the backstop, not the whole answer: recovering here remounts
        the navigator, which is a blunt instrument. Screens where a crash costs
        something specific export their own `ErrorBoundary` and handle it more
        precisely — see app/seizure/live.tsx.
      */}
      <AppErrorBoundary>{body}</AppErrorBoundary>
      {/* On top of everything above, until the clip finishes — startup
          (DB, auth, hydration, the route redirect) runs underneath it, not
          after it.

          A widget launch gets neither the clip nor the cover: `introPhase` is
          already 'done' by the time it settles, so the seizure route is on
          screen as soon as it can render. See IntroPhase above. */}
      {introPhase === 'deciding' && (
        // pointerEvents="none", matching AnimatedSplash: this is paint, not a
        // modal, and a tap that lands in the gap should reach what is under it.
        <View style={styles.introCover} pointerEvents="none" />
      )}
      {introPhase === 'playing' && (
        /*
          `ready || error` — startup finishing and startup FAILING are both
          reasons to lift the intro. Holding the clip over the "PawTrack could
          not start" screen would hide the only thing that screen exists to
          say, for as long as the ceiling allows.
        */
        <AnimatedSplash
          canFinish={ready || error !== null}
          onFinish={() => setIntroPhase('done')}
        />
      )}
    </SafeAreaProvider>
  );
}


const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 24,
    gap: spacing.sm,
  },
  errorDetail: { textAlign: 'center' },
  /**
   * The one-or-two frames between JS booting and knowing what opened us.
   *
   * Deliberately the same flat colour as the native launch screen, so the
   * handover is not visible at all — the alternative is the first frame of
   * whichever screen the router picked, briefly, before the intro covers it
   * again.
   */
  introCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
});
