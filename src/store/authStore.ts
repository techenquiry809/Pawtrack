/**
 * Authentication state.
 *
 * Sits alongside appStore rather than inside it: the dog list and the settings
 * are about the DATA, this is about who is allowed to see it, and the root
 * layout needs the second resolved before it can decide what to render.
 *
 * ── THREE STATES, NOT TWO ─────────────────────────────────────────────
 *
 *   loading      session restore is in flight
 *   signed-out   no session
 *   signed-in    session restored or freshly obtained
 *
 * The third state is the one people forget. Rendering the app while `loading`
 * flashes the onboarding screen at every returning user for a few hundred
 * milliseconds, because the dog list has not been fenced to an owner yet and
 * momentarily looks empty.
 */

import { create } from 'zustand';
import { Platform } from 'react-native';
// Read only to name the applicationId in the Google misconfiguration log
// below. Everything else this store needs from the config comes through
// services/supabase, which does the `extra` unwrapping in one place.
import Constants from 'expo-constants';
import type { Session, User } from '@supabase/supabase-js';
import {
  getSupabase,
  isSyncConfigured,
  readPersistedSession,
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
} from '@/services/supabase';
import { setActiveUserId } from '@/db/scope';
import { dropUnownedCursors } from '@/db/syncState';
import { getDb } from '@/db/client';
import * as outbox from '@/db/outbox';
import { adoptOrphanedLocalData, hasOrphanedLocalData } from '@/services/sync/claim';
import { useAppStore } from './appStore';
import { useConsentStore } from './consentStore';
import {
  describeAuthError,
  isExistingAccountSignUp,
  isProviderMisconfiguration,
  type AuthErrorNotice,
} from '@/services/authErrors';
import {
  RESET_COOLDOWN_MS,
  secondsUntil,
  serverStatedWaitMs,
  signInBackoffMs,
  signUpBackoffMs,
} from './authThrottle';
export { secondsUntil, signInBackoffMs } from './authThrottle';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

/**
 * What happened when a password-reset code was requested.
 *
 * Three outcomes, not two, because "advance to the code screen?" and "did an
 * email go out?" are different questions:
 *
 *   sent       a code was requested successfully — show the code screen
 *   throttled  no new mail, but one was sent moments ago and is presumably in
 *              the inbox — STILL show the code screen, or the owner cannot
 *              type the code they already have
 *   failed     the server refused to send. Do NOT show the code screen: there
 *              is no code coming, and a box waiting for one is a dead end.
 */
export type ResetSendResult = 'sent' | 'throttled' | 'failed';

/**
 * What the manual signup form collects.
 *
 * Only name, email and password are required. Everything else is optional and
 * the form says so — this app already holds veterinary health records, and
 * every extra personal field is one more thing to lose in a breach.
 */
export type SignUpInput = {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
};

/**
 * The shortest password we will accept.
 *
 * Supabase's own default is 6, which is too short to be worth having. Length
 * is the only property that reliably matters, so this asks for length rather
 * than for a symbol and a digit — composition rules mostly produce
 * `Password1!` and a note on the fridge.
 */
export const MIN_PASSWORD_LENGTH = 10;

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /**
   * Consecutive failed password attempts, and when the next one is allowed.
   * A UX affordance only — see the note on signInBackoffMs above.
   */
  failedAttempts: number;
  signInBlockedUntil: number | null;
  /** When the next password-reset code may be sent. */
  resetEmailAllowedAt: number | null;
  /**
   * When the next signup confirmation code may be sent.
   *
   * Kept separate from `resetEmailAllowedAt`: they cover two different emails
   * to two different flows, and sharing one clock would make resending a
   * signup code block a password reset the owner sends five seconds later,
   * for no reason either would recognise.
   */
  signUpCodeAllowedAt: number | null;
  /**
   * Signup attempts, and when the next one is allowed.
   *
   * The signup form now answers "does this email have an account?" (see
   * signUpWithPassword), so it needs a speed bump the sign-in form does not.
   * A client-side one is a speed bump only — see authThrottle.ts.
   */
  signUpAttempts: number;
  signUpBlockedUntil: number | null;
  /**
   * Set when signup was refused because the address already has a CONFIRMED
   * account. The screen offers a route to sign-in instead of a code box for a
   * code that is never going to arrive.
   */
  existingAccountEmail: string | null;

  /**
   * Last auth error, as something the screen can render properly.
   *
   * A structured notice rather than a bare string: the UI needs a title to
   * scan, a body to read, and to know whether offering "Try again" is honest.
   * `null` covers both "nothing went wrong" and "the owner cancelled" — see
   * services/authErrors.ts for why those are the same state.
   */
  error: AuthErrorNotice | null;
  busy: boolean;

  /**
   * True while a verification flow owns the navigation.
   *
   * `verifyOtp` mints a REAL session — for both `signup` and `recovery` — and
   * `onAuthStateChange` fires off it immediately. Without this flag the route
   * gate in app/_layout.tsx would see a signed-in user standing on /verify and
   * pull them into /consent or the tabs, halfway through a flow that has not
   * finished and is meant to end at the sign-in screen.
   *
   * So the gate stands down while this is up. Every path that raises it is
   * responsible for lowering it again — including the failure paths, or the
   * app is left with no gate at all.
   */
  handoff: boolean;

  /**
   * Set when a signup succeeded but the account cannot be used yet because the
   * project requires email confirmation. Without surfacing this the flow looks
   * like it worked and then the first sign-in fails with "Email not
   * confirmed", which reads as a bug in the app rather than an unread email.
   */
  awaitingConfirmation: string | null;

  /**
   * The address a password reset is currently running for.
   *
   * ── WHY THIS IS STORE STATE AND NOT A ROUTE PARAM ─────────────────────
   *
   * It was a route param, and the address came out the other side WRONG.
   * expo-router serialises params into a URL and parses them back out (see
   * the "convert to string then back to object" note in its LocationProvider),
   * and a `+` does not survive that trip — `alice+dog@gmail.com` arrived at
   * the code screen as `alice dog@gmail.com`. Plus-addressing is exactly what
   * people use to sign up for something like this, and the failure is silent:
   * the screen looks right, and verifyOtp then rejects every code the owner
   * types because it is asking about an address that does not exist.
   *
   * The signup half of the flow already carried its address here rather than
   * in the URL. This is the missing counterpart, and it means no
   * owner-supplied string goes through URL encoding anywhere in auth.
   */
  resetEmail: string | null;

  initialize: () => Promise<() => void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (input: SignUpInput) => Promise<void>;
  /** Verifies the 6-digit code from the signup email. Returns whether it worked. */
  confirmSignUp: (email: string, code: string) => Promise<boolean>;
  /** Resends the signup confirmation code. Returns whether it was sent. */
  resendSignUpCode: (email: string) => Promise<boolean>;
  /**
   * Abandons a pending signup confirmation so the owner can back out and
   * retry — with a different email, or later — instead of being stuck on a
   * code screen for an email that never arrived. See the note above
   * `awaitingConfirmation` on why a code can simply never show up.
   */
  cancelSignUpConfirmation: () => void;
  /** Clears the "already registered" state when the owner edits the email. */
  clearExistingAccount: () => void;
  /**
   * Records which address the code screen is about, for the one path that
   * reaches it without sending: "already have the code?" on /forgot-password.
   * Every other path sets this through sendPasswordReset.
   */
  setResetEmail: (email: string) => void;
  sendPasswordReset: (email: string) => Promise<ResetSendResult>;
  /**
   * Verifies the 6-digit reset code and nothing else.
   *
   * Split from setting the password because the two now live on separate
   * screens: a wrong code has to be reported on the screen holding the code
   * box, not after the owner has already composed a new password on the next
   * one. On success the recovery session is LIVE and `handoff` stays up —
   * `completePasswordReset` or `abandonPasswordReset` must follow.
   */
  verifyResetCode: (email: string, code: string) => Promise<boolean>;
  /** Sets the new password on the recovery session, then signs out. */
  completePasswordReset: (newPassword: string) => Promise<boolean>;
  /** Discards a verified-but-unfinished reset and its recovery session. */
  abandonPasswordReset: () => Promise<void>;
  signOut: () => Promise<void>;
  setError: (message: AuthErrorNotice | null) => void;
};

/**
 * Applying a session is more than storing it.
 *
 * `setActiveUserId` is what every repository read filters on, so it has to
 * move in lockstep with the session or a screen will briefly query with the
 * wrong owner — showing the previous user's dog, or none at all.
 */
function applySession(session: Session | null): void {
  setActiveUserId(session?.user.id ?? null);
}

/**
 * Commit a session change that has been CONFIRMED — either a real session, or
 * a sign-out this device has proof of.
 *
 * Split out of the `onAuthStateChange` callback because the null case now has
 * to check storage before it can be believed (see the listener), and the two
 * paths must not drift: whichever one commits, it has to move the owner fence,
 * the store, and the cached dog list together.
 */
function finishSessionChange(session: Session | null): void {
  const previousUserId = useAuthStore.getState().user?.id ?? null;
  const nextUserId = session?.user.id ?? null;

  applySession(session);
  useAuthStore.setState({
    status: session ? 'signed-in' : 'signed-out',
    session,
    user: session?.user ?? null,
  });

  // WHO the rows on this phone belong to has just changed, so anything cached
  // under the old owner is now another account's data sitting in this one's
  // screens. Dropped and re-read before anything else runs. TOKEN_REFRESHED
  // and USER_UPDATED fire with the same id and must not churn the store, hence
  // the comparison rather than a blanket reset.
  if (previousUserId !== nextUserId) {
    void useAppStore
      .getState()
      .resetForAccountChange()
      .catch((e) => console.warn('[auth] could not re-read for new account', e));
  }
}

/**
 * End the session on THIS device and put every store back to signed-out.
 *
 * Extracted because three callers now need it and they must not drift: the
 * ordinary `signOut` action, and the two verification flows that deliberately
 * throw away the session `verifyOtp` just handed them. Missing any one of
 * these steps leaves the previous account's rows on screen for whoever holds
 * the phone next.
 *
 * Throws if the provider refuses, so each caller can decide how loudly that
 * matters — it is fatal for `signOut` and merely untidy mid-verification.
 */
async function discardLocalSession(): Promise<void> {
  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw new Error(error.message);
  }
  applySession(null);
  useAuthStore.setState({ status: 'signed-out', session: null, user: null });
  useConsentStore.getState().reset();
  await useAppStore.getState().resetForAccountChange();
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  session: null,
  user: null,
  awaitingConfirmation: null,
  resetEmail: null,
  failedAttempts: 0,
  signInBlockedUntil: null,
  resetEmailAllowedAt: null,
  signUpCodeAllowedAt: null,
  signUpAttempts: 0,
  signUpBlockedUntil: null,
  existingAccountEmail: null,
  error: null,
  busy: false,
  handoff: false,

  /**
   * Restore the persisted session and subscribe to changes.
   *
   * Returns a teardown function. Call once from the root layout.
   */
  initialize: async () => {
    const supabase = getSupabase();

    // A build with no Supabase config is the app exactly as it shipped before
    // accounts existed: fully usable, permanently signed out, nothing to sync.
    if (!supabase) {
      applySession(null);
      set({ status: 'signed-out', session: null, user: null });
      return () => {};
    }

    /*
     * ── RESTORED FROM DISK, NOT FROM THE NETWORK ──────────────────────
     *
     * This used to be `await supabase.auth.getSession()`, which reads like a
     * local call and is not one: with an access token near expiry — true of
     * any launch more than an hour after the last one — it refreshes over the
     * network first, retrying for up to thirty seconds before giving up.
     *
     * Startup awaited that. So did first render, and so did the widget's
     * seizure route, which cannot start a timer until it knows there is a
     * session. Offline, it then reported `session: null` and the owner was
     * sent to sign-in mid-seizure, with their session still sitting in the
     * keystore, valid.
     *
     * Reading storage directly costs one keystore read and cannot fail in
     * that direction. supabase-js still refreshes — subscribing below kicks
     * its own initialize — and the listener corrects this state if the
     * session turns out to be genuinely dead. See readPersistedSession().
     */
    const stored = await readPersistedSession();

    applySession(stored);
    set({
      status: stored ? 'signed-in' : 'signed-out',
      session: stored,
      user: stored?.user ?? null,
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      /*
       * ── A NULL SESSION IS NOT PROOF OF A SIGN-OUT ────────────────────
       *
       * supabase-js emits INITIAL_SESSION with `null` when its startup
       * refresh fails — including when it failed because the phone has no
       * signal. Acting on that is the same bug as above, arriving a moment
       * later: the owner is signed out of an app whose session is still on
       * disk, and has to type a password to record a seizure.
       *
       * Storage is the discriminator, and it is supabase-js's own rule. It
       * REMOVES the stored session for a definitive failure (a revoked or
       * already-used refresh token) and for an explicit sign-out — clearing
       * it before this event fires — and KEEPS it for a retryable one. So a
       * null session with something still in storage means "could not reach
       * the server", and a null session with empty storage means "gone".
       */
      if (!session) {
        void (async () => {
          const surviving = await readPersistedSession();
          if (surviving) {
            // Transient. Hold the session we already have rather than
            // downgrading it; auto-refresh will retry when signal returns.
            applySession(surviving);
            set({ status: 'signed-in', session: surviving, user: surviving.user });
            return;
          }
          finishSessionChange(null);
        })().catch((e) => console.warn('[auth] could not confirm sign-out', e));
        return;
      }

      finishSessionChange(session);

      /*
       * Adopt anything left over from before accounts were required.
       *
       * INITIAL_SESSION as well as SIGNED_IN, deliberately. supabase-js emits
       * INITIAL_SESSION — not SIGNED_IN — when it restores a stored session at
       * launch, so a check gated on SIGNED_IN alone would run only at the
       * moment of signing in and never again, leaving anyone whose first
       * sign-in was interrupted stranded until they signed out and back in.
       *
       * Free for every normal install: hasOrphanedLocalData() is one indexed
       * count that returns false immediately, and nothing else runs. See
       * services/sync/claim.ts on why this no longer asks the owner anything.
       */
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        void (async () => {
          if (!(await hasOrphanedLocalData())) return;
          const adopted = await adoptOrphanedLocalData(session.user.id);
          if (adopted.rows > 0) await useAppStore.getState().refreshDogs();
        })().catch((e) => console.warn('[auth] adopting local records failed', e));

        /*
         * Never let this account inherit a sync position that is not its own.
         *
         * `sync_seq` is one global sequence shared by every account, so a
         * cursor left behind by whoever used this phone last would make this
         * account's pull skip every row below it — silently, with the sync
         * reporting success. Migration 15 keys cursors on (user_id,
         * table_name) so that cannot happen; this is the check that the
         * database in front of us actually got there.
         *
         * Runs BEFORE the first sync (the root layout kicks that off once the
         * session lands), so a cursor that should not be trusted is gone
         * before anything reads it. One indexed DELETE that normally matches
         * nothing.
         */
        void dropUnownedCursors()
          .then((dropped) => {
            if (dropped > 0) {
              console.warn(
                `[sync] discarded ${dropped} cursor(s) with no account; ` +
                  'the next pull re-reads from the start',
              );
            }
          })
          .catch((e) => console.warn('[sync] cursor ownership check failed', e));
      }

      if (event === 'SIGNED_OUT') {
        set({ awaitingConfirmation: null });
        // Consent belongs to the account, so the answer for the person who
        // just left must not be reused for whoever signs in next.
        useConsentStore.getState().reset();
      }

      // A confirmed sign-in is the first chance to move the signup details out
      // of user_metadata and into the profiles table, where they are covered
      // by RLS and a NOT NULL. Left on SIGNED_IN only: reconcileProfile is a
      // no-op once a row exists, and re-running it on every launch would spend
      // a round trip to learn that.
      if (event === 'SIGNED_IN' && session) {
        void reconcileProfile(session.user);
      }
    });

    return () => sub.subscription.unsubscribe();
  },

  /**
   * Sign in with Apple.
   *
   * MANDATORY once Google is offered — App Store guideline 4.8. Not a
   * preference: an app with Google sign-in and no Apple equivalent is rejected.
   *
   * Uses the NATIVE id-token flow rather than Supabase's web OAuth redirect.
   * The redirect bounces the user out to a browser and back, which is slower
   * and loses the platform's own account picker.
   */
  signInWithApple: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const AppleAuthentication = await import('expo-apple-authentication');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('Apple did not return an identity token.');
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      // Cancellation, provider codes and our own messages are all decided in
      // one place now, so Apple and Google cannot drift apart again.
      set({ error: describeAuthError(e, 'apple') });
    } finally {
      set({ busy: false });
    }
  },

  /** Google, also via the native id-token flow. */
  signInWithGoogle: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const { GoogleSignin } = await import(
        '@react-native-google-signin/google-signin'
      );

      GoogleSignin.configure({
        // The WEB client id is what Supabase validates the token's audience
        // against, so it is required even though there is no web build.
        webClientId: GOOGLE_WEB_CLIENT_ID,
        iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
      });

      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();

      /*
       * CANCELLATION RESOLVES HERE. IT DOES NOT THROW.
       *
       * The library returns a discriminated union, and backing out of the
       * sheet gives `{ type: 'cancelled', data: null }` — a normal resolved
       * value, not a rejection.
       *
       * The previous line was:
       *
       *   const idToken = 'data' in response ? response.data?.idToken : null;
       *
       * `'data' in response` is TRUE for the cancelled shape, so it read
       * `null?.idToken`, got undefined, and fell into the throw below —
       * manufacturing "Google did not return an identity token" out of a
       * deliberate choice. That is what put an error panel in front of anyone
       * who changed their mind, and no amount of message-matching downstream
       * could undo it: the information was already destroyed here.
       */
      if (response.type !== 'success') {
        set({ error: null });
        return;
      }

      const idToken = response.data?.idToken;
      if (!idToken) throw new Error('Google did not return an identity token.');

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      /*
       * The owner gets the calm version; whoever has to FIX it gets the facts.
       *
       * DEVELOPER_ERROR is the one auth failure with no diagnosis visible from
       * inside the app — Play Services will not say which of the applicationId,
       * the signing certificate or the client id it disliked, and the message
       * the owner is shown deliberately says none of it. Every time this was
       * hit, the next half hour went on rediscovering which values were even in
       * play, so the store prints them.
       *
       * NOT gated on __DEV__. A release build installed from a Play test track
       * is exactly where this surfaces, and `adb logcat` is the only instrument
       * anyone has there. Nothing here is a secret: the client id is public by
       * design (see the note in app.config.ts) and the package name is on the
       * store listing.
       */
      if (isProviderMisconfiguration(e)) {
        console.error(
          '[auth] Google sign-in rejected this build. No OAuth client in the ' +
            'Google Cloud project matches it. Check, in order: an Android ' +
            'client exists for this package name; its SHA-1 is the certificate ' +
            'this build is actually signed with (Play App Signing re-signs the ' +
            'AAB, so the Play console fingerprint is the one that counts, not ' +
            'the upload key); the web client id below is the one set as ' +
            "Supabase's Authorized Client ID. See docs/GOOGLE_SIGNIN.md.",
          {
            package: Constants.expoConfig?.android?.package ?? '(unknown)',
            webClientId: GOOGLE_WEB_CLIENT_ID || '(EMPTY — never reached the build)',
          },
        );
      }
      // Previously this set the raw thrown message with no cancellation check,
      // so dismissing the Google sheet raised a red panel reading things like
      // "DEVELOPER_ERROR" at someone who had simply changed their mind.
      set({ error: describeAuthError(e, 'google') });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Email and password.
   *
   * ── A NOTE ON THE TRADE BEING MADE ────────────────────────────────────
   *
   * The architecture spec preferred a magic link precisely because a password
   * never stored is a breach that cannot happen. Passwords were chosen anyway,
   * which is a legitimate product call — people expect them, and a link that
   * lands in spam is its own kind of lockout. What it costs is a credential
   * store, a reset flow, and a permanent credential-stuffing surface, so the
   * mitigations below are not optional decoration:
   *
   *   - a real length minimum (MIN_PASSWORD_LENGTH)
   *   - a reset flow that actually exists, because a forgotten password on a
   *     medical diary must never be a dead end
   *   - errors that do not confirm whether an address has an account
   */
  signInWithPassword: async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) return;

    // Refuse locally while the backoff is running, so the attempt never
    // reaches the server and the countdown the screen shows stays truthful.
    const blockedUntil = useAuthStore.getState().signInBlockedUntil;
    const waitSeconds = secondsUntil(blockedUntil);
    if (waitSeconds > 0) {
      set({
        error: {
          title: 'Too many attempts',
          body: `Wait ${waitSeconds} ${waitSeconds === 1 ? 'second' : 'seconds'} and try again. Nothing has been lost — your records are on this phone either way.`,
          retryable: false,
        },
      });
      return;
    }

    set({ busy: true, error: null, awaitingConfirmation: null });
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        // Supabase distinguishes these two, and the difference matters to the
        // owner: one means "try again", the other means "go and read your
        // email". Anything else stays vague on purpose — a message that
        // confirms an address has an account is an account-enumeration oracle.
        const message = error.message.toLowerCase();
        if (message.includes('not confirmed')) {
          set({ awaitingConfirmation: email.trim().toLowerCase() });
          throw new Error(
            'Confirm your email address first — check your inbox for the link we sent.',
          );
        }
        throw new Error('That email and password do not match.');
      }
      // Clean sign-in clears the backoff; the next wrong password starts over.
      set({ failedAttempts: 0, signInBlockedUntil: null });
    } catch (e) {
      // Only a WRONG CREDENTIAL counts toward the backoff. "Confirm your email
      // first" is a correct password on an unconfirmed account — throttling it
      // would lock someone out of the one screen that tells them to go and
      // click the link, which is the opposite of what the backoff is for.
      if (useAuthStore.getState().awaitingConfirmation === null) {
        const failures = useAuthStore.getState().failedAttempts + 1;
        const backoff = signInBackoffMs(failures);
        set({
          failedAttempts: failures,
          signInBlockedUntil: backoff > 0 ? Date.now() + backoff : null,
        });
      }
      // The password paths above throw messages already written for owners,
      // and describeAuthError passes those straight through.
      set({ error: describeAuthError(e, 'password') });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Create an account. Supabase emails a 6-digit code rather than a link —
   * see `confirmSignUp` for why a code and not a link.
   *
   * The profile row is written AFTER the account is CONFIRMED, not here,
   * because `profiles.user_id` is a foreign key to auth.users and RLS keys the
   * insert on auth.uid(), which does not exist until then. Until confirmation
   * the details ride along in `options.data` — a staging area for data nobody
   * makes a trust decision on — and `confirmSignUp` moves them over.
   */
  signUpWithPassword: async (input: SignUpInput) => {
    const supabase = getSupabase();
    if (!supabase) return;

    // Refuse locally while the backoff is running, so the attempt never
    // reaches the server and the countdown on screen stays truthful.
    const waitSeconds = secondsUntil(useAuthStore.getState().signUpBlockedUntil);
    if (waitSeconds > 0) {
      set({
        error: {
          title: 'Too many attempts',
          body: `Wait ${waitSeconds} ${waitSeconds === 1 ? 'second' : 'seconds'} and try again. Nothing has been lost — your records are on this phone either way.`,
          retryable: false,
        },
      });
      return;
    }

    set({
      busy: true,
      error: null,
      awaitingConfirmation: null,
      existingAccountEmail: null,
    });

    const email = input.email.trim().toLowerCase();
    const profile = {
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() ?? '',
      emergency_contact_name: input.emergencyContactName?.trim() ?? '',
      emergency_contact_phone: input.emergencyContactPhone?.trim() ?? '',
    };

    // Counted whatever the outcome, because what needs rate-limiting here is
    // ATTEMPTS, not failures — a successful "that email is taken" is exactly
    // the answer an enumeration scan is fishing for.
    const attempts = useAuthStore.getState().signUpAttempts + 1;
    const backoff = signUpBackoffMs(attempts);
    set({
      signUpAttempts: attempts,
      signUpBlockedUntil: backoff > 0 ? Date.now() + backoff : null,
    });

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: input.password,
        options: { data: profile },
      });
      if (error) throw new Error(error.message);

      /*
       * ── "THIS EMAIL ALREADY HAS AN ACCOUNT" ───────────────────────────
       *
       * With email confirmation required, signUp() on an address that already
       * belongs to a CONFIRMED account does not return an error. GoTrue
       * answers 200 with a user-shaped object specifically so the endpoint
       * cannot be used to enumerate accounts — and that obfuscated user is
       * distinguishable in exactly one way: `identities` comes back EMPTY.
       * A genuinely new signup always carries one identity.
       *
       * Treating that response as success is what produced the bug this
       * replaces: the app showed "we've sent you a 6-digit code" for an
       * address that was never sent one, and left the owner staring at a code
       * box waiting for mail that does not exist. Nothing recovers from that
       * screen, because the code cannot arrive.
       *
       * So the trade is made deliberately and in one direction: the form
       * TELLS the person, and points at sign-in. Yes, that turns signup into
       * an account-existence oracle — which is precisely what the sign-in
       * form refuses to be (see the note in sign-in.tsx on its vague errors).
       * The difference is that a wrong answer here strands a real owner in an
       * unrecoverable state, whereas the sign-in form's vagueness costs a
       * confused user one extra guess. Enumeration is mitigated instead by
       * throttling above and by Supabase's per-IP rate limit; see
       * docs/SECURITY.md, which records this as a knowing exception.
       *
       * `identities` is optional in the SDK's type and absent (rather than
       * empty) on some responses, so the check is explicitly for an array of
       * length 0 — `!data.user.identities?.length` would also fire on a shape
       * that simply omitted the field, and refuse a legitimate signup.
       */
      if (isExistingAccountSignUp(data.user)) {
        set({ existingAccountEmail: email });
        return;
      }

      if (data.session) {
        // Auto-confirm is on: we have a session already, nothing to verify.
        await writeProfile(profile);
      } else {
        // A code has been emailed. Nothing more can happen until it is
        // entered, and saying so is the whole point of this state.
        set({ awaitingConfirmation: email, signUpCodeAllowedAt: Date.now() + RESET_COOLDOWN_MS });
      }
    } catch (e) {
      // Logged as well as shown. The message GoTrue returns here ("Error
      // sending confirmation email", for one) is the only clue to a broken
      // mailer, and it used to be swallowed into a notice that said the app
      // could not say what went wrong — leaving nothing in the log to read.
      console.warn('[auth] sign-up failed', e);
      set({ error: describeAuthError(e, 'password', 'sign-up') });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Verify the signup code and finish creating the account.
   *
   * ── WHY A CODE, NOT THE LINK SUPABASE DEFAULTS TO ─────────────────────
   *
   * A confirmation LINK has to open in a browser, which then has to hand back
   * to this app through a custom URL scheme and a Supabase redirect — three
   * hops, any of which can land on a dead page instead of PawTrack. That is
   * exactly the failure an owner hit. A CODE only has to be read and typed:
   * `verifyOtp` exchanges it for a session inside this same screen, with
   * nothing to open and nothing to redirect.
   *
   * On success this does NOT write the profile itself or flip `status` —
   * `verifyOtp` sets a real session the same way any other sign-in does, so
   * the `onAuthStateChange` listener in `initialize()` fires exactly as it
   * would for Google or Apple, runs `reconcileProfile`, and the root layout's
   * existing redirect takes it from there. One path for "a session now
   * exists", not two.
   */
  confirmSignUp: async (email: string, code: string) => {
    const supabase = getSupabase();
    if (!supabase) return false;
    // `handoff` goes up BEFORE verifyOtp, not after. verifyOtp mints a real
    // session and onAuthStateChange fires off it straight away, so a gate that
    // was still listening would route this half-finished flow into /consent
    // before the sign-out below had even been awaited.
    set({ busy: true, error: null, handoff: true });
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: 'signup',
      });
      if (error) throw new Error(error.message);
      set({ awaitingConfirmation: null });

      /*
       * Confirmed — and then deliberately signed out again.
       *
       * verifyOtp leaves a perfectly usable session, so letting it stand would
       * drop the owner straight into the app. The flow ends at the sign-in
       * screen instead: holding the inbox and knowing the password are two
       * different claims, and on a medical record the second is worth asking
       * for once. It also keeps ONE place where a session is born.
       *
       * A failed sign-out here is untidy, not fatal: the account is confirmed
       * either way and the fallback is the session standing and the gate
       * letting them in — a worse ending than intended, not a broken one. So
       * it is logged rather than shown.
       */
      try {
        await discardLocalSession();
      } catch (signOutError) {
        console.warn('[auth] could not end the verification session', signOutError);
      }
      return true;
    } catch (e) {
      set({ error: describeAuthError(e, 'password', 'sign-up') });
      return false;
    } finally {
      // Lowered on BOTH paths. A stuck flag is an app with no route gate.
      set({ busy: false, handoff: false });
    }
  },

  /**
   * Abandons a pending signup confirmation.
   *
   * Clears the cooldown along with it — that clock exists to protect an
   * inbox that is being abandoned right now, and leaving it running would
   * only block a fresh attempt at a different address for no reason anyone
   * looking at the screen could guess.
   */
  cancelSignUpConfirmation: () => {
    set({ awaitingConfirmation: null, signUpCodeAllowedAt: null, error: null });
  },

  /** Resends the signup code, under the same cooldown as the first send. */
  resendSignUpCode: async (email: string) => {
    const supabase = getSupabase();
    if (!supabase) return false;

    const wait = secondsUntil(useAuthStore.getState().signUpCodeAllowedAt);
    if (wait > 0) {
      set({
        error: {
          title: 'Code already sent',
          body: `Check your inbox and spam folder. You can send another in ${wait} ${wait === 1 ? 'second' : 'seconds'}.`,
          retryable: false,
        },
      });
      return false;
    }

    set({ busy: true, error: null, signUpCodeAllowedAt: Date.now() + RESET_COOLDOWN_MS });
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
      });
      if (error) {
        // The server refused because ITS window is still open. Its number is
        // authoritative; ours was a guess that has just been proved wrong, so
        // the countdown is corrected rather than left promising 60s.
        const stated = serverStatedWaitMs(error);
        if (stated !== null) {
          set({ signUpCodeAllowedAt: Date.now() + stated });
          const wait = Math.ceil(stated / 1000);
          set({
            error: {
              title: 'Code already sent',
              body: `Check your inbox and spam folder. You can send another in ${wait} ${wait === 1 ? 'second' : 'seconds'}.`,
              retryable: false,
            },
          });
          return false;
        }
        throw new Error(error.message);
      }
      return true;
    } catch (e) {
      set({ error: describeAuthError(e, 'password', 'sign-up') });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Send a password reset code.
   *
   * Always reports success, whatever happened. "No account with that email"
   * would turn this box into an account-enumeration oracle: anyone could feed
   * it addresses and learn which belong to people managing a dog's epilepsy.
   */
  sendPasswordReset: async (email: string): Promise<ResetSendResult> => {
    const supabase = getSupabase();
    if (!supabase) return 'failed';

    // Each press sends MAIL. The cooldown is what stops a mashed button from
    // filling someone's inbox — including someone who is not the person
    // pressing it, since the address is whatever was typed.
    const wait = secondsUntil(useAuthStore.getState().resetEmailAllowedAt);
    if (wait > 0) {
      set({
        error: {
          title: 'Code already sent',
          body: `Check your inbox and spam folder. You can send another in ${wait} ${wait === 1 ? 'second' : 'seconds'}.`,
          retryable: false,
        },
      });
      return 'throttled';
    }

    set({ busy: true, error: null, resetEmailAllowedAt: Date.now() + RESET_COOLDOWN_MS });
    try {
      // No redirectTo: the owner types a 6-digit code (see verifyResetCode),
      // so there is no link to come back through, and
      // naming a deep link we never handle only invites a dead browser tab if
      // the template ever changes.
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
      );

      // Recorded on the way out, not by the screen: /verify reads it from
      // here, and it must describe the address the mail actually went to.
      if (!error) {
        set({ resetEmail: email.trim().toLowerCase() });
        return 'sent';
      }

      // The server refused because ITS window is still open. Its number is
      // authoritative; ours was a guess it has just disproved. A code from the
      // earlier request is still in the inbox, so this is 'throttled', not a
      // failure — the owner can still type it.
      const stated = serverStatedWaitMs(error);
      if (stated !== null) {
        const seconds = Math.ceil(stated / 1000);
        set({
          // 'throttled' still advances to the code screen — an earlier code is
          // in the inbox — so the address has to be recorded here too.
          resetEmail: email.trim().toLowerCase(),
          resetEmailAllowedAt: Date.now() + stated,
          error: {
            title: 'Code already sent',
            body: `Check your inbox and spam folder. You can send another in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
            retryable: false,
          },
        });
        return 'throttled';
      }

      /*
       * ── A GENUINE SEND FAILURE ────────────────────────────────────────
       *
       * This branch used to be a console.warn and nothing else: the function
       * returned `true` whatever happened, the screen advanced, and the owner
       * was shown a six-digit code box for an email the server had just said
       * it could not send. That is the same dead end the signup flow used to
       * have, and it is worse here — someone locked out of their account is
       * told to wait for mail that is never coming.
       *
       * Reporting it does NOT leak whether the address has an account.
       * GoTrue answers an unknown address with 200 and no error at all (it
       * does not attempt a send), so this branch is only ever reached when
       * OUR mail delivery is broken — which is a fact about us, not about the
       * owner. The enumeration argument that keeps the success path vague
       * (see the note above) does not extend to an outage.
       *
       * The cooldown is CLEARED. It exists to protect an inbox from repeated
       * mail; no mail was sent, so there is nothing to protect, and leaving a
       * 60-second block on a button the owner needs to retry would compound
       * our failure with a wait they cannot do anything about.
       */
      console.warn('[auth] password reset failed', error.message);
      set({
        resetEmailAllowedAt: null,
        error: {
          title: 'Could not send the code',
          body:
            'Something went wrong on our side and the email was not sent, so no code is coming. Please try again in a moment — if it keeps failing, contact support.',
          retryable: true,
        },
      });
      return 'failed';
    } catch (e) {
      console.warn('[auth] password reset failed', e);
      set({
        resetEmailAllowedAt: null,
        error: describeAuthError(e, 'password'),
      });
      return 'failed';
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Verify the reset code and set the new password in the same step.
   *
   * `verifyOtp` with `type: 'recovery'` exchanges the code for a real
   * session — recovery sessions are sessions, not a separate half-signed-in
   * state — so `updateUser` right after it is an authenticated write, not a
   * special case. If the code is right but `updateUser` fails, the owner is
   * left signed in with their OLD password rather than locked out either way,
   * which is what error handling for a security screen should default to.
   */
  verifyResetCode: async (email: string, code: string) => {
    const supabase = getSupabase();
    if (!supabase) return false;
    // Same reasoning as confirmSignUp: `type: 'recovery'` returns a REAL
    // session, and the gate must not act on it while the reset is half done.
    set({ busy: true, error: null, handoff: true });
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: 'recovery',
      });
      if (error) throw new Error(error.message);
      // handoff STAYS up: the recovery session is live and the owner is on
      // their way to the new-password screen. It comes down in
      // completePasswordReset or abandonPasswordReset, and nowhere else.
      return true;
    } catch (e) {
      // Nothing was established, so the gate can have the navigation back.
      set({ error: describeAuthError(e, 'password'), handoff: false });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  completePasswordReset: async (newPassword: string) => {
    const supabase = getSupabase();
    if (!supabase) return false;
    set({ busy: true, error: null });
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);

      // The backoff that built up while they were guessing is describing a
      // password that no longer exists.
      set({ failedAttempts: 0, signInBlockedUntil: null });

      // Signed out for the same reason confirmSignUp signs out: the reset ends
      // at the sign-in screen, where the new password gets used once and is
      // therefore remembered.
      try {
        await discardLocalSession();
      } catch (signOutError) {
        console.warn('[auth] could not end the recovery session', signOutError);
      }
      set({ handoff: false, resetEmail: null });
      return true;
    } catch (e) {
      /*
       * handoff STAYS UP on failure, which is the opposite of what it does
       * everywhere else.
       *
       * The recovery session is still live and the owner is still standing on
       * the new-password screen holding a rejected password — "should be
       * different from the old password" is the one they will actually hit.
       * Releasing the gate here would notice a signed-in user and yank them
       * into the app mid-reset. They leave through the screen's own back
       * action instead, which calls abandonPasswordReset.
       */
      set({ error: describeAuthError(e, 'password') });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  abandonPasswordReset: async () => {
    // Backing out of the new-password screen leaves a live recovery session
    // that the next gate run would walk straight into the app — using a
    // password the owner has just told us they cannot remember.
    try {
      await discardLocalSession();
    } catch (e) {
      console.warn('[auth] could not discard the recovery session', e);
    }
    set({ handoff: false, error: null, resetEmail: null });
  },

  /**
   * Sign out of THIS device only.
   *
   * Local data is deliberately left in place — see src/db/scope.ts. The caller
   * is responsible for warning about an undrained outbox first;
   * pendingWriteCount() below is what that warning reads.
   */
  signOut: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      // Explicit as well as event-driven. onAuthStateChange normally fires
      // SIGNED_OUT and resets the stores, but sign-out must not depend on an
      // event arriving: whatever else happens, the previous account's dog list
      // does not stay on screen for the next person holding the phone.
      await discardLocalSession();
    } catch (e) {
      set({
        error: {
          title: 'Could not sign out',
          body:
            'You are still signed in on this device. Your records are safe either way — try again in a moment.',
          retryable: true,
        },
      });
    } finally {
      set({ busy: false });
    }
  },

  clearExistingAccount: () => set({ existingAccountEmail: null }),
  setResetEmail: (email) => set({ resetEmail: email.trim().toLowerCase() }),
  setError: (message) => set({ error: message }),
}));

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

type ProfileRow = {
  full_name: string;
  phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
};

async function writeProfile(profile: ProfileRow): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const now = Date.now();
  const { error } = await supabase
    .from('profiles')
    .upsert({ ...profile, created_at: now, updated_at: now }, { onConflict: 'user_id' });
  if (error) console.warn('[auth] could not write profile', error.message);
}

/**
 * Move signup details from user_metadata into the profiles table.
 *
 * Runs on every sign-in and is a no-op once a row exists, so a user who
 * confirmed their email days later still gets their name recorded, and someone
 * who signed in with Apple or Google — where there was never a form — simply
 * has nothing to copy.
 */
async function reconcileProfile(user: User): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { data } = await supabase
      .from('profiles')
      .select('user_id')
      .limit(1)
      .maybeSingle();
    if (data) return;

    const meta = (user.user_metadata ?? {}) as Partial<ProfileRow> & {
      name?: string;
      full_name?: string;
    };
    // Apple and Google put a display name here under their own keys; fall back
    // through them so an OAuth account still gets a name rather than a blank.
    const fullName = (meta.full_name ?? meta.name ?? '').trim();
    if (!fullName) return;

    await writeProfile({
      full_name: fullName,
      phone: meta.phone ?? '',
      emergency_contact_name: meta.emergency_contact_name ?? '',
      emergency_contact_phone: meta.emergency_contact_phone ?? '',
    });
  } catch (e) {
    // A missing profile row is cosmetic. It must never block a sign-in.
    console.warn('[auth] profile reconcile failed', e);
  }
}

/**
 * How many local writes have not reached the account.
 *
 * Drives the sign-out warning: "3 records haven't been backed up yet."
 * Never block sign-out on it — just make sure the owner knows before they
 * potentially walk away from a phone holding the only copy.
 */
export async function pendingWriteCount(): Promise<number> {
  const db = await getDb();
  // Scoped to the account that is about to sign out. Another account's stuck
  // entries, and unclaimed ones, are not what this sign-out risks stranding.
  return outbox.pendingCount(db, useAuthStore.getState().user?.id ?? null);
}

/** Whether to offer accounts at all in this build. */
export function accountsAvailable(): boolean {
  return isSyncConfigured();
}

/** Apple sign-in only exists on iOS; the button must not render elsewhere. */
export function appleSignInAvailable(): boolean {
  return Platform.OS === 'ios';
}
